import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { buildDiscordRankResult } from '../src/discord-card.ts';
import { calculateRanks } from '../worker/local-ranks.ts';
import { createRankImageRenderer } from '../worker/rank-image.ts';

const [wasmBytes, regular, bold] = await Promise.all([
    readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'),
    readFile('dist/fonts/BIZUDPGothic-Regular.ttf'),
    readFile('dist/fonts/BIZUDPGothic-Bold.ttf'),
]);
const render = createRankImageRenderer(await WebAssembly.compile(wasmBytes), async () => ({ regular, bold }));
const examples = [
    {
        filename: 'eevee-branches.png',
        card: buildDiscordRankResult(
            calculateRanks({ pokemonId: 'eevee', ivs: [0, 15, 15] }),
            undefined,
            { position: 1, total: 2 },
        ).card,
    },
    {
        filename: 'geodude-forms.png',
        card: (() => {
            const ids = ['geodude', 'geodude_alolan'];
            const results = ids.map(pokemonId => calculateRanks({ pokemonId, ivs: [0, 15, 15] }));
            return buildDiscordRankResult(
                { ...results[0], rows: results.flatMap(result => result.rows) },
                ids,
                { position: 2, total: 2 },
            ).card;
        })(),
    },
];

await mkdir('artifacts', { recursive: true });
for (const example of examples) {
    const started = performance.now();
    const png = await render(example.card);
    await writeFile(`artifacts/${example.filename}`, png);
    console.log(`${example.filename}: ${Math.round(performance.now() - started)} ms, ${png.length} bytes`);
}
