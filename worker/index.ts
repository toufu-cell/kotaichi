import { handleRequest } from './handler.ts';
import { calculateRanks } from './local-ranks.ts';
import { discordImageResult } from './discord-browser.ts';
import { DiscordInputError, type DiscordImage } from './discord.ts';
import type { RankCardData } from '../src/discord-card.ts';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import wasm from 'tesseract.js-core/tesseract-core-simd-lstm.wasm';
import { createDiscordScanner } from './discord-scanner.ts';
import { createRankImageRenderer } from './rank-image.ts';
export { DiscordGateway } from './discord-gateway.ts';

export interface Env {
    RANK_BROWSER: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
    ASSETS: { fetch(request: Request): Promise<Response> };
    APP_PASSWORD?: string;
    DISCORD_GATEWAY: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
}

export default {
    fetch(request: Request, env: Env): Promise<Response> {
        return handleRequest(request, env);
    },
};

async function assetBytes(assets: Env['ASSETS'], path: string) {
    const response = await assets.fetch(new Request(`https://assets${path}`, { signal: AbortSignal.timeout(15000) }));
    if (!response.ok) throw new Error('Image asset unavailable.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) throw new Error('Invalid image asset.');
    return bytes;
}

// ponytail: Preserve the deployed Durable Object class name and its namespace.
export class RankBrowser {
    private env: Env;
    private scan: ReturnType<typeof createDiscordScanner>;
    private renderRankImage: ReturnType<typeof createRankImageRenderer>;

    constructor(_state: unknown, env: Env) {
        this.env = env;
        this.scan = createDiscordScanner(wasm, env.ASSETS);
        this.renderRankImage = createRankImageRenderer(resvgWasm, async () => {
            const [regular, bold] = await Promise.all([
                assetBytes(env.ASSETS, '/fonts/BIZUDPGothic-Regular.ttf'),
                assetBytes(env.ASSETS, '/fonts/BIZUDPGothic-Bold.ttf'),
            ]);
            return { regular, bold };
        });
    }

    async fetch(request: Request): Promise<Response> {
        const path = new URL(request.url).pathname;
        if (!['/internal/discord-image', '/internal/discord-rank-image'].includes(path) || request.method !== 'POST') {
            return new Response(null, { status: 404 });
        }
        const input = await request.json().catch(() => null) as ({ channelId?: string; card?: RankCardData } & Partial<DiscordImage>) | null;
        if (!input) return new Response(null, { status: 400 });
        if (input.channelId !== this.env.DISCORD_CHANNEL_ID) return new Response(null, { status: 403 });
        if (path === '/internal/discord-rank-image') {
            if (!input.card) return new Response(null, { status: 400 });
            try {
                const png = await this.renderRankImage(input.card);
                return new Response(new Uint8Array(png).buffer, {
                    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
                });
            } catch {
                return new Response(null, { status: 500 });
            }
        }
        try {
            const result = await discordImageResult(input as DiscordImage, image => this.scan(image, request.signal), async values => {
                if (request.signal.aborted) throw new Error('Request expired.');
                return calculateRanks(values);
            });
            return Response.json(result);
        } catch (error) {
            return Response.json({ content: error instanceof DiscordInputError ? error.message : '画像の読み取りか順位の計算に失敗しました。時間をおいて再投稿してください。' });
        }
    }
}
