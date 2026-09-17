import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discordImageResult } from '../worker/discord-browser.ts';
import { createDiscordScanner } from '../worker/discord-scanner.ts';
import { calculateRanks } from '../worker/local-ranks.ts';

const path = process.argv[2];
if (!path) throw new Error('Pass the Houndour screenshot path.');
const bytes = await readFile(path);
const url = 'https://cdn.discordapp.com/attachments/123456789012345678/223456789012345678/appraisal.png';
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => String(input) === url ? Promise.resolve(new Response(bytes)) : originalFetch(input, options);
const wasm = await WebAssembly.compile(await readFile(new URL('../node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', import.meta.url)));
const language = await readFile(new URL('../dist/ocr/jpn.traineddata.gz', import.meta.url));
const scan = createDiscordScanner(wasm, { fetch: async () => new Response(language) });
try {
    const reply = await discordImageResult({
        id: '323456789012345678', channelId: '123456789012345678', url, size: bytes.length, mime: 'image/png', caption: '',
    }, image => scan(image, new AbortController().signal), async input => calculateRanks(input));
    if (process.argv[3] === 'purrloin') {
        assert.match(reply.content, /チョロネコ｜個体値 1 \/ 4 \/ 15/);
        const liepard = reply.card.rows.find(row => row.name === 'レパルダス');
        assert.ok(liepard);
        assert.deepEqual(liepard.leagues[0], { rank: 457, cp: 1498, level: 34 });
    } else {
        assert.match(reply.content, /デルビル｜個体値 8 \/ 3 \/ 11/);
        const houndoom = reply.card.rows.find(row => row.name === 'ヘルガー');
        assert.ok(houndoom);
        assert.deepEqual(houndoom.leagues[0], { rank: 1654, cp: 1495, level: 21.5 });
    }
    assert.ok(reply.content.length < 100);
    console.log(reply.content);
} finally { globalThis.fetch = originalFetch; }
