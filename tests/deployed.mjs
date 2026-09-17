import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const baseURL = process.env.APP_URL || 'http://127.0.0.1:4275';
const secretFile = process.env.APP_SECRET_FILE || '.dev.vars';
const secret = (await readFile(secretFile, 'utf8')).match(/^APP_PASSWORD="([^"]+)"$/m)?.[1];
if (!secret) throw new Error('APP_PASSWORD is missing from the secret file.');
const headers = { Authorization: `Bearer ${secret}` };

try {
    for (const action of ['start', 'stop', 'status']) {
        const response = await fetch(new URL(`/api/bot/${action}`, baseURL), {
            method: action === 'status' ? 'GET' : 'POST',
        });
        assert.equal(response.status, 401, action);
    }
    const wrongOrigin = await fetch(new URL('/api/bot/status', baseURL), {
        headers: { ...headers, Origin: 'https://example.invalid' },
    });
    assert.equal(wrongOrigin.status, 403);

    const statusResponse = await fetch(new URL('/api/bot/status', baseURL), { headers });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    for (const key of ['enabled', 'connected', 'queued', 'issue', 'uncertainReplies', 'rejectedMessages']) {
        assert.ok(Object.hasOwn(status, key), key);
    }

    for (const path of ['/', '/index.html', '/ocr/jpn.traineddata.gz', '/fonts/BIZUDPGothic-Regular.ttf', '/internal/discord-image', '/internal/discord-rank-image', '/api/rank', '/api/bot/start/']) {
        const response = await fetch(new URL(path, baseURL), {
            method: path === '/internal/discord-image' ? 'POST' : 'GET',
            headers,
        });
        assert.equal(response.status, 404, path);
    }
    console.log('Bot management authentication, status, and public route checks passed.');
} catch (error) {
    console.error(String(error).replaceAll(secret, '[REDACTED]'));
    process.exitCode = 1;
}
