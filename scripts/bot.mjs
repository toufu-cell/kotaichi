import { readFile } from 'node:fs/promises';

const action = process.argv[2] || 'status';
if (!['start', 'stop', 'status'].includes(action)) throw new Error('Use: npm run bot -- start|stop|status');
const config = await readFile(process.env.APP_SECRET_FILE || '.dev.vars.production', 'utf8');
const password = config.match(/^APP_PASSWORD="([^"]+)"$/m)?.[1];
if (!password || password.length < 16) throw new Error('APP_PASSWORD is missing from the local secret file.');
const origin = new URL(process.env.APP_URL || 'https://kotaichi.iv-scope-lab.workers.dev');
if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Use HTTPS for the deployed app.');
const response = await fetch(new URL(`/api/bot/${action}`, origin), {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${password}` },
    redirect: 'error', signal: AbortSignal.timeout(20000),
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok) process.exitCode = 1;
