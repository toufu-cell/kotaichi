import type { Env } from './index.ts';
import { createImageRecognizer, OCR_INPUT_ERROR } from './ocr.ts';
import { DiscordInputError, downloadImage, manualInput, type DiscordImage } from './discord.ts';

export function createDiscordScanner(wasm: WebAssembly.Module, assets: Env['ASSETS']) {
    let recognizer: Awaited<ReturnType<typeof createImageRecognizer>> | undefined;
    let pending = Promise.resolve();
    return (image: DiscordImage, signal: AbortSignal, deadline = Date.now() + 45000) => {
        const checkDeadline = () => {
            if (signal.aborted || Date.now() >= deadline) throw new DiscordInputError('画像の読み取りが時間内に終わりませんでした。ポケモン名、空白、8/3/11の順で本文を付けて再投稿してください。');
        };
        const job = pending.then(async () => {
            checkDeadline();
            const override = manualInput(image.caption);
            if (override) return override;
            const bytes = await downloadImage(image);
            checkDeadline();
            try {
                recognizer ??= await createImageRecognizer(wasm, async () => {
                    const response = await assets.fetch(new Request('https://assets/ocr/jpn.traineddata.gz', { signal: AbortSignal.timeout(15000) }));
                    if (!response.ok || !response.body) throw new Error('OCR language model unavailable.');
                    const compressed = await response.arrayBuffer();
                    if (compressed.byteLength > 3 * 1024 * 1024) throw new Error('OCR language model is too large.');
                    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
                    const reader = stream.getReader();
                    const chunks: Uint8Array[] = [];
                    let length = 0;
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            length += value.length;
                            if (length > 8 * 1024 * 1024) throw new Error('OCR language model is too large.');
                            chunks.push(value);
                        }
                    } finally { await reader.cancel().catch(() => {}); }
                    const language = new Uint8Array(length);
                    let offset = 0;
                    for (const chunk of chunks) { language.set(chunk, offset); offset += chunk.length; }
                    return language;
                });
                const result = await recognizer.recognize(bytes);
                // Yield after synchronous WASM so the Workers clock and cancellation can advance.
                await new Promise(resolve => setTimeout(resolve, 0));
                checkDeadline();
                return result;
            } catch (error) {
                if (!(error instanceof DiscordInputError)) {
                    try { recognizer?.dispose(); } catch {}
                    recognizer = undefined;
                    throw new DiscordInputError(OCR_INPUT_ERROR);
                }
                throw error;
            }
        });
        pending = job.then(() => {}, () => {});
        return job;
    };
}
