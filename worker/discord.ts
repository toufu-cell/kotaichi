import data from '../src/data/pokemon.json' with { type: 'json' };
import type { RankCardData } from '../src/discord-card.ts';
import { validateIVs, type IVs } from '../src/ranking.ts';

export interface DiscordImage {
    id: string;
    channelId: string;
    url: string;
    mime: string;
    size: number;
    caption: string;
    position?: number;
    total?: number;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const SNOWFLAKE = /^\d{17,20}$/;
export class DiscordInputError extends Error {}

export function attachmentURL(value: string) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
        || url.username || url.password || url.port || !/^\/attachments\/\d+\/\d+\/[^/]+$/.test(url.pathname)
        || value.length > 2048) throw new DiscordInputError('画像のURLを確認できません。画像ファイルを添付し直してください。');
    return url;
}

export function imagesFromMessage(message: any, channelId: string): DiscordImage[] {
    if (!message || message.channel_id !== channelId || !SNOWFLAKE.test(message.id)
        || !message.author || message.author.bot || message.webhook_id || !Array.isArray(message.attachments)) return [];
    const images = message.attachments.filter((item: any) => String(item?.content_type).startsWith('image/'));
    return images.map((image: any, index: number) => ({
        id: message.id, channelId, url: String(image.url), mime: image.content_type,
        size: Number(image.size), caption: images.length === 1 ? String(message.content ?? '').trim().slice(0, 150) : '',
        position: index + 1, total: images.length,
    }));
}

export function manualInput(caption: string): { pokemonId: string; ivs: IVs } | null {
    const match = caption.normalize('NFKC').trim().match(/^(.+?)\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})$/);
    if (!match) return null;
    const pokemon = data.pokemon.find(p => p.label.normalize('NFKC') === match[1].trim());
    if (!pokemon) throw new DiscordInputError('ポケモン名を確認してください。フォルムも含めた名前を指定してください。');
    const ivs = match.slice(2).map(Number) as IVs;
    try { validateIVs(ivs); } catch { throw new DiscordInputError('個体値は0〜15で指定してください。'); }
    return { pokemonId: pokemon.id, ivs };
}

export async function downloadImage(input: DiscordImage, fetcher: typeof fetch = fetch) {
    const url = attachmentURL(input.url);
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_IMAGE_BYTES) throw new DiscordInputError('画像は8MB以下で送ってください。');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.mime)) throw new DiscordInputError('PNG・JPEG・WebPの画像を送ってください。');
    for (let attempt = 1; attempt <= 2; attempt++) {
        let failureKind = 'network';
        try {
            const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
            if (!response.ok || !response.body) {
                await response.body?.cancel().catch(() => {});
                if (response.status >= 500 && response.status <= 599) {
                    failureKind = 'server';
                    throw new Error('Temporary image server error.');
                }
                throw new DiscordInputError('Discordから画像を取得できませんでした。画像を添付し直してください。');
            }
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > MAX_IMAGE_BYTES) throw new DiscordInputError('画像は8MB以下で送ってください。');
                    chunks.push(value);
                }
            } finally { await reader.cancel().catch(() => {}); }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            return bytes;
        } catch (error) {
            if (error instanceof DiscordInputError) throw error;
            if (error instanceof Error && error.name === 'TimeoutError') failureKind = 'timeout';
            console.warn('Discord image download failed.', { attempt, kind: failureKind });
        }
    }
    throw new DiscordInputError('Discordから画像を取得できませんでした。通信の失敗が続いています。時間をおいて画像を添付し直してください。');
}

export class DiscordError extends Error {
    status: number;
    retryAfter: number;
    constructor(status: number, retryAfter = 0) {
        super(`Discord API returned ${status}.`);
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

export async function discordRequest(path: string, token: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bot ${token}`);
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const response = await fetcher(`https://discord.com/api/v10${path}`, {
        ...init, redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers,
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new DiscordError(response.status, response.status === 429 ? Math.max(1, Number(body.retry_after) || 60) : 0);
    return body;
}

export function replyPayload(
    image: Pick<DiscordImage, 'id' | 'position' | 'total'>,
    content: string,
    attachment?: { filename: string; description: string },
) {
    const prefix = image.total && image.total > 1 ? `${image.position}枚目／全${image.total}枚\n` : '';
    return {
        content: prefix + content.slice(0, 2000 - prefix.length), allowed_mentions: { parse: [], replied_user: false },
        message_reference: { message_id: image.id, fail_if_not_exists: false },
        nonce: image.position && image.position > 1 ? `${image.id}-${image.position}` : image.id, enforce_nonce: true,
        ...(attachment ? { attachments: [{ id: 0, ...attachment }] } : {}),
    };
}

export function rankAttachment(
    card: RankCardData,
    image: Pick<DiscordImage, 'id' | 'position' | 'total'>,
    content: string,
    png: Uint8Array,
) {
    const sequence = image.total && image.total > 1 ? `-${image.position}` : '';
    const filename = `pokemon-go-ranks${sequence}.png`;
    const number = image.total && image.total > 1 ? `${image.position}枚目／全${image.total}枚。` : '';
    const description = `${number}${card.title}｜個体値 ${card.ivs.join(' / ')}。PL50の順位表。`;
    const form = new FormData();
    form.append('payload_json', JSON.stringify(replyPayload(image, content, { filename, description })));
    form.append('files[0]', new Blob([new Uint8Array(png).buffer], { type: 'image/png' }), filename);
    return { form, filename, description };
}
