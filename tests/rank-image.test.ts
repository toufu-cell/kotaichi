import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDiscordRankResult } from '../src/discord-card.ts';
import { calculateRanks } from '../worker/local-ranks.ts';
import { createRankImageRenderer, rankCardSvg, wrapRankCardName } from '../worker/rank-image.ts';

test('Rank image keeps every branch and distinguishes ranks 1, 30 and 31', async () => {
    const longName = 'ピカチュウ（5th Anniversary）';
    const wrapped = wrapRankCardName(longName);
    assert.equal(wrapped.join(''), longName);
    assert.ok(wrapped.length <= 3);
    assert.equal(wrapRankCardName('イシツブテ（アローラ）')[0], 'イシツブテ');
    const result = calculateRanks({ pokemonId: 'eevee', ivs: [0, 15, 15] });
    const card = buildDiscordRankResult(result, undefined, { position: 2, total: 3 }).card;
    for (const row of card.rows) for (const cell of row.leagues) cell.rank = 31;
    card.rows[0].leagues[0].rank = 1;
    card.rows[0].leagues[1].rank = 30;
    const svg = rankCardSvg(card);
    assert.equal(card.rows.length, 9);
    for (const row of card.rows) assert.ok(svg.includes(row.name));
    assert.equal(svg.match(/data-top-rank="true"/g)?.length, 2);
    assert.equal(svg.match(/fill="#FFF0C2"/g)?.length, 2);
    assert.match(svg, /data-rank="1" data-top-rank="true">★ 1位/);
    assert.match(svg, /data-rank="30" data-top-rank="true">★ 30位/);
    assert.match(svg, /data-rank="31" data-top-rank="false">31位/);
    assert.match(svg, /2枚目／全3枚/);

    const [wasmBytes, regular, bold] = await Promise.all([
        readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'),
        readFile('node_modules/@expo-google-fonts/biz-udpgothic/400Regular/BIZUDPGothic_400Regular.ttf'),
        readFile('node_modules/@expo-google-fonts/biz-udpgothic/700Bold/BIZUDPGothic_700Bold.ttf'),
    ]);
    const wasm = await WebAssembly.compile(wasmBytes);
    let fontLoads = 0;
    const render = createRankImageRenderer(wasm, async () => {
        fontLoads++;
        if (fontLoads === 1) throw new Error('Temporary font failure.');
        return { regular, bold };
    });
    await assert.rejects(render(card), /Temporary font failure/);
    const png = await render(card);
    assert.equal(fontLoads, 2);
    assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const dimensions = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assert.equal(dimensions.getUint32(16), 1080);
    assert.ok(dimensions.getUint32(20) >= 1000);
});
