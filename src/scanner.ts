import { detectBars, matchNames, nameRectangle } from './detection.ts';
import type { Pokemon } from './ranking.ts';

export async function scanImage(canvas: HTMLCanvasElement, catalog: Pokemon[], onProgress: (text: string) => void, signal: AbortSignal) {
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const detection = detectBars(pixels);
    const rectangle = nameRectangle(pixels);
    const crop = document.createElement('canvas');
    crop.width = rectangle.width * 2;
    crop.height = rectangle.height * 2;
    const cropped = crop.getContext('2d')!;
    cropped.drawImage(canvas, rectangle.left, rectangle.top, rectangle.width, rectangle.height, 0, 0, crop.width, crop.height);
    const image = cropped.getImageData(0, 0, crop.width, crop.height);
    for (let index = 0; index < image.data.length; index += 4) {
        const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
        const value = gray < 175 ? 0 : 255;
        image.data[index] = value; image.data[index + 1] = value; image.data[index + 2] = value;
    }
    cropped.putImageData(image, 0, 0);
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
        // ponytail: Tesseract.js 7.0.0のWorker通信に限定。更新時は初期化中の中止もブラウザで検証する。
        worker = new Worker('/ocr/worker.min.js');
        let currentJob: { id: string; resolve: (data: { text?: string }) => void; reject: (error: Error) => void } | undefined;
        let sequence = 0;
        const request = (action: string, payload: Record<string, unknown>) => new Promise<{ text?: string }>((resolve, reject) => {
            const id = String(++sequence);
            currentJob = { id, resolve, reject };
            worker!.postMessage({ workerId: 'scanner', jobId: id, action, payload });
        });
        const timeout = new Promise<never>((_, reject) => {
            abort = () => { worker?.terminate(); reject(new Error('読み取りを中止しました。手入力でも順位を調べられます。')); };
            signal.addEventListener('abort', abort, { once: true });
            worker!.onerror = () => reject(new Error('文字認識を準備できませんでした。'));
            timer = setTimeout(() => { worker?.terminate(); reject(new Error('名前の読み取りが時間内に終わりませんでした。ポケモンを手動で選んでください。')); }, 45000);
        });
        worker.onmessage = ({ data: message }) => {
            if (message.status === 'progress') {
                onProgress(message.data.status === 'recognizing text' ? 'ポケモン名を読み取っています…' : '文字認識を準備しています…');
            } else if (currentJob && currentJob.id === message.jobId) {
                if (message.status === 'resolve') currentJob.resolve(message.data);
                if (message.status === 'reject') currentJob.reject(new Error(String(message.data)));
            }
        };
        const recognize = async () => {
            await request('load', { options: { lstmOnly: true, corePath: new URL('/ocr/core', location.href).href, logging: false } });
            await request('loadLanguage', { langs: ['jpn'], options: { langPath: new URL('/ocr', location.href).href, gzip: true, lstmOnly: true, cacheMethod: 'write' } });
            await request('initialize', { langs: ['jpn'], oem: 1, config: {} });
            await request('setParameters', { params: { tessedit_pageseg_mode: '7' } });
            const image = Uint8Array.from(atob(crop.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0));
            return request('recognize', { image, options: {}, output: { text: true } });
        };
        if (signal.aborted) abort();
        const result = await Promise.race([recognize(), timeout]);
        const text = result.text ?? '';
        return { detection, candidates: matchNames(text, catalog), text, nameError: '' };
    } catch (error) {
        return { detection, candidates: [], text: '', nameError: signal.aborted ? '読み取りを中止しました。' : '名前を読み取れませんでした。ポケモンを手動で選んでください。' };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); }
    }
}

export async function loadImage(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG・JPEG・WebPの画像を選んでください。HEICはPNGに変換してください。');
    if (file.size > 20 * 1024 * 1024) throw new Error('画像は20MB以下にしてください。');
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (img.width * img.height > 32_000_000 || img.width < 250 || img.height < 400) throw new Error('画像の大きさに対応していません。スマホのスクリーンショットを選んでください。');
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(1000, img.width);
        canvas.height = Math.round(img.height * canvas.width / img.width);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas;
    } finally { URL.revokeObjectURL(url); }
}
