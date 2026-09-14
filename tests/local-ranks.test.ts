import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRanks } from '../worker/local-ranks.ts';
import { formatRanks } from '../worker/discord.ts';

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

test('Branch evolutions fit in a Discord reply and are explicitly conditional candidates', () => {
    const result = calculateRanks({ pokemonId: 'eevee', ivs: [0, 15, 15] });
    assert.equal(result.rows.length, 36);
    const reply = formatRanks(result);
    assert.ok(reply.length <= 2000);
    for (const name of ['シャワーズ', 'サンダース', 'ブースター', 'エーフィ', 'ブラッキー', 'リーフィア', 'グレイシア', 'ニンフィア']) {
        assert.ok(reply.includes(`${name}（進化候補）`));
    }
    assert.match(reply, /進化条件は判定しません/);
    assert.doesNotMatch(reply, /GameWith|PL51|PL40/);
});
