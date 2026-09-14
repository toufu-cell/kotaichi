import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { battleStats, evolutionFamily, rankSpreads, validateIVs, type Pokemon, type IVs } from '../src/ranking.ts';
const data = JSON.parse(readFileSync(new URL('../src/data/pokemon.json', import.meta.url), 'utf8'));
const pokemon = (id: string): Pokemon => data.pokemon.find((entry: Pokemon) => entry.id === id);

test('PvP IVsのヘルガー8/3/11と順位・CP・PLが一致する', () => {
    const table = rankSpreads(pokemon('houndoom'), 1500, 50, data.cpms);
    const result = table.find(spread => spread.ivs.join() === '8,3,11')!;
    assert.equal(table.length, 4096);
    assert.deepEqual([result.rank, result.cp, result.level, result.hp], [1654, 1495, 21.5, 118]);
    assert.equal(result.percent.toFixed(2), '95.36');
    assert.deepEqual(table[0].ivs, [0, 13, 13]);
});

test('レベル上限に応じたマリルリ1位と育成可能な最大PLを返す', () => {
    for (const [maxLevel, ivs, level, cp] of [[40, [8, 15, 15], 40, 1500], [50, [0, 15, 15], 45.5, 1499], [51, [0, 15, 15], 45.5, 1499]] as const) {
        const table = rankSpreads(pokemon('azumarill'), 1500, maxLevel, data.cpms);
        assert.deepEqual([table[0].ivs, table[0].level, table[0].cp], [ivs, level, cp]);
        for (const spread of table) {
            assert.ok(spread.cp <= 1500 && spread.level <= maxLevel);
            if (spread.level < maxLevel) assert.ok(battleStats(pokemon('azumarill'), spread.ivs, spread.level + 0.5, data.cpms).cp > 1500);
        }
    }
    const master = rankSpreads(pokemon('houndoom'), Infinity, 51, data.cpms);
    assert.deepEqual(master[0].ivs, [15, 15, 15]);
    assert.equal(master[0].level, 51);
});

test('HP切捨てで積が同じになる個体は同順位にする', () => {
    const table = rankSpreads(pokemon('medicham'), 1500, 50, data.cpms);
    const tied = table.filter(spread => spread.rank === 1);
    assert.deepEqual(tied.map(spread => spread.ivs), [[5, 15, 14], [5, 15, 15]]);
});

test('種族値・和名・進化先の対応が一意で、前方向の進化だけを表示する', () => {
    assert.equal(new Set(data.pokemon.map((p: Pokemon) => p.id)).size, data.pokemon.length);
    assert.equal(new Set(data.pokemon.map((p: Pokemon) => p.label)).size, data.pokemon.length);
    for (const entry of data.pokemon as Pokemon[]) {
        assert.ok(entry.name && Object.values(entry.stats).every(value => value > 0));
        assert.ok(entry.evolutions.every(id => pokemon(id)));
    }
    assert.deepEqual(evolutionFamily(pokemon('houndour'), data.pokemon).map(p => p.id), ['houndour', 'houndoom']);
    assert.deepEqual(evolutionFamily(pokemon('houndoom'), data.pokemon).map(p => p.id), ['houndoom']);
    assert.equal(evolutionFamily(pokemon('eevee'), data.pokemon).length, 9);
    assert.deepEqual(evolutionFamily(pokemon('bulbasaur'), data.pokemon).map(p => p.id), ['bulbasaur', 'ivysaur', 'venusaur']);
});

test('範囲外・小数・空欄に由来する不正な個体値を拒否する', () => {
    for (const ivs of [[-1, 3, 11], [16, 3, 11], [8.5, 3, 11], [NaN, 3, 11], [Infinity, 3, 11]]) assert.throws(() => validateIVs(ivs as IVs));
    assert.doesNotThrow(() => validateIVs([0, 0, 0]));
    assert.doesNotThrow(() => validateIVs([15, 15, 15]));
});
