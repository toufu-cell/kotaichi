import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createImageRecognizer } from '../worker/ocr.ts';
import { createDiscordScanner } from '../worker/discord-scanner.ts';
import { discordImageResult } from '../worker/discord-browser.ts';
import { DiscordInputError } from '../worker/discord.ts';
import { calculateRanks } from '../worker/local-ranks.ts';

test('Browserless OCR reads images, rejects uncertain input and recovers before starting lookup', async () => {
    const browser = await chromium.launch();
    let fixtures: Record<string, Buffer>;
    try {
        const page = await browser.newPage();
        const encoded = await page.evaluate(() => {
            const images: Record<string, string> = {};
            const canvas = document.createElement('canvas');
            canvas.width = 1206; canvas.height = 2605;
            const ctx = canvas.getContext('2d')!;
            ctx.scale(1.206, 1.206);
            for (const name of ['デルビル', 'ロコン', 'キノココデルビル']) {
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 2160);
                ctx.fillStyle = '#426b6d'; ctx.font = '60px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(name, 500, 935);
                ctx.fillStyle = '#71e7b0'; ctx.fillRect(250, 980, 500, 12);
                [8, 3, 11].forEach((value, row) => {
                    const y = 1640 + row * 90;
                    ctx.fillStyle = '#e3e3e5'; ctx.fillRect(120, y, 345, 18);
                    ctx.fillStyle = '#f7a349'; ctx.fillRect(120, y, 345 * value / 15, 18);
                    ctx.fillStyle = '#fff';
                    for (const x of [235, 350]) ctx.fillRect(x - 2, y, 4, 18);
                });
                for (const format of ['png', 'jpeg', 'webp']) images[`${name}-${format}`] = canvas.toDataURL(`image/${format}`, 0.95).split(',')[1];
            }
            canvas.width = 3000; canvas.height = 3000;
            images.oversize = canvas.toDataURL().split(',')[1];
            return images;
        });
        fixtures = Object.fromEntries(Object.entries(encoded).map(([name, value]) => [name, Buffer.from(value, 'base64')]));
    } finally { await browser.close(); }
    const wasm = await WebAssembly.compile(await readFile(new URL('../node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', import.meta.url)));
    const compressed = await readFile(new URL('../dist/ocr/jpn.traineddata.gz', import.meta.url));
    const recognizer = await createImageRecognizer(wasm, async () => gunzipSync(compressed));
    const expected = { pokemonId: 'houndour', ivs: [8, 3, 11] };
    try {
        for (const format of ['png', 'jpeg', 'webp']) assert.deepEqual(await recognizer.recognize(fixtures[`デルビル-${format}`]), expected);
        assert.deepEqual(await recognizer.recognize(fixtures['ロコン-png']), { candidateIds: ['vulpix', 'vulpix_alolan'], ivs: [8, 3, 11] });
        for (const bytes of [Buffer.from('broken'), fixtures.oversize, fixtures['キノココデルビル-png']]) {
            await assert.rejects(recognizer.recognize(bytes), DiscordInputError);
            assert.deepEqual(await recognizer.recognize(fixtures['デルビル-png']), expected);
        }
        const warmMemory = recognizer.memoryBytes;
        for (let i = 0; i < 5; i++) assert.deepEqual(await recognizer.recognize(fixtures['デルビル-png']), expected);
        assert.equal(recognizer.memoryBytes, warmMemory);
    } finally { recognizer.dispose(); }

    const image = { id: '123456789012345678', channelId: '223456789012345678', url: 'https://cdn.discordapp.com/attachments/223456789012345678/123456789012345678/test.png', mime: 'image/png', size: fixtures['デルビル-png'].length, caption: '' };
    const originalFetch = globalThis.fetch;
    let bytes: Buffer = fixtures['デルビル-png'];
    let modelAttempts = 0;
    const scan = createDiscordScanner(wasm, { fetch: async () => ++modelAttempts === 1 ? new Response(null, { status: 503 }) : new Response(compressed) });
    globalThis.fetch = async () => new Response(bytes);
    const signal = new AbortController().signal;
    const lookup = async () => { assert.fail('Failed recognition must not start a browser lookup.'); };
    try {
        assert.deepEqual(await scan({ ...image, caption: 'デルビル 8/3/11' }, signal), expected);
        assert.equal(modelAttempts, 0);
        await assert.rejects(discordImageResult(image, input => scan(input, signal), lookup), error => error instanceof DiscordInputError && /ポケモン名、空白/.test(error.message));
        assert.deepEqual(await scan(image, signal), expected);
        bytes = Buffer.from('broken');
        await assert.rejects(discordImageResult(image, input => scan(input, signal), lookup), DiscordInputError);
        bytes = fixtures['デルビル-png'];
        const jobs = await Promise.all([scan(image, signal), scan(image, signal)]);
        assert.deepEqual(jobs, [expected, expected]);
        bytes = fixtures['ロコン-png'];
        const forms = await discordImageResult(image, input => scan(input, signal), async input => calculateRanks(input));
        assert.match(forms, /^ロコン（フォルム未確定）｜8 \/ 3 \/ 11/);
        for (const name of ['ロコン', 'ロコン（アローラ）']) assert.ok(forms.includes(`${name}（フォルム候補）`));
        for (const name of ['キュウコン', 'キュウコン（アローラ）']) assert.ok(forms.includes(`${name}（進化候補）`));
        assert.ok(forms.indexOf('ロコン（アローラ）（フォルム候補）') < forms.indexOf('キュウコン（進化候補）'));
        assert.ok(forms.length <= 2000);
        const selected = await discordImageResult({ ...image, caption: 'ロコン（アローラ） 8/3/11' }, input => scan(input, signal), async input => calculateRanks(input));
        assert.match(selected, /^ロコン（アローラ）｜/);
        assert.doesNotMatch(selected, /フォルム未確定|キュウコン（進化候補）/);
        await assert.rejects(discordImageResult(image, input => scan(input, signal, 0), lookup), DiscordInputError);
        await assert.rejects(discordImageResult(image, input => scan(input, AbortSignal.abort()), lookup), DiscordInputError);
        let entered!: () => void;
        const loading = new Promise<void>(resolve => { entered = resolve; });
        let release!: (response: Response) => void;
        const model = new Promise<Response>(resolve => { release = resolve; });
        const delayedScan = createDiscordScanner(wasm, { fetch: async () => { entered(); return model; } });
        const controller = new AbortController();
        const cancelled = assert.rejects(discordImageResult(image, input => delayedScan(input, controller.signal), lookup), DiscordInputError);
        await loading;
        controller.abort();
        release(new Response(compressed));
        await cancelled;
    } finally { globalThis.fetch = originalFetch; }
});
