import data from '../src/data/pokemon.json' with { type: 'json' };
import type { RankRequest, RankResponse } from '../src/api.ts';
import { validateIVs, type Pokemon } from '../src/ranking.ts';
import { authorized } from './auth.ts';

interface Environment {
    APP_PASSWORD?: string;
    ASSETS: { fetch(request: Request): Promise<Response> };
}

export type Lookup = (pokemon: Pokemon, request: RankRequest) => Promise<RankResponse>;
type ResultCache = Pick<Cache, 'match' | 'put'>;

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function handleRequest(request: Request, env: Environment, lookup: Lookup, cache: ResultCache): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname !== '/api/rank') return json({ error: 'ページが見つかりません。' }, 404);
    if (request.method !== 'POST') return json({ error: 'POSTで送信してください。' }, 405);
    if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 16) return json({ error: '順位取得の準備ができていません。管理者が利用コードを設定する必要があります。' }, 503);
    if (!await authorized(request, env.APP_PASSWORD)) return json({ error: '利用コードを確認してください。' }, 401);
    if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return json({ error: 'このアプリの画面から操作してください。' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'JSONで送信してください。' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'ポケモンと個体値を入力してください。' }, 400);
    let text = '';
    let size = 0;
    const decoder = new TextDecoder();
    let input: RankRequest;
    let pokemon: Pokemon | undefined;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024) { await reader.cancel(); return json({ error: '送信内容が大きすぎます。画像の送信には対応していません。' }, 413); }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).sort().join(',') !== 'ivs,pokemonId'
            || typeof parsed.pokemonId !== 'string' || !Array.isArray(parsed.ivs)) throw new Error();
        validateIVs(parsed.ivs);
        pokemon = data.pokemon.find(entry => entry.id === parsed.pokemonId);
        if (!pokemon) throw new Error();
        input = { pokemonId: pokemon.id, ivs: parsed.ivs };
    } catch { return json({ error: '候補のポケモンと0〜15の個体値を指定してください。' }, 400); }
    const cacheKey = new Request(`${url.origin}/cache/local-v1/${data.pvpCommit}-${data.namesCommit}/${input.pokemonId}/${input.ivs.join('-')}`);
    try {
        const cached = await cache.match(cacheKey);
        if (cached) return json(await cached.json());
    } catch { /* A failed cache read must not prevent a fresh lookup. */ }
    try {
        const result = await lookup(pokemon, input);
        await cache.put(cacheKey, Response.json(result, { headers: { 'Cache-Control': 'public, max-age=86400' } })).catch(() => {});
        return json(result);
    } catch {
        return json({ error: '順位を計算できませんでした。時間をおいて再度お試しください。' }, 503);
    }
}
