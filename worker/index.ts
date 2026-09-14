import { handleRequest } from './handler.ts';
import { calculateRanks } from './local-ranks.ts';
import { discordImageResult } from './discord-browser.ts';
import { DiscordInputError, type DiscordImage } from './discord.ts';
import wasm from 'tesseract.js-core/tesseract-core-simd-lstm.wasm';
import { createDiscordScanner } from './discord-scanner.ts';
export { DiscordGateway } from './discord-gateway.ts';

export interface Env {
    RANK_BROWSER: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
    ASSETS: { fetch(request: Request): Promise<Response> };
    APP_PASSWORD?: string;
    DISCORD_GATEWAY: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
    APP_ORIGIN: string;
}

declare const caches: CacheStorage & { default: Cache };

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        try {
            if (new URL(request.url).pathname.startsWith('/api/bot/')) return await env.DISCORD_GATEWAY.getByName('discord').fetch(request);
            return await env.RANK_BROWSER.getByName('rank').fetch(request);
        } catch {
            return Response.json({ error: '順位を取得できませんでした。時間をおいて再度お試しください。' }, {
                status: 503,
                headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
            });
        }
    },
};

// ponytail: Preserve the deployed Durable Object class name and its namespace.
export class RankBrowser {
    private env: Env;
    private scan: ReturnType<typeof createDiscordScanner>;

    constructor(_state: unknown, env: Env) {
        this.env = env;
        this.scan = createDiscordScanner(wasm, env.ASSETS);
    }

    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/internal/discord-image' && request.method === 'POST') {
            const input = await request.json() as DiscordImage;
            if (input.channelId !== this.env.DISCORD_CHANNEL_ID) return new Response(null, { status: 403 });
            try {
                const content = await discordImageResult(input, image => this.scan(image, request.signal), async values => {
                    if (request.signal.aborted) throw new Error('Request expired.');
                    return calculateRanks(values);
                });
                return Response.json({ content });
            } catch (error) {
                return Response.json({ content: error instanceof DiscordInputError ? error.message : '画像の読み取りか順位の計算に失敗しました。時間をおいて再投稿してください。' });
            }
        }
        return handleRequest(request, this.env, async (_pokemon, input) => calculateRanks(input, [50, 40, 51]), caches.default);
    }
}
