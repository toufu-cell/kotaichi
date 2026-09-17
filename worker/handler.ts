interface GatewayNamespace {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
}

interface Environment {
    DISCORD_GATEWAY: GatewayNamespace;
}

const BOT_PATHS = new Set([
    '/api/bot/start',
    '/api/bot/stop',
    '/api/bot/status',
]);

export function handleRequest(request: Request, env: Environment): Promise<Response> {
    if (!BOT_PATHS.has(new URL(request.url).pathname)) {
        return Promise.resolve(new Response(null, {
            status: 404,
            headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        }));
    }
    return env.DISCORD_GATEWAY.getByName('discord').fetch(request);
}
