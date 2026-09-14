import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const baseURL = process.env.APP_URL || 'http://127.0.0.1:4275';
const secretFile = process.env.APP_SECRET_FILE || '.dev.vars';
const samplePath = process.argv[2];
if (!samplePath) throw new Error('Pass the Houndour screenshot path as the first argument.');
const secret = (await readFile(secretFile, 'utf8')).match(/^APP_PASSWORD="([^"]+)"$/m)?.[1];
if (!secret) throw new Error('APP_PASSWORD is missing from the secret file.');
const endpoint = new URL('/api/rank', baseURL);
const purrloin = process.argv[3] === 'purrloin';
const input = purrloin ? { pokemonId: 'purrloin', ivs: [1, 4, 15] } : { pokemonId: 'houndour', ivs: [8, 3, 11] };
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };
await mkdir('artifacts', { recursive: true });

try {
    const unauthenticated = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    assert.equal(unauthenticated.status, 401);
    const invalid = await fetch(endpoint, {
        method: 'POST', headers, body: JSON.stringify({ ...input, ivs: [16, 3, 11] }),
    });
    assert.equal(invalid.status, 400);
    const wrongOrigin = await fetch(endpoint, {
        method: 'POST', headers: { ...headers, Origin: 'https://example.invalid' }, body: JSON.stringify(input),
    });
    assert.equal(wrongOrigin.status, 403);
    let fetchedAt;
    for (const browserType of [chromium, webkit]) {
        const browser = await browserType.launch();
        try {
            const context = await browser.newContext({
                viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
            });
            const page = await context.newPage();
            await page.goto(baseURL);
            await page.locator('#access-code').fill(secret);
            await page.locator('#image-file').setInputFiles(samplePath);
            await page.waitForFunction(() => !document.querySelector('#image-file').disabled, undefined, { timeout: 60000 });
            assert.equal(await page.locator('#pokemon').inputValue(), purrloin ? 'チョロネコ' : 'デルビル');
            assert.deepEqual(await Promise.all([0, 1, 2].map(i => page.locator(`#iv-${i}`).inputValue())), input.ivs.map(String));
            const responsePromise = page.waitForResponse(response => response.url() === endpoint.href, { timeout: 80000 });
            await page.locator('button[type=submit]').click();
            const response = await responsePromise;
            assert.equal(response.status(), 200);
            const result = await response.json();
            const rank = result.rows.find(row => row.name === (purrloin ? 'レパルダス' : 'ヘルガー') && row.cap === 1500 && row.maxLevel === 50);
            assert.equal(rank.rank, purrloin ? 457 : 1654);
            assert.equal(rank.cp, purrloin ? 1498 : 1495);
            if (fetchedAt) assert.equal(result.fetchedAt, fetchedAt);
            fetchedAt = result.fetchedAt;
            await page.waitForSelector('.result-card');
            assert.equal(await page.locator('.result-card').count(), 2);
            assert.match(await page.locator('.result-card').nth(1).innerText(), purrloin ? /457/ : /1,654/);
            assert.match(await page.locator('.result-card').nth(1).innerText(), purrloin ? /1,498/ : /1,495/);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.screenshot({ path: `artifacts/deployed-${browserType.name()}.png`, fullPage: true });
            console.log(`${browserType.name()}: live OCR, Worker, Durable Object and rank display passed.`);
        } finally { await browser.close(); }
    }
    console.log('Live access checks and cache timestamp reuse passed.');
} catch (error) {
    console.error(String(error).replaceAll(secret, '[REDACTED]'));
    process.exitCode = 1;
}
