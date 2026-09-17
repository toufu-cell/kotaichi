import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesFromMessage, manualInput, attachmentURL, downloadImage, replyPayload, rankAttachment, discordRequest, MAX_IMAGE_BYTES, DiscordInputError } from '../worker/discord.ts';
import { buildDiscordRankResult } from '../src/discord-card.ts';
import { sampleResult } from './rank-fixture.mjs';

const channel = '123456789012345678';
const manualCaption = (name: string, ivs: string) => `${name} ${ivs}`;
const message = {
    id: '223456789012345678', channel_id: channel, author: { id: '323456789012345678' }, content: '',
    attachments: [{ url: `https://cdn.discordapp.com/attachments/${channel}/423456789012345678/image.png`, content_type: 'image/png', size: 100 }],
};

test('Discord accepts only the designated channel and rejects unsafe image downloads', async () => {
    const [input] = imagesFromMessage(message, channel);
    assert.equal(input.id, message.id);
    for (const changed of [
        { ...message, channel_id: 'other' }, { ...message, author: { bot: true } },
        { ...message, webhook_id: 'webhook' }, { ...message, attachments: [] },
    ]) assert.deepEqual(imagesFromMessage(changed, channel), []);
    for (const url of [
        'https://example.com/a.png', 'http://cdn.discordapp.com/attachments/1/2/a.png',
        'https://cdn.discordapp.com.evil.invalid/attachments/1/2/a.png',
        'https://cdn.discordapp.com:8443/attachments/1/2/a.png',
    ]) assert.throws(() => attachmentURL(url));
    for (const invalid of [{ ...input, url: 'https://example.com/image.png' }, { ...input, mime: 'text/plain' }, { ...input, size: MAX_IMAGE_BYTES + 1 }]) {
        let calls = 0;
        await assert.rejects(downloadImage(invalid, async () => { calls++; return new Response(new Uint8Array([1])); }), DiscordInputError);
        assert.equal(calls, 0);
    }
    for (const status of [200, 302, 403, 404, 429]) {
        let calls = 0;
        let cancelled = false;
        await assert.rejects(downloadImage(input, async (_url, init) => {
            calls++;
            assert.equal(init?.redirect, 'manual');
            assert.ok(init?.signal);
            return new Response(new ReadableStream({
                start(controller) { controller.enqueue(new Uint8Array(status === 200 ? MAX_IMAGE_BYTES + 1 : 1)); },
                cancel() { cancelled = true; },
            }), { status, headers: { Location: 'https://example.com/image.png' } });
        }), DiscordInputError);
        assert.equal(calls, 1);
        assert.equal(cancelled, true);
    }
});

test('Image download retries transient failures once and discards incomplete response bytes', async t => {
    const [input] = imagesFromMessage(message, channel);
    const warnings = t.mock.method(console, 'warn', () => {});
    for (const failure of ['network', 'timeout', 'body', 'server']) {
        for (const recover of [true, false]) {
            let calls = 0;
            let cancelled = 0;
            const operation = downloadImage(input, async (_url, init) => {
                calls++;
                assert.equal(init?.signal?.aborted, false);
                if (recover && calls === 2) return new Response(new Uint8Array([1, 2, 3]));
                if (failure === 'network') throw new TypeError('Private network details');
                if (failure === 'timeout') throw new DOMException('Private timeout details', 'TimeoutError');
                if (failure === 'body') {
                    let partial = false;
                    return new Response(new ReadableStream({
                        pull(controller) {
                            if (partial) controller.error(new TypeError('Private stream details'));
                            else { partial = true; controller.enqueue(new Uint8Array([99])); }
                        },
                    }));
                }
                return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 });
            });
            if (recover) assert.deepEqual(await operation, new Uint8Array([1, 2, 3]));
            else await assert.rejects(operation, error => error instanceof DiscordInputError && /Discordから画像を取得できませんでした/.test(error.message));
            assert.equal(calls, 2);
            if (failure === 'server') assert.equal(cancelled, recover ? 1 : 2);
        }
    }
    const logs = JSON.stringify(warnings.mock.calls.map(call => call.arguments));
    assert.ok(!logs.includes('Private') && !logs.includes(input.url));
});

test('Discord captions correct OCR values and reply text never sends mentions', () => {
    assert.deepEqual(manualInput(manualCaption('デルビル', '8/3/11')), { pokemonId: 'houndour', ivs: [8, 3, 11] });
    assert.equal(manualInput(''), null);
    assert.throws(() => manualInput(manualCaption('デルビル', '16/3/11')));
    assert.throws(() => manualInput(manualCaption('存在しない名前', '8/3/11')));
    const result = buildDiscordRankResult(sampleResult());
    const payload = replyPayload(message, result.content);
    assert.deepEqual(payload.allowed_mentions, { parse: [], replied_user: false });
    assert.equal(payload.message_reference.message_id, message.id);
    assert.equal(payload.nonce, message.id);
    assert.equal(payload.enforce_nonce, true);
    assert.match(payload.content, /デルビル｜個体値 8 \/ 3 \/ 11/);
    assert.match(payload.content, /順位表を添付しました/);
    assert.ok(payload.content.length < 100);
    assert.ok(payload.content.length <= 2000);
});

test('Discord multipart requests carry the PNG and matching attachment metadata', async () => {
    const result = buildDiscordRankResult(sampleResult());
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const attachment = rankAttachment(result.card, message, result.content, png);
    let parsed: FormData | undefined;
    await discordRequest('/channels/123/messages', 'token', { method: 'POST', body: attachment.form }, async (url, init) => {
        const request = new Request(url, init);
        assert.match(request.headers.get('Content-Type') ?? '', /^multipart\/form-data; boundary=/);
        assert.equal(request.headers.get('Authorization'), 'Bot token');
        parsed = await request.formData();
        return Response.json({ id: 'reply' });
    });
    const payload = JSON.parse(String(parsed!.get('payload_json')));
    const file = parsed!.get('files[0]');
    assert.ok(file instanceof File);
    assert.equal(file.name, attachment.filename);
    assert.equal(file.type, 'image/png');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), png);
    assert.deepEqual(payload.attachments, [{ id: 0, filename: attachment.filename, description: attachment.description }]);
    assert.equal(payload.content, result.content);
    assert.equal(payload.nonce, message.id);
    assert.equal(payload.enforce_nonce, true);
    assert.deepEqual(payload.allowed_mentions, { parse: [], replied_user: false });
    assert.equal(payload.message_reference.message_id, message.id);
});

test('Multiple images retain order and get numbered replies with distinct nonces', () => {
    const caption = manualCaption('デルビル', '8/3/11');
    assert.equal(imagesFromMessage({ ...message, content: caption }, channel)[0].caption, caption);
    const attachments = Array.from({ length: 20 }, (_, i) => ({
        ...message.attachments[0], url: `https://cdn.discordapp.com/attachments/1/2/${i}.png`,
    }));
    const images = imagesFromMessage({
        ...message, content: caption, attachments: [attachments[0], { content_type: 'text/plain' }, ...attachments.slice(1)],
    }, channel);
    assert.deepEqual(images.map(image => image.url), attachments.map(image => image.url));
    const payloads = images.map(image => replyPayload(image, 'x'.repeat(2000)));
    assert.equal(new Set(payloads.map(payload => payload.nonce)).size, 20);
    for (const [i, image] of images.entries()) {
        assert.equal(image.caption, '');
        const payload = payloads[i];
        assert.ok(payload.content.startsWith(`${i + 1}枚目／全20枚\n`));
        assert.equal(payload.content.length, 2000);
        assert.equal(payload.message_reference.message_id, message.id);
        assert.ok(payload.nonce.length <= 25);
        assert.equal(replyPayload(structuredClone(image), 'retry').nonce, payload.nonce);
    }
});

test('Structured rank results preserve boundary ranks for the source and evolutions', () => {
    const result = sampleResult();
    for (const row of result.rows) {
        row.rank = row.maxLevel === 50 ? (row.cap === 500 ? 1 : row.cap === 1500 ? 30 : 31) : 2;
    }
    const card = buildDiscordRankResult(result).card;
    assert.deepEqual(card.rows.map(row => row.leagues.map(cell => cell.rank)), [
        [30, 31, 1, 31],
        [30, 31, 1, 31],
    ]);
    assert.deepEqual(card.rows.map(row => row.role), ['本人', '進化候補']);
});
