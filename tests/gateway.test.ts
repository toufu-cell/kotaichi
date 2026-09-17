import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayConnection } from '../worker/gateway-connection.ts';
import { DiscordGateway } from '../worker/discord-gateway.ts';
import type { Env } from '../worker/index.ts';

class Socket extends EventTarget {
    readyState = 1;
    sent: { op: number; d: any }[] = [];
    send(text: string) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
    receive(payload: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) })); }
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const rankCard = (position?: number, total?: number) => ({
    title: 'デルビル', ivs: [8, 3, 11] as [number, number, number], formUncertain: false,
    ...(position && total ? { imageNumber: { position, total } } : {}),
    rows: [{
        name: 'デルビル', role: '本人' as const,
        leagues: [500, 1500, 2500, 3000].map((cp, index) => ({ rank: index + 1, cp, level: 50 })) as any,
    }],
});

test('Gateway identifies with image access, checkpoints dispatches and resumes without re-identifying', async () => {
    const socket = new Socket();
    const saved: unknown[] = [];
    const connection = new GatewayConnection({
        token: 'test', url: 'wss://gateway.discord.gg', socketFactory: () => socket as unknown as WebSocket,
        onDispatch: async (_event, session) => { saved.push(session); }, onClose: () => {},
    });
    socket.receive({ op: 10, d: { heartbeat_interval: 40000 } });
    assert.ok(socket.sent.find(item => item.op === 2)!.d.intents & (1 << 15));
    socket.receive({ op: 0, t: 'READY', s: 1, d: { session_id: 'session', resume_gateway_url: 'wss://gateway.discord.gg' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(saved, [{ id: 'session', url: 'wss://gateway.discord.gg', sequence: 1 }]);
    assert.equal(connection.ready, true);
    connection.stop();
    const resumedSocket = new Socket();
    const resumed = new GatewayConnection({
        token: 'test', url: 'wss://gateway.discord.gg', session: saved[0] as any,
        socketFactory: () => resumedSocket as unknown as WebSocket,
        onDispatch: async () => {}, onClose: () => {},
    });
    resumedSocket.receive({ op: 10, d: { heartbeat_interval: 40000 } });
    assert.equal(resumedSocket.sent[0].op, 6);
    assert.equal(resumedSocket.sent[0].d.seq, 1);
    resumed.stop();
});

test('Gateway detects missing heartbeat acknowledgements and invalid sessions', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(Math, 'random', () => 0.5);
    const socket = new Socket();
    const closed: unknown[] = [];
    const connection = new GatewayConnection({
        token: 'test', url: 'wss://gateway.discord.gg', socketFactory: () => socket as unknown as WebSocket,
        onDispatch: async () => {}, onClose: (code, clear) => closed.push({ code, clear }),
    });
    socket.receive({ op: 10, d: { heartbeat_interval: 1000 } });
    t.mock.timers.tick(500);
    t.mock.timers.tick(1000);
    assert.deepEqual(closed, [{ code: 4000, clear: false }]);
    connection.stop();
    const invalid = new Socket();
    const second = new GatewayConnection({
        token: 'test', url: 'wss://gateway.discord.gg', socketFactory: () => invalid as unknown as WebSocket,
        onDispatch: async () => {}, onClose: (code, clear) => closed.push({ code, clear }),
    });
    invalid.receive({ op: 9, d: false });
    assert.deepEqual(closed[1], { code: 4000, clear: true });
    second.stop();
});

test('Gateway restart does not resend an uncertain reply and preserves queued work', async t => {
    const channelId = '123456789012345678';
    const image = { id: '223456789012345678', channelId, url: 'https://cdn.discordapp.com/attachments/1/2/a.png', mime: 'image/png', size: 1, caption: '' };
    let stored: any = {
        enabled: true, channelId, queue: [
            { image, content: 'result', card: rankCard() },
            { image: { ...image, position: 2, total: 2 }, content: 'second result' },
        ], done: [],
        issue: '', nextConnectAt: Date.now() + 600000, nextSendAt: 0, failures: 0, uncertain: 0, rejected: 0, overflowAt: 0,
    };
    let initialized: Promise<unknown>;
    let storageFailed = false;
    const writes: any[] = [];
    const context = {
        storage: {
            get: async () => structuredClone(stored),
            put: async (_key: string, value: unknown) => {
                if (storageFailed) throw new Error('Storage unavailable.');
                stored = structuredClone(value); writes.push(stored);
            },
            setAlarm: async () => {}, deleteAlarm: async () => {},
        },
        blockConcurrencyWhile: (callback: () => Promise<unknown>) => initialized = callback(),
        waitUntil: () => {},
    };
    let sent = 0;
    const payloads: any[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
        sent++;
        payloads.push(options.body instanceof FormData
            ? JSON.parse(String(options.body.get('payload_json')))
            : JSON.parse(options.body));
        if (sent === 1) storageFailed = true;
        return Response.json({ id: 'reply' });
    });
    const env = {
        DISCORD_BOT_TOKEN: 'token', DISCORD_CHANNEL_ID: channelId, APP_PASSWORD: 'a-long-test-password',
        RANK_BROWSER: { getByName: () => ({ fetch: async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }) }) },
    } as unknown as Env;
    const bot = new DiscordGateway(context as any, env);
    await initialized!;
    await assert.rejects(bot.alarm());
    assert.equal(sent, 1);
    assert.ok(stored.queue[0].sendingAt);
    storageFailed = false;
    const restarted = new DiscordGateway(context as any, env);
    await initialized!;
    await restarted.alarm();
    assert.equal(sent, 2);
    assert.match(payloads[1].content, /^2枚目／全2枚\nsecond result$/);
    assert.notEqual(payloads[0].nonce, payloads[1].nonce);
    assert.equal(stored.uncertain, 1);
    assert.equal(stored.queue.length, 0);
    assert.deepEqual(stored.done, [image.id]);
    const unauthorized = await bot.fetch(new Request('https://app/api/bot/start', { method: 'POST' }));
    assert.equal(unauthorized.status, 401);
    assert.ok(writes.length);
});

test('Gateway persists entire batches and resumes after rate limits with independent image failures', async t => {
    const channelId = '123456789012345678';
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    let stored: any = { enabled: true, channelId, queue: [], done: [], issue: '', nextConnectAt: 0, nextSendAt: 0, failures: 0, uncertain: 0, rejected: 0, overflowAt: 0 };
    let initialized: Promise<unknown>;
    const writes: any[] = [];
    const tasks: Promise<unknown>[] = [];
    const context = {
        storage: {
            get: async () => structuredClone(stored),
            put: async (_key: string, value: unknown) => { stored = structuredClone(value); writes.push(stored); },
            setAlarm: async () => {}, deleteAlarm: async () => {},
        },
        blockConcurrencyWhile: (callback: () => Promise<unknown>) => initialized = callback(),
        waitUntil: (task: Promise<unknown>) => { tasks.push(task); },
    };
    let socket = new Socket();
    t.mock.method(globalThis, 'WebSocket', function () { return socket; } as any);
    let replies = 0;
    let analyses = 0;
    let renders = 0;
    const payloads: any[] = [];
    const files: Array<File | null> = [];
    t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
        if (String(url).endsWith(`/channels/${channelId}`)) return Response.json({ id: channelId, type: 0, guild_id: '423456789012345678' });
        if (String(url).endsWith('/gateway/bot')) return Response.json({ url: 'wss://gateway.discord.gg' });
        replies++;
        if (options.body instanceof FormData) {
            payloads.push(JSON.parse(String(options.body.get('payload_json'))));
            files.push(options.body.get('files[0]') as File);
        } else {
            payloads.push(JSON.parse(options.body));
            files.push(null);
        }
        assert.equal(payloads.at(-1).allowed_mentions.replied_user, false);
        return replies === 1 ? Response.json({ retry_after: 5 }, { status: 429 }) : Response.json({ id: 'reply' });
    });
    const env = {
        DISCORD_BOT_TOKEN: 'token', DISCORD_CHANNEL_ID: channelId, APP_PASSWORD: 'a-long-test-password',
        RANK_BROWSER: { getByName: () => ({ fetch: async (request: Request) => {
            if (new URL(request.url).pathname === '/internal/discord-rank-image') {
                renders++;
                if (renders === 3) return new Response(null, { status: 500 });
                return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
            }
            analyses++;
            return analyses === 2
                ? new Response(null, { status: 500 })
                : Response.json({ content: `result ${analyses}`, card: rankCard(analyses === 1 ? 1 : 3, 3) });
        } }) },
    } as unknown as Env;
    const bot = new DiscordGateway(context as any, env);
    await initialized!;
    await bot.alarm();
    socket.receive({ op: 10, d: { heartbeat_interval: 40000 } });
    socket.receive({ op: 0, t: 'READY', s: 1, d: { session_id: 'session', resume_gateway_url: 'wss://gateway.discord.gg' } });
    const payload = { id: '223456789012345678', channel_id: channelId, author: { id: '323456789012345678' },
        attachments: Array.from({ length: 3 }, (_, i) => ({ url: `https://cdn.discordapp.com/attachments/1/2/${i}.png`, content_type: 'image/png', size: 1 })),
    };
    socket.receive({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: payload });
    socket.receive({ op: 0, t: 'MESSAGE_CREATE', s: 3, d: payload });
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all(tasks);
    assert.ok(writes.some(value => value.session?.sequence === 2 && value.queue.length === 3));
    assert.equal(analyses, 1);
    assert.equal(renders, 1);
    assert.equal(replies, 1);
    assert.equal(stored.nextSendAt, 105000);
    const checkpoint = writes.find(value => value.nextSendAt === 105000);
    assert.equal(checkpoint.queue[0].sendingAt, undefined);
    assert.ok(checkpoint.queue[0].card);
    assert.ok(JSON.stringify(checkpoint).length < 20000);
    assert.doesNotMatch(JSON.stringify(checkpoint), /iVBOR|137,80,78,71/);
    await bot.alarm();
    assert.equal(replies, 1);
    const stopRequest = () => new Request('https://app/api/bot/stop', { method: 'POST', headers: { Authorization: 'Bearer a-long-test-password' } });
    assert.equal((await bot.fetch(stopRequest())).status, 200);
    stored = structuredClone(checkpoint);
    socket = new Socket();
    const restarted = new DiscordGateway(context as any, env);
    await initialized!;
    await restarted.alarm();
    assert.equal(replies, 1);
    now = 105001;
    await restarted.alarm();
    assert.equal(replies, 4);
    assert.equal(analyses, 3);
    assert.equal(renders, 3);
    assert.equal(payloads[0].nonce, payloads[1].nonce);
    assert.equal(new Set(payloads.slice(1).map(item => item.nonce)).size, 3);
    assert.match(payloads[1].content, /^1枚目／全3枚\nresult 1$/);
    assert.match(payloads[2].content, /^2枚目／全3枚\n画像か順位を取得できませんでした/);
    assert.match(payloads[3].content, /^3枚目／全3枚\nデルビル｜個体値 8 \/ 3 \/ 11\n順位画像を作成できませんでした/);
    assert.deepEqual(files.map(file => file?.name ?? null), [
        'pokemon-go-ranks-1.png', 'pokemon-go-ranks-1.png', null, null,
    ]);
    assert.equal(stored.queue.length, 0);
    assert.deepEqual(stored.done, [payload.id]);
    socket.receive({ op: 10, d: { heartbeat_interval: 40000 } });
    socket.receive({ op: 0, t: 'RESUMED', s: 4, d: {} });
    socket.receive({ op: 0, t: 'MESSAGE_CREATE', s: 5, d: payload });
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all(tasks);
    assert.equal(replies, 4);
    assert.equal(stored.session.sequence, 5);
    const stop = await restarted.fetch(stopRequest());
    assert.equal(stop.status, 200);
});

test('Gateway falls back to text only for missing attachment permission', async t => {
    for (const fallbackStatus of [200, 403]) await t.test(String(fallbackStatus), async t => {
        const channelId = '123456789012345678';
        const image = { id: '223456789012345678', channelId, url: 'https://cdn.discordapp.com/attachments/1/2/a.png', mime: 'image/png', size: 1, caption: '' };
        let stored: any = {
            enabled: true, channelId, queue: [{ image, content: 'result', card: rankCard() }], done: [],
            issue: '', nextConnectAt: Date.now() + 600000, nextSendAt: 0, failures: 0, uncertain: 0, rejected: 0, overflowAt: 0,
        };
        let initialized: Promise<unknown>;
        const context = {
            storage: {
                get: async () => structuredClone(stored),
                put: async (_key: string, value: unknown) => { stored = structuredClone(value); },
                setAlarm: async () => {}, deleteAlarm: async () => {},
            },
            blockConcurrencyWhile: (callback: () => Promise<unknown>) => initialized = callback(),
            waitUntil: () => {},
        };
        const payloads: any[] = [];
        t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
            const multipart = options.body instanceof FormData;
            payloads.push(multipart
                ? JSON.parse(String(options.body.get('payload_json')))
                : JSON.parse(options.body));
            if (multipart) return Response.json({}, { status: 403 });
            return Response.json({}, { status: fallbackStatus });
        });
        const bot = new DiscordGateway(context as any, {
            DISCORD_BOT_TOKEN: 'token', DISCORD_CHANNEL_ID: channelId,
            RANK_BROWSER: { getByName: () => ({ fetch: async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }) }) },
        } as unknown as Env);
        await initialized!;
        await bot.alarm();
        assert.equal(payloads.length, 2);
        assert.ok(payloads[0].attachments);
        assert.doesNotMatch(payloads[1].content, /順位表を添付しました/);
        assert.match(payloads[1].content, /Attach Files権限/);
        assert.equal(payloads[0].nonce, payloads[1].nonce);
        if (fallbackStatus === 200) {
            assert.equal(stored.enabled, true);
            assert.equal(stored.queue.length, 0);
        } else {
            assert.equal(stored.enabled, false);
            assert.equal(stored.queue.length, 1);
            assert.equal(stored.queue[0].sendingAt, undefined);
        }
    });
});

test('Stopping while Discord is connecting prevents a late socket from starting', async t => {
    let initialized: Promise<unknown>;
    const tasks: Promise<unknown>[] = [];
    const context = {
        storage: { get: async () => undefined, put: async () => {}, setAlarm: async () => {}, deleteAlarm: async () => {} },
        blockConcurrencyWhile: (callback: () => Promise<unknown>) => initialized = callback(),
        waitUntil: (task: Promise<unknown>) => { tasks.push(task); },
    };
    let resolveGateway: (response: Response) => void;
    const gateway = new Promise<Response>(resolve => { resolveGateway = resolve; });
    t.mock.method(globalThis, 'fetch', () => gateway);
    let sockets = 0;
    t.mock.method(globalThis, 'WebSocket', function () { sockets++; return new Socket(); } as any);
    const bot = new DiscordGateway(context as any, {
        DISCORD_BOT_TOKEN: 'token', DISCORD_CHANNEL_ID: '123456789012345678', APP_PASSWORD: 'a-long-test-password',
    } as Env);
    await initialized!;
    const request = (action: string) => new Request(`https://app/api/bot/${action}`, {
        method: 'POST', headers: { Authorization: 'Bearer a-long-test-password' },
    });
    assert.equal((await bot.fetch(request('start'))).status, 200);
    assert.equal((await bot.fetch(request('stop'))).status, 200);
    resolveGateway!(Response.json({ url: 'wss://gateway.discord.gg' }));
    await Promise.all(tasks);
    assert.equal(sockets, 0);
});

test('Overflow notices obey Discord rate limits and stop on permission failures', async t => {
    for (const status of [429, 403]) await t.test(String(status), async t => {
        const channelId = '123456789012345678';
        const image = { id: '223456789012345678', channelId, url: 'https://cdn.discordapp.com/attachments/1/2/a.png', mime: 'image/png', size: 1, caption: '' };
        let stored: any = {
            enabled: true, channelId, queue: Array.from({ length: 19 }, (_, i) => ({ image: { ...image, id: String(BigInt(image.id) + BigInt(i)) } })), done: [],
            issue: '', nextConnectAt: 0, nextSendAt: 0, failures: 0, uncertain: 0, rejected: 0, overflowAt: 0,
        };
        let initialized: Promise<unknown>;
        const tasks: Promise<unknown>[] = [];
        const context = {
            storage: { get: async () => structuredClone(stored), put: async (_key: string, value: unknown) => { stored = structuredClone(value); }, setAlarm: async () => {}, deleteAlarm: async () => {} },
            blockConcurrencyWhile: (callback: () => Promise<unknown>) => initialized = callback(),
            waitUntil: (task: Promise<unknown>) => { tasks.push(task); },
        };
        const socket = new Socket();
        t.mock.method(globalThis, 'WebSocket', function () { return socket; } as any);
        let replies = 0;
        t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
            if (String(url).endsWith(`/channels/${channelId}`)) return Response.json({ id: channelId, type: 0, guild_id: '423456789012345678' });
            if (String(url).endsWith('/gateway/bot')) return Response.json({ url: 'wss://gateway.discord.gg' });
            replies++;
            assert.match(JSON.parse(options.body).content, /今回の投稿の画像はすべて受け付けていません/);
            assert.doesNotMatch(JSON.parse(options.body).content, /枚目/);
            return Response.json({ retry_after: 120 }, { status });
        });
        let finishLookup: (response: Response) => void;
        const lookup = new Promise<Response>(resolve => { finishLookup = resolve; });
        const bot = new DiscordGateway(context as any, {
            DISCORD_BOT_TOKEN: 'token', DISCORD_CHANNEL_ID: channelId,
            RANK_BROWSER: { getByName: () => ({ fetch: () => lookup }) },
        } as unknown as Env);
        await initialized!;
        const wake = bot.alarm();
        await new Promise(resolve => setImmediate(resolve));
        socket.receive({ op: 10, d: { heartbeat_interval: 40000 } });
        socket.receive({ op: 0, t: 'READY', s: 1, d: { session_id: 'session', resume_gateway_url: 'wss://gateway.discord.gg' } });
        socket.receive({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: {
            id: '323456789012345678', channel_id: channelId, author: { id: '423456789012345678' },
            attachments: Array.from({ length: 2 }, () => ({ url: image.url, content_type: image.mime, size: 1 })),
        } });
        await new Promise(resolve => setImmediate(resolve));
        await Promise.all(tasks);
        assert.equal(replies, 1);
        assert.equal(stored.queue.length, 19);
        assert.equal(stored.rejected, 1);
        if (status === 429) assert.ok(stored.nextSendAt > Date.now() + 100000);
        else assert.equal(stored.enabled, false);
        finishLookup!(Response.json({ content: 'result' }));
        await wake;
        assert.equal(replies, 1);
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 4014 }));
        await Promise.all(tasks);
    });
});

test('An inaccessible channel stops the bot with an actionable status', async t => {
    let stored: any;
    let initialized: Promise<unknown>;
    const tasks: Promise<unknown>[] = [];
    const context = {
        storage: { get: async () => undefined, put: async (_key: string, value: unknown) => { stored = structuredClone(value); }, setAlarm: async () => {}, deleteAlarm: async () => {} },
        blockConcurrencyWhile: (callback: () => Promise<unknown>) => initialized = callback(),
        waitUntil: (task: Promise<unknown>) => { tasks.push(task); },
    };
    t.mock.method(globalThis, 'fetch', async (url: any) => {
        assert.match(String(url), /\/channels\/123456789012345678$/);
        return Response.json({}, { status: 404 });
    });
    const bot = new DiscordGateway(context as any, {
        DISCORD_BOT_TOKEN: 'token', DISCORD_CHANNEL_ID: '123456789012345678', APP_PASSWORD: 'a-long-test-password',
    } as Env);
    await initialized!;
    await bot.fetch(new Request('https://app/api/bot/start', {
        method: 'POST', headers: { Authorization: 'Bearer a-long-test-password' },
    }));
    await Promise.all(tasks);
    assert.equal(stored.enabled, false);
    assert.match(stored.issue, /チャンネルID/);
});
