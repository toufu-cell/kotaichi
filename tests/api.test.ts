import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/handler.ts';
import data from '../src/data/pokemon.json' with { type: 'json' };
import type { RankResponse } from '../src/api.ts';

const password = 'test-only-access-code';
const input = { pokemonId: 'houndour', ivs: [8, 3, 11] };
const env = { APP_PASSWORD: password, ASSETS: { fetch: async () => new Response('static') } };
const response: RankResponse = { request: { pokemonId: 'houndour', ivs: [8, 3, 11] }, sourceId: '1391', fetchedAt: '2026-09-13T00:00:00.000Z', rows: [] };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request('https://app.example/api/rank', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}`, ...headers }, body: JSON.stringify(body),
});
function memoryCache() {
    const values = new Map<string, Response>();
    return { match: async (key: RequestInfo | URL) => values.get((key as Request).url)?.clone(), put: async (key: RequestInfo | URL, value: Response) => { values.set((key as Request).url, value.clone()); } };
}

test('API rejects unauthorized and malformed requests before calculating ranks', async () => {
    const noCalculation = async () => { assert.fail('Rejected input must not calculate ranks.'); };
    const cache = memoryCache();
    assert.equal((await handleRequest(request(), { ...env, APP_PASSWORD: undefined }, noCalculation, cache)).status, 503);
    assert.equal((await handleRequest(request(), { ...env, APP_PASSWORD: 'short' }, noCalculation, cache)).status, 503);
    assert.equal((await handleRequest(request(input, { Authorization: '' }), env, noCalculation, cache)).status, 401);
    assert.equal((await handleRequest(request(input, { Origin: 'https://other.example' }), env, noCalculation, cache)).status, 403);
    for (const body of [null, {}, { ...input, ivs: [16, 3, 11] }, { ...input, ivs: ['8', 3, 11] }, { ...input, ivs: [8, 3] }, { ...input, pokemonId: 'missing' }, { ...input, url: 'http://localhost' }]) {
        assert.equal((await handleRequest(request(body), env, noCalculation, cache)).status, 400);
    }
    assert.equal((await handleRequest(request('x'.repeat(1100)), env, noCalculation, cache)).status, 413);
    assert.equal((await handleRequest(request(input, { 'Content-Type': 'text/plain' }), env, noCalculation, cache)).status, 415);
    assert.equal((await handleRequest(new Request('https://app.example/api/rank'), env, noCalculation, cache)).status, 405);
});

test('API reuses authenticated results and keeps secrets out of responses and cache keys', async () => {
    const cache = memoryCache();
    for (const prefix of ['rank-v1', 'gamewith-v1', 'local-v1/old-data']) {
        await cache.put(new Request(`https://app.example/cache/${prefix}/houndour/8-3-11`), Response.json({ oldSource: true }));
    }
    const lookup = async (pokemon, received) => {
        assert.equal(pokemon.label, 'デルビル');
        assert.deepEqual(received, input);
        return response;
    };
    const first = await handleRequest(request(), env, lookup, cache);
    assert.deepEqual(await first.json(), response);
    assert.ok(await cache.match(new Request(`https://app.example/cache/local-v1/${data.pvpCommit}-${data.namesCommit}/houndour/8-3-11`)));
    const cached = await handleRequest(request(), env, async () => { assert.fail('A cached request must not recalculate ranks.'); }, cache);
    assert.equal(cached.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await cached.json(), response);
    const rejected = await handleRequest(request(input, { Authorization: 'Bearer wrong' }), env, lookup, cache);
    assert.equal(rejected.status, 401);
});

test('API hides internal calculation errors', async () => {
    for (const [message, status] of [['secret from calculation', 503]] as const) {
        const result = await handleRequest(request(), env, async () => { throw new Error(message); }, memoryCache());
        assert.equal(result.status, status);
        const body = await result.json();
        assert.ok(body.error);
        assert.ok(!JSON.stringify(body).includes(message));
    }
});

test('API recovers from cache read, JSON and write failures', async () => {
    for (const failure of ['read', 'json', 'write']) {
        const cache = {
            match: async () => {
                if (failure === 'read') throw new Error('Cache unavailable');
                return failure === 'json' ? new Response('invalid JSON') : undefined;
            },
            put: async () => { throw new Error('Cache unavailable'); },
        };
        const result = await handleRequest(request(), env, async () => response, cache);
        assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), response);
    }
});
