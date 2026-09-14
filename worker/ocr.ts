import createCore from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import { detectBars, matchNames, nameRectangle } from '../src/detection.ts';
import data from '../src/data/pokemon.json' with { type: 'json' };
import { DiscordInputError, MAX_IMAGE_BYTES } from './discord.ts';
import type { RankRequest } from '../src/api.ts';
import type { IVs } from '../src/ranking.ts';

export type ImageRecognition = RankRequest | { candidateIds: string[]; ivs: IVs };

export const OCR_INPUT_ERROR = '名前か個体値を特定できませんでした。ポケモン名、空白、8/3/11の順で本文を付けて再投稿してください。';
const MAX_PIXELS = 8_000_000;

function resize(pixels: { data: Uint8ClampedArray; width: number; height: number }) {
    if (pixels.width <= 1000) return pixels;
    const width = 1000;
    const height = Math.round(pixels.height * width / pixels.width);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = (y + 0.5) * pixels.height / height - 0.5;
        for (let x = 0; x < width; x++) {
            const sx = (x + 0.5) * pixels.width / width - 0.5;
            for (let channel = 0; channel < 3; channel++) {
                let value = 0;
                for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
                    const index = (Math.min(pixels.height - 1, Math.floor(sy) + dy) * pixels.width + Math.min(pixels.width - 1, Math.floor(sx) + dx)) * 4 + channel;
                    value += pixels.data[index] * (dx ? sx % 1 : 1 - sx % 1) * (dy ? sy % 1 : 1 - sy % 1);
                }
                data[(y * width + x) * 4 + channel] = value;
            }
            data[(y * width + x) * 4 + 3] = 255;
        }
    }
    return { data, width, height };
}

// ponytail: Tesseract.js Core 7.0.0の公開ラッパーとLeptonicaのABIを使用。更新時は実画像とメモリ解放を検証する。
export async function createImageRecognizer(wasm: WebAssembly.Module, loadLanguage: () => Promise<Uint8Array>) {
    let memory!: WebAssembly.Memory;
    const core = await createCore({
        instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
            const instance = new WebAssembly.Instance(wasm, imports);
            memory = Object.values(instance.exports).find(value => value instanceof WebAssembly.Memory) as WebAssembly.Memory;
            receive(instance);
            return instance.exports;
        },
        print() {}, printErr() {},
    });
    let initialized = false;
    const api = new core.TessBaseAPI();

    function decode(bytes: Uint8Array) {
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new DiscordInputError('画像は8MB以下で送ってください。');
        const pointer = core._malloc(bytes.length);
        const header = core._malloc(24);
        let pixPointer = 0;
        let colormapPointer = 0;
        try {
            new Uint8Array(memory.buffer).set(bytes, pointer);
            if (core._pixReadHeaderMem(pointer, bytes.length, header, header + 4, header + 8, header + 12, header + 16, header + 20)) throw new DiscordInputError('画像を開けませんでした。PNG・JPEGのスクリーンショットを送ってください。');
            const originalWidth = core.getValue(header + 4, 'i32');
            const originalHeight = core.getValue(header + 8, 'i32');
            if (originalWidth < 250 || originalHeight < 400 || originalWidth * originalHeight > MAX_PIXELS) throw new DiscordInputError('画像の大きさに対応していません。800万画素以下のスクリーンショットを送ってください。');
            pixPointer = core._pixReadMem(pointer, bytes.length);
            if (!pixPointer) throw new DiscordInputError(OCR_INPUT_ERROR);
            const pix = core.wrapPointer(pixPointer, core.Pix);
            if (pix.get_w() !== originalWidth || pix.get_h() !== originalHeight) throw new DiscordInputError(OCR_INPUT_ERROR);
            const depth = pix.get_d();
            if (![1, 2, 4, 8, 16, 32].includes(depth)) throw new DiscordInputError(OCR_INPUT_ERROR);
            const width = originalWidth;
            const height = originalHeight;
            const pixels = new Uint8ClampedArray(width * height * 4);
            const words = new Uint32Array(memory.buffer);
            const rgba = new Uint8Array(memory.buffer);
            const base = pix.get_data() / 4;
            const stride = pix.get_wpl();
            const colormap = pix.get_colormap();
            const palette = core.getPointer(colormap) ? colormap.get_array() : 0;
            const paletteLength = palette ? colormap.get_n() : 0;
            colormapPointer = core.getPointer(colormap);
            const hasAlpha = pix.get_spp() === 4;
            for (let y = 0; y < height; y++) {
                const row = base + y * stride;
                for (let x = 0; x < width; x++) {
                    const word = words[row + Math.floor(x * depth / 32)];
                    const value = depth === 32 ? word : (word >>> (32 - depth - (x * depth % 32))) & (2 ** depth - 1);
                    const out = (y * width + x) * 4;
                    if (palette) {
                        if (value >= paletteLength) throw new DiscordInputError(OCR_INPUT_ERROR);
                        pixels[out] = rgba[palette + value * 4];
                        pixels[out + 1] = rgba[palette + value * 4 + 1];
                        pixels[out + 2] = rgba[palette + value * 4 + 2];
                    } else if (depth === 32) {
                        const alpha = hasAlpha ? (value & 255) / 255 : 1;
                        pixels[out] = (value >>> 24) * alpha + 255 * (1 - alpha);
                        pixels[out + 1] = ((value >>> 16) & 255) * alpha + 255 * (1 - alpha);
                        pixels[out + 2] = ((value >>> 8) & 255) * alpha + 255 * (1 - alpha);
                    } else {
                        const gray = depth === 1 ? (1 - value) * 255 : value * 255 / (2 ** depth - 1);
                        pixels[out] = gray; pixels[out + 1] = gray; pixels[out + 2] = gray;
                    }
                    pixels[out + 3] = 255;
                }
            }
            return { data: pixels, width, height };
        } finally {
            if (pixPointer) {
                core.setValue(header, pixPointer, '*'); core._pixDestroy(header);
                delete core.getCache(core.Pix)[pixPointer];
            }
            if (colormapPointer) delete core.getCache(core.PixColormap)[colormapPointer];
            core._free(header);
            core._free(pointer);
        }
    }

    return {
        get memoryBytes() { return memory.buffer.byteLength; },
        async recognize(bytes: Uint8Array): Promise<ImageRecognition> {
            const pixels = resize(decode(bytes));
            const detection = detectBars(pixels);
            if (!detection) throw new DiscordInputError(OCR_INPUT_ERROR);
            const rectangle = nameRectangle(pixels);
            if (!initialized) {
                const language = await loadLanguage();
                core.FS.writeFile('/jpn.traineddata', language);
                try {
                    if (api.Init('/', 'jpn', 1)) throw new Error('OCR initialization failed.');
                    initialized = true;
                    api.SetPageSegMode(7);
                } finally { core.FS.unlink('/jpn.traineddata'); }
            }
            // Retry at native size only when enlarged text has no matching name.
            for (const scale of [2, 1]) {
                const width = rectangle.width * scale;
                const height = rectangle.height * scale;
                const crop = new Uint8Array(width * height * 4);
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const sx = Math.max(0, Math.min(rectangle.width - 1, (x + 0.5) / scale - 0.5));
                        const sy = Math.max(0, Math.min(rectangle.height - 1, (y + 0.5) / scale - 0.5));
                        let gray = 0;
                        for (let dy = 0; dy < 2; dy++) {
                            for (let dx = 0; dx < 2; dx++) {
                                const input = ((rectangle.top + Math.min(rectangle.height - 1, Math.floor(sy) + dy)) * pixels.width + rectangle.left + Math.min(rectangle.width - 1, Math.floor(sx) + dx)) * 4;
                                const weight = (dx ? sx % 1 : 1 - sx % 1) * (dy ? sy % 1 : 1 - sy % 1);
                                gray += (pixels.data[input] * 0.299 + pixels.data[input + 1] * 0.587 + pixels.data[input + 2] * 0.114) * weight;
                            }
                        }
                        const offset = (y * width + x) * 4;
                        crop[offset] = gray < 175 ? 0 : 255;
                        crop[offset + 1] = crop[offset]; crop[offset + 2] = crop[offset]; crop[offset + 3] = 255;
                    }
                }
                const pointer = core._malloc(crop.length);
                try {
                    new Uint8Array(memory.buffer).set(crop, pointer);
                    api.SetImage(pointer, width, height, 4, width * 4);
                    api.SetSourceResolution(96);
                    if (api.Recognize(null)) throw new Error('OCR recognition failed.');
                    const text = api.GetUTF8Text();
                    const candidates = matchNames(text, data.pokemon);
                    if (candidates.length > 1) {
                        if (!candidates.every(candidate => candidate.name === candidates[0].name)) throw new DiscordInputError(OCR_INPUT_ERROR);
                        return { candidateIds: candidates.map(candidate => candidate.id), ivs: detection.ivs };
                    }
                    if (candidates.length === 1) return { pokemonId: candidates[0].id, ivs: detection.ivs };
                } finally { api.Clear(); core._free(pointer); }
            }
            throw new DiscordInputError(OCR_INPUT_ERROR);
        },
        dispose() { api.End(); core.destroy(api); },
    };
}
