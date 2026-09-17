import { GatewayConnection, type GatewaySession, type GatewayEvent } from './gateway-connection.ts';
import {
    discordRequest, DiscordError, imagesFromMessage, rankAttachment, replyPayload, SNOWFLAKE,
    MAX_IMAGE_BYTES, type DiscordImage,
} from './discord.ts';
import type { RankCardData } from '../src/discord-card.ts';
import { authorized } from './auth.ts';
import type { Env } from './index.ts';

interface Job { image: DiscordImage; content?: string; card?: RankCardData; sendingAt?: number; }
interface BotState {
    enabled: boolean;
    channelId: string;
    session?: GatewaySession;
    queue: Job[];
    done: string[];
    issue: string;
    nextConnectAt: number;
    nextSendAt: number;
    failures: number;
    uncertain: number;
    rejected: number;
    overflowAt: number;
    lastReadyAt?: number;
    lastResultAt?: number;
}
interface Context {
    storage: {
        get<T>(key: string): Promise<T | undefined>;
        put(key: string, value: unknown): Promise<void>;
        setAlarm(time: number): Promise<void>;
        deleteAlarm(): Promise<void>;
    };
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
    waitUntil(promise: Promise<unknown>): void;
}
const initialState = (): BotState => ({
    enabled: false, channelId: '', queue: [], done: [], issue: '', nextConnectAt: 0,
    nextSendAt: 0, failures: 0, uncertain: 0, rejected: 0, overflowAt: 0,
});

export class DiscordGateway {
    private state = initialState();
    private connection?: GatewayConnection;
    private connecting = false;
    private processing = false;
    private sending = false;
    private generation = 0;
    private ctx: Context;
    private env: Env;

    constructor(ctx: Context, env: Env) {
        this.ctx = ctx;
        this.env = env;
        ctx.blockConcurrencyWhile(async () => {
            this.state = await ctx.storage.get<BotState>('bot') ?? initialState();
        });
    }

    private save() { return this.ctx.storage.put('bot', this.state); }

    async fetch(request: Request) {
        const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (!await authorized(request, this.env.APP_PASSWORD)) return Response.json({ error: '利用コードを確認してください。' }, { status: 401, headers });
        if (request.headers.has('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) return new Response(null, { status: 403, headers });
        const action = new URL(request.url).pathname.split('/').at(-1);
        if (action === 'status' && request.method === 'GET') return Response.json(this.status(), { headers });
        if (request.method !== 'POST') return new Response(null, { status: 405, headers });
        if (action === 'stop') {
            this.generation++;
            this.state.enabled = false;
            this.connection?.stop();
            this.connection = undefined;
            this.state.session = undefined;
            await this.save();
            await this.ctx.storage.deleteAlarm();
        } else if (action === 'start') {
            if (!this.env.DISCORD_BOT_TOKEN || !SNOWFLAKE.test(this.env.DISCORD_CHANNEL_ID ?? '')) {
                return Response.json({ error: 'BotトークンとチャンネルIDを設定してください。' }, { status: 503, headers });
            }
            if (this.state.channelId && this.state.channelId !== this.env.DISCORD_CHANNEL_ID) {
                return Response.json({ error: '処理待ちデータを確認してからチャンネルを変更してください。' }, { status: 409, headers });
            }
            this.state.channelId = this.env.DISCORD_CHANNEL_ID!;
            this.state.enabled = true;
            this.state.issue = '';
            this.state.nextConnectAt = 0;
            this.state.failures = 0;
            await this.save();
            await this.ctx.storage.setAlarm(Date.now() + 60000);
            this.ctx.waitUntil(this.wake());
        } else return new Response(null, { status: 404, headers });
        return Response.json(this.status(), { headers });
    }

    private status() {
        return {
            enabled: this.state.enabled, connected: this.connection?.ready ?? false,
            queued: this.state.queue.length, issue: this.state.issue,
            uncertainReplies: this.state.uncertain, rejectedMessages: this.state.rejected,
            lastReadyAt: this.state.lastReadyAt, lastResultAt: this.state.lastResultAt,
        };
    }

    async alarm() { await this.wake(); }

    private async wake() {
        if (!this.state.enabled) return;
        await this.ctx.storage.setAlarm(Date.now() + 60000);
        if (this.state.channelId !== this.env.DISCORD_CHANNEL_ID || !this.env.DISCORD_BOT_TOKEN) {
            await this.halt('Bot設定が変わりました。管理者が設定を確認してください。');
            return;
        }
        if (!this.connection && !this.connecting && Date.now() >= this.state.nextConnectAt) {
            const generation = this.generation;
            this.connecting = true;
            let stage = 'channel';
            try {
                const channel = await discordRequest(`/channels/${this.state.channelId}`, this.env.DISCORD_BOT_TOKEN);
                if (!this.state.enabled || generation !== this.generation) return;
                if (channel.id !== this.state.channelId || channel.type !== 0 || !SNOWFLAKE.test(channel.guild_id ?? '')) {
                    await this.halt('サーバー内の通常のテキストチャンネルを指定してください。');
                    return;
                }
                stage = 'gateway';
                const gateway = await discordRequest('/gateway/bot', this.env.DISCORD_BOT_TOKEN);
                if (!this.state.enabled || generation !== this.generation) return;
                if (gateway.session_start_limit?.remaining === 0 && !this.state.session) {
                    this.state.nextConnectAt = Date.now() + Math.max(60000, gateway.session_start_limit.reset_after);
                    this.state.issue = 'Discordの接続回数上限に達しました。回復を待っています。';
                    await this.save();
                } else {
                    stage = 'socket';
                    this.connection = new GatewayConnection({
                        token: this.env.DISCORD_BOT_TOKEN, url: gateway.url, session: this.state.session,
                        onDispatch: (event, session) => generation === this.generation ? this.receive(event, session) : Promise.resolve(),
                        onClose: (code, clear) => { if (generation === this.generation) this.ctx.waitUntil(this.disconnected(code, clear)); },
                    });
                }
            } catch (error) {
                if (!this.state.enabled || generation !== this.generation) return;
                if (error instanceof DiscordError && [401, 403, 404].includes(error.status)) await this.halt('Botトークン、チャンネルID、チャンネルを閲覧する権限を確認してください。');
                else {
                    this.state.nextConnectAt = Date.now() + (error instanceof DiscordError && error.retryAfter ? error.retryAfter * 1000 : 60000);
                    const detail = error instanceof DiscordError ? `HTTP ${error.status}` : error instanceof Error ? error.name : 'UnknownError';
                    this.state.issue = `Discordへの接続を待っています。${stage}: ${detail}`;
                    await this.save();
                }
            } finally { this.connecting = false; }
        }
        await this.drain();
    }

    private async disconnected(code: number, clear: boolean) {
        this.connection = undefined;
        if (!this.state.enabled) return;
        if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) {
            await this.halt('BotトークンとMessage Content Intent、サーバーの権限を確認してください。');
            return;
        }
        if (clear) {
            this.state.session = undefined;
            this.state.issue = '接続を復元できませんでした。停止中に送った画像は、返信されなければ再投稿してください。';
        }
        this.state.failures++;
        const delay = Math.min(60000, 5000 * 2 ** Math.min(this.state.failures - 1, 4));
        this.state.nextConnectAt = Date.now() + delay;
        await this.save();
        await this.ctx.storage.setAlarm(this.state.nextConnectAt);
    }

    private async receive(event: GatewayEvent, session: GatewaySession) {
        if (!this.state.enabled) return;
        const images = event.t === 'MESSAGE_CREATE' ? imagesFromMessage(event.d, this.state.channelId) : [];
        const image = images[0];
        const duplicate = image && (this.state.done.includes(image.id) || this.state.queue.some(job => job.image.id === image.id));
        let overflow: DiscordImage | undefined;
        if (image && !duplicate) {
            if (this.state.queue.length + images.length <= 20) this.state.queue.push(...images.map(image => ({ image })));
            else {
                this.state.rejected++;
                this.state.issue = '処理待ちが満杯のため、受付できなかった画像があります。';
                if (Date.now() - this.state.overflowAt > 60000) { this.state.overflowAt = Date.now(); overflow = image; }
                this.remember(image.id);
            }
        }
        this.state.session = session;
        if (event.t === 'READY' || event.t === 'RESUMED') {
            this.state.lastReadyAt = Date.now();
            this.state.failures = 0;
        }
        // Store the resume checkpoint and accepted images in one atomic write.
        await this.save();
        if (overflow) {
            this.ctx.waitUntil(this.sendReply({ ...overflow, position: undefined, total: undefined },
                '処理待ちの上限は20枚です。今回の投稿の画像はすべて受け付けていません。時間をおき、20枚以下で再投稿してください。').catch(() => {}));
        }
        this.ctx.waitUntil(this.drain());
    }

    private remember(id: string) {
        if (!this.state.done.includes(id)) this.state.done.push(id);
        this.state.done = this.state.done.slice(-200);
    }

    private async halt(issue: string) {
        this.generation++;
        this.state.enabled = false;
        this.state.issue = issue;
        this.connection?.stop();
        this.connection = undefined;
        this.state.session = undefined;
        await this.save();
        await this.ctx.storage.deleteAlarm();
    }

    private async rateLimited(job: Job | undefined, error: DiscordError) {
        if (job) job.sendingAt = undefined;
        this.state.nextSendAt = Date.now() + error.retryAfter * 1000;
        await this.save();
        await this.ctx.storage.setAlarm(this.state.nextSendAt);
    }

    private async permissionFailure(job?: Job) {
        if (job) job.sendingAt = undefined;
        await this.halt('Discordへ返信する権限を確認してください。');
    }

    private attachmentPermissionMessage(card: RankCardData) {
        return `${card.title}｜個体値 ${card.ivs.join(' / ')}\n順位画像を添付できませんでした。管理者はBotのAttach Files権限を確認してください。`;
    }

    private async sendReply(image: DiscordImage, content: string, job?: Job, png?: Uint8Array) {
        if (this.sending || !this.state.enabled || Date.now() < this.state.nextSendAt) return false;
        this.sending = true;
        try {
            const body = png && job?.card
                ? rankAttachment(job.card, image, content, png).form
                : JSON.stringify(replyPayload(image, content));
            await discordRequest(`/channels/${this.state.channelId}/messages`, this.env.DISCORD_BOT_TOKEN!, {
                method: 'POST', body,
            });
            return true;
        } catch (error) {
            if (error instanceof DiscordError && error.status === 429) {
                await this.rateLimited(job, error);
                return false;
            }
            if (error instanceof DiscordError && error.status === 403 && png && job?.card) {
                try {
                    await discordRequest(`/channels/${this.state.channelId}/messages`, this.env.DISCORD_BOT_TOKEN!, {
                        method: 'POST', body: JSON.stringify(replyPayload(image, this.attachmentPermissionMessage(job.card))),
                    });
                    return true;
                } catch (fallbackError) {
                    if (fallbackError instanceof DiscordError && fallbackError.status === 429) {
                        await this.rateLimited(job, fallbackError);
                        return false;
                    }
                    if (fallbackError instanceof DiscordError && [401, 403].includes(fallbackError.status)) {
                        await this.permissionFailure(job);
                        return false;
                    }
                    throw fallbackError;
                }
            }
            if (error instanceof DiscordError && [401, 403].includes(error.status)) {
                await this.permissionFailure(job);
                return false;
            }
            throw error;
        } finally { this.sending = false; }
    }

    private async rankPng(card: RankCardData) {
        const response = await this.env.RANK_BROWSER.getByName('rank').fetch(new Request('https://internal/internal/discord-rank-image', {
            method: 'POST', body: JSON.stringify({ channelId: this.state.channelId, card }),
            headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
        }));
        if (!response.ok || response.headers.get('Content-Type') !== 'image/png') throw new Error('Rank image unavailable.');
        const png = new Uint8Array(await response.arrayBuffer());
        if (png.length < 8 || png.length > MAX_IMAGE_BYTES
            || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte)) {
            throw new Error('Invalid rank image.');
        }
        return png;
    }

    private async drain() {
        if (this.processing || !this.state.enabled || Date.now() < this.state.nextSendAt) return;
        this.processing = true;
        try {
            while (this.state.enabled && this.state.queue.length) {
                const job = this.state.queue[0];
                if (job.sendingAt) {
                    this.state.uncertain++;
                    this.state.issue = '一部の画像は返信結果を確認できません。二重返信を避けるため自動再送を停止しました。';
                    this.remember(job.image.id);
                    this.state.queue.shift();
                    await this.save();
                    continue;
                }
                if (!job.content) {
                    try {
                        const response = await this.env.RANK_BROWSER.getByName('rank').fetch(new Request('https://internal/internal/discord-image', {
                            method: 'POST', body: JSON.stringify(job.image), headers: { 'Content-Type': 'application/json' },
                            signal: AbortSignal.timeout(120000),
                        }));
                        if (!response.ok) throw new Error();
                        const result = await response.json() as { content: string; card?: RankCardData };
                        if (typeof result.content !== 'string' || !result.content) throw new Error();
                        job.content = result.content;
                        job.card = result.card;
                    } catch { job.content = '画像か順位を取得できませんでした。無料枠の上限や混雑の可能性があります。時間をおいて再投稿してください。'; }
                    await this.save();
                }
                if (!this.state.enabled) break;
                let png: Uint8Array | undefined;
                let content = job.content;
                if (job.card) {
                    try { png = await this.rankPng(job.card); }
                    catch {
                        content = `${job.card.title}｜個体値 ${job.card.ivs.join(' / ')}\n順位画像を作成できませんでした。時間をおいて再投稿してください。`;
                    }
                }
                if (!this.state.enabled) break;
                job.sendingAt = Date.now();
                await this.save();
                try {
                    if (!await this.sendReply(job.image, content, job, png)) {
                        job.sendingAt = undefined;
                        await this.save();
                        break;
                    }
                    this.remember(job.image.id);
                    this.state.queue.shift();
                    this.state.lastResultAt = Date.now();
                    await this.save();
                } catch (error) {
                    this.state.issue = 'Discordへの返信結果を確認できませんでした。';
                    await this.save();
                }
            }
        } finally { this.processing = false; }
    }
}
