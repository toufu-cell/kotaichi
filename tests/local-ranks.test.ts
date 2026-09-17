import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRanks } from '../worker/local-ranks.ts';
import { buildDiscordRankResult } from '../src/discord-card.ts';

test('Local ranks return PL50 by default and independently calculate each league and evolution', () => {
    const result = calculateRanks({ pokemonId: 'houndour', ivs: [8, 3, 11] });
    assert.equal(result.sourceId, 'houndour');
    assert.equal(result.rows.length, 8);
    assert.ok(result.rows.every(row => row.maxLevel === 50 && row.scp === null && !row.inheritedRank));
    const evolved = result.rows.filter(row => row.sourceId === 'houndoom');
    assert.deepEqual(evolved.map(row => [row.cap, row.rank, row.cp, row.level]), [
        [500, 2786, 475, 7], [1500, 1654, 1495, 21.5], [2500, 2338, 2496, 42], [null, 2299, 2752, 50],
    ]);
    const web = calculateRanks({ pokemonId: 'azumarill', ivs: [0, 15, 15] }, [40, 50, 51]);
    const great = web.rows.filter(row => row.cap === 1500);
    assert.deepEqual(great.map(row => [row.maxLevel, row.level, row.cp]), [[40, 40, 1400], [50, 45.5, 1499], [51, 45.5, 1499]]);
    assert.equal(great[1].rank, 1);
    assert.throws(() => calculateRanks({ pokemonId: 'missing', ivs: [0, 0, 0] }));
    assert.throws(() => calculateRanks({ pokemonId: 'houndour', ivs: [16, 0, 0] }));
});

test('Branch evolutions are all retained as explicit candidates', () => {
    const result = calculateRanks({ pokemonId: 'eevee', ivs: [0, 15, 15] });
    assert.equal(result.rows.length, 36);
    for (const row of result.rows) row.rank = row.sourceId === 'sylveon' ? 30 : 31;
    const reply = buildDiscordRankResult(result);
    assert.equal(reply.card.rows.length, 9);
    for (const name of ['シャワーズ', 'サンダース', 'ブースター', 'エーフィ', 'ブラッキー', 'リーフィア', 'グレイシア', 'ニンフィア']) {
        assert.ok(reply.card.rows.some(row => row.name === name && row.role === '進化候補'));
    }
    assert.deepEqual(reply.card.rows.map(row => row.name), [
        'イーブイ', 'ニンフィア', 'シャワーズ', 'サンダース', 'ブースター',
        'エーフィ', 'ブラッキー', 'リーフィア', 'グレイシア',
    ]);
    assert.ok(reply.content.length < 100);
});
