import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesFromMessage, manualInput, attachmentURL, downloadImage, replyPayload, formatRanks, MAX_IMAGE_BYTES, DiscordInputError } from '../worker/discord.ts';
import { sampleResult } from './rank-fixture.mjs';

const channel = '123456789012345678';
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
    assert.deepEqual(manualInput('デルビル 8/3/11'), { pokemonId: 'houndour', ivs: [8, 3, 11] });
    assert.equal(manualInput(''), null);
    assert.throws(() => manualInput('デルビル 16/3/11'));
    assert.throws(() => manualInput('存在しない名前 8/3/11'));
    const payload = replyPayload(message, formatRanks(sampleResult()));
    assert.deepEqual(payload.allowed_mentions, { parse: [], replied_user: false });
    assert.equal(payload.message_reference.message_id, message.id);
    assert.equal(payload.nonce, message.id);
    assert.equal(payload.enforce_nonce, true);
    assert.match(payload.content, /1,654位/);
    assert.match(payload.content, /PL50/);
    assert.ok(payload.content.includes('計算用データ：PvPoke https://github.com/pvpoke/pvpoke'));
    assert.match(payload.content, /ヘルガー（進化候補）/);
    assert.match(payload.content, /同率は同順位/);
    assert.ok(payload.content.length <= 2000);
});

test('Multiple images retain order and get numbered replies with distinct nonces', () => {
    const caption = 'デルビル 8/3/11';
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

test('Only PL50 ranks from 1 through 30 are highlighted, including evolutions', () => {
    const result = sampleResult();
    for (const row of result.rows) {
        row.rank = row.maxLevel === 50 ? (row.cap === 500 ? 1 : row.cap === 1500 ? 30 : 31) : 2;
    }
    const reply = formatRanks(result);
    assert.equal(reply.match(/⭐ \*\*スーパー：30位\*\*/g)?.length, 2);
    assert.equal(reply.match(/⭐ \*\*リトル：1位\*\*/g)?.length, 2);
    assert.match(reply, /ハイパー：31位/);
    assert.doesNotMatch(reply, /\*\*[^\n]*31位|2位|PL40|PL51/);
});
