export interface GatewaySession { id: string; url: string; sequence: number; }
export interface GatewayEvent { op: number; t?: string; s?: number; d: any; }
interface Options {
    token: string;
    url: string;
    session?: GatewaySession;
    onDispatch(event: GatewayEvent, session: GatewaySession): Promise<void>;
    onClose(code: number, clearSession: boolean): void;
    socketFactory?: (url: string) => WebSocket;
}

export class GatewayConnection {
    private socket: WebSocket;
    private timer?: ReturnType<typeof setTimeout>;
    private helloTimer?: ReturnType<typeof setTimeout>;
    private acknowledged = true;
    private closed = false;
    private dispatch = Promise.resolve();
    private session?: GatewaySession;
    ready = false;
    private options: Options;

    constructor(options: Options) {
        this.options = options;
        this.session = options.session;
        const url = new URL(this.session?.url || options.url);
        if (url.protocol !== 'wss:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.discord\.gg$/.test(url.hostname)
            || url.username || url.password || url.port) throw new Error('Invalid Gateway URL.');
        url.searchParams.set('v', '10');
        url.searchParams.set('encoding', 'json');
        this.socket = (options.socketFactory ?? (address => new WebSocket(address)))(url.href);
        this.socket.addEventListener('message', event => {
            try { this.receive(JSON.parse(String(event.data))); } catch { this.finish(4000); }
        });
        this.socket.addEventListener('close', event => this.finish(event.code, [4007, 4009].includes(event.code)));
        this.socket.addEventListener('error', () => this.finish(4000));
        this.helloTimer = setTimeout(() => this.finish(4000), 15000);
    }

    private send(op: number, d: unknown) {
        if (this.socket.readyState !== 1) { this.finish(4000); return; }
        this.socket.send(JSON.stringify({ op, d }));
    }

    private receive(event: GatewayEvent) {
        if (this.closed) return;
        if (event.op === 10) {
            clearTimeout(this.helloTimer);
            const interval = event.d?.heartbeat_interval;
            if (!Number.isFinite(interval) || interval < 1000 || interval > 120000) return this.finish(4000);
            const heartbeat = () => {
                if (this.closed) return;
                if (!this.acknowledged) return this.finish(4000);
                this.acknowledged = false;
                this.send(1, this.session?.sequence ?? null);
                this.timer = setTimeout(heartbeat, interval);
            };
            this.timer = setTimeout(heartbeat, interval * Math.random());
            if (this.session) this.send(6, { token: this.options.token, session_id: this.session.id, seq: this.session.sequence });
            else this.send(2, {
                token: this.options.token, intents: 1 | (1 << 9) | (1 << 15),
                properties: { os: 'linux', browser: 'kotaichi', device: 'kotaichi' },
            });
        } else if (event.op === 11) this.acknowledged = true;
        else if (event.op === 1) this.send(1, this.session?.sequence ?? null);
        else if (event.op === 7) this.finish(4000);
        else if (event.op === 9) this.finish(4000, !event.d);
        else if (event.op === 0 && Number.isInteger(event.s)) {
            this.dispatch = this.dispatch.then(async () => {
                if (this.closed) return;
                const session = event.t === 'READY'
                    ? { id: event.d.session_id, url: event.d.resume_gateway_url, sequence: event.s! }
                    : this.session && { ...this.session, sequence: event.s! };
                if (!session) throw new Error('Missing Gateway session.');
                await this.options.onDispatch(event, session);
                this.session = session;
                if (event.t === 'READY' || event.t === 'RESUMED') this.ready = true;
            }).catch(() => this.finish(4000));
        }
    }

    stop() { this.finish(1000, true, false); }

    private finish(code: number, clearSession = false, notify = true) {
        if (this.closed) return;
        this.closed = true;
        this.ready = false;
        clearTimeout(this.timer);
        clearTimeout(this.helloTimer);
        try { this.socket.close(code === 1000 ? 1000 : 4000); } catch { /* The socket may already be closed. */ }
        if (notify) this.options.onClose(code, clearSession);
    }
}
