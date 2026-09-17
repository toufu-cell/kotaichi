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
}

export default {
    fetch(request: Request, env: Env): Promise<Response> {
        return handleRequest(request, env);
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
        if (new URL(request.url).pathname !== '/internal/discord-image' || request.method !== 'POST') {
            return new Response(null, { status: 404 });
        }
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
}
