import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import tesseractWasm from 'tesseract.js-core/tesseract-core-simd-lstm.wasm';
import { buildDiscordRankResult } from '../src/discord-card.ts';
import { calculateRanks } from '../worker/local-ranks.ts';
import { createImageRecognizer } from '../worker/ocr.ts';
import { createRankImageRenderer } from '../worker/rank-image.ts';

interface Env {
    ASSETS: { fetch(request: Request): Promise<Response> };
}

async function assetBytes(assets: Env['ASSETS'], path: string) {
    const response = await assets.fetch(new Request(`https://assets${path}`));
    if (!response.ok) throw new Error('Smoke asset unavailable.');
    return new Uint8Array(await response.arrayBuffer());
}

async function decompressLanguage(compressed: Uint8Array) {
    const source = new Blob([new Uint8Array(compressed).buffer]).stream();
    const response = new Response(source.pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await response.arrayBuffer());
}

export default {
    async fetch(_request: Request, env: Env) {
        const recognizer = await createImageRecognizer(tesseractWasm, async () => {
            const compressed = await assetBytes(env.ASSETS, '/ocr/jpn.traineddata.gz');
            return decompressLanguage(compressed);
        });
        try {
            const screenshot = await assetBytes(env.ASSETS, '/smoke/kota-ocr-input.png');
            const recognition = await recognizer.recognize(screenshot);
            const requests = 'candidateIds' in recognition
                ? recognition.candidateIds.map(pokemonId => ({ pokemonId, ivs: recognition.ivs }))
                : [recognition];
            const results = requests.map(request => calculateRanks(request));
            const result = buildDiscordRankResult(
                { ...results[0], rows: results.flatMap(response => response.rows) },
                requests.map(request => request.pokemonId),
            );
            const render = createRankImageRenderer(resvgWasm, async () => {
                const [regular, bold] = await Promise.all([
                    assetBytes(env.ASSETS, '/fonts/BIZUDPGothic-Regular.ttf'),
                    assetBytes(env.ASSETS, '/fonts/BIZUDPGothic-Bold.ttf'),
                ]);
                return { regular, bold };
            });
            const png = await render(result.card);
            return new Response(new Uint8Array(png).buffer, {
                headers: {
                    'Content-Type': 'image/png',
                    'X-Pokemon-Ids': requests.map(request => request.pokemonId).join(','),
                    'X-IVs': recognition.ivs.join('/'),
                    'X-OCR-Memory-Bytes': String(recognizer.memoryBytes),
                },
            });
        } finally { recognizer.dispose(); }
    },
};
