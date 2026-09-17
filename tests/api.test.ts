import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/handler.ts';

test('Public Worker forwards only the three bot management paths', async () => {
    const forwarded: string[] = [];
    const env = {
        DISCORD_GATEWAY: {
            getByName(name: string) {
                assert.equal(name, 'discord');
                return {
                    fetch: async (request: Request) => {
                        forwarded.push(`${request.method} ${new URL(request.url).pathname}`);
                        return new Response('gateway');
                    },
                };
            },
        },
    };

    for (const [path, method] of [
        ['/api/bot/start', 'POST'],
        ['/api/bot/stop', 'POST'],
        ['/api/bot/status?detail=1', 'GET'],
    ] as const) {
        const response = await handleRequest(new Request(`https://app.example${path}`, { method }), env);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'gateway');
    }
    assert.deepEqual(forwarded, [
        'POST /api/bot/start',
        'POST /api/bot/stop',
        'GET /api/bot/status',
    ]);
});

test('Public Worker returns 404 without invoking internal image analysis or static assets', async () => {
    let forwarded = false;
    const env = {
        DISCORD_GATEWAY: {
            getByName() {
                forwarded = true;
                return { fetch: async () => new Response('unexpected') };
            },
        },
    };
    for (const path of [
        '/',
        '/index.html',
        '/ocr/jpn.traineddata.gz',
        '/fonts/BIZUDPGothic-Regular.ttf',
        '/api/rank',
        '/internal/discord-image',
        '/internal/discord-rank-image',
        '/api/bot',
        '/api/bot/start/',
        '/api/bot/restart',
    ]) {
        const response = await handleRequest(new Request(`https://app.example${path}`, { method: 'POST' }), env);
        assert.equal(response.status, 404, path);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(forwarded, false);
});
