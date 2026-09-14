import data from '../src/data/pokemon.json' with { type: 'json' };
import { SOURCE_URL, type RankResponse } from '../src/api.ts';
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

export function formatRanks(result: RankResponse, candidateIds = [result.request.pokemonId]) {
    const pokemon = data.pokemon.find(p => p.id === result.request.pokemonId)!;
    const candidateNames = data.pokemon.filter(p => candidateIds.includes(p.id)).map(p => p.label);
    const ambiguous = candidateNames.length > 1;
    const lines = [`${ambiguous ? `${pokemon.name}（フォルム未確定）` : pokemon.label}｜${result.request.ivs.join(' / ')}`];
    if (ambiguous) lines.push('名前が同じフォルムを候補として表示しています。画像のフォルムと見比べてください。');
    lines.push('PL50上限・全4,096通りの能力値の積で計算（同率は同順位）');
    const names = [...new Set(result.rows.filter(row => row.maxLevel === 50).map(row => row.name))];
    const isTop30 = (rank: number) => rank >= 1 && rank <= 30;
    const priority = (name: string) => candidateNames.includes(name) ? 0
        : result.rows.some(row => row.name === name && row.maxLevel === 50 && isTop30(row.rank)) ? 1
        : /^(メガ|ゲンシ)/.test(name) ? 3 : 2;
    names.sort((a, b) => priority(a) - priority(b));
    for (const name of names) {
        const rows = result.rows.filter(row => row.name === name && row.maxLevel === 50);
        const suffix = candidateNames.includes(name) ? (ambiguous ? '（フォルム候補）' : '') : '（進化候補）';
        const section = ['', `${name}${suffix}`];
        for (const cap of [1500, 2500, 500, null]) {
            const row = rows.find(row => row.cap === cap);
            if (!row) continue;
            const league = cap === 1500 ? 'スーパー' : cap === 2500 ? 'ハイパー' : cap === 500 ? 'リトル' : 'マスター';
            const rank = `${league}：${row.rank.toLocaleString('ja-JP')}位`;
            section.push(`${isTop30(row.rank) ? `⭐ **${rank}**` : rank} / CP${row.cp} / PL${row.level}`);
        }
        if ([...lines, ...section].join('\n').length > 1650) { lines.push('一部の候補を省略しました。候補名と個体値を本文に指定すると計算できます。'); break; }
        lines.push(...section);
    }
    lines.push('', '読み取った名前・個体値を画像と確認してください。現在のCPによる参加可否は判定しません。',
        '性別・地域・イベントなどの進化条件は判定しません。', `計算用データ：PvPoke ${SOURCE_URL}`);
    return lines.join('\n');
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
    const response = await fetcher(`https://discord.com/api/v10${path}`, {
        ...init, redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...init.headers },
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new DiscordError(response.status, response.status === 429 ? Math.max(1, Number(body.retry_after) || 60) : 0);
    return body;
}

export function replyPayload(image: Pick<DiscordImage, 'id' | 'position' | 'total'>, content: string) {
    const prefix = image.total && image.total > 1 ? `${image.position}枚目／全${image.total}枚\n` : '';
    return {
        content: prefix + content.slice(0, 2000 - prefix.length), allowed_mentions: { parse: [], replied_user: false },
        message_reference: { message_id: image.id, fail_if_not_exists: false },
        nonce: image.position && image.position > 1 ? `${image.id}-${image.position}` : image.id, enforce_nonce: true,
    };
}
