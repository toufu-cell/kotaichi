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
        assert.match(reply, /チョロネコ｜1 \/ 4 \/ 15/);
        assert.match(reply, /スーパー：457位 \/ CP1498/);
    } else {
        assert.match(reply, /デルビル｜8 \/ 3 \/ 11/);
        assert.match(reply, /スーパー：1,654位 \/ CP1495/);
    }
    assert.ok(reply.length <= 2000);
    console.log(reply);
} finally { globalThis.fetch = originalFetch; }
