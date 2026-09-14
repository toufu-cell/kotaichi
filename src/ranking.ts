export interface Pokemon {
    id: string;
    dex: number;
    name: string;
    label: string;
    englishName: string;
    stats: { atk: number; def: number; hp: number };
    types: string[];
    evolutions: string[];
}

export type IVs = [number, number, number];
export interface RankedSpread {
    ivs: IVs;
    level: number;
    cp: number;
    attack: number;
    defense: number;
    hp: number;
    product: number;
    rank: number;
    percent: number;
}

export function validateIVs(ivs: IVs) {
    if (ivs.length !== 3 || !ivs.every(value => Number.isInteger(value) && value >= 0 && value <= 15)) {
        throw new Error('個体値は0〜15の整数で入力してください。');
    }
}

export function battleStats(pokemon: Pokemon, ivs: IVs, level: number, cpms: number[]) {
    const cpm = cpms[(level - 1) * 2];
    if (!cpm) throw new Error('対応していないポケモンレベルです。');
    const attack = (pokemon.stats.atk + ivs[0]) * cpm;
    const defense = (pokemon.stats.def + ivs[1]) * cpm;
    const hp = Math.max(10, Math.floor((pokemon.stats.hp + ivs[2]) * cpm));
    const cp = Math.max(10, Math.floor((pokemon.stats.atk + ivs[0]) * Math.sqrt(pokemon.stats.def + ivs[1]) * Math.sqrt(pokemon.stats.hp + ivs[2]) * cpm * cpm / 10));
    return { level, cp, attack, defense, hp, product: attack * defense * hp };
}

export function rankSpreads(pokemon: Pokemon, cap: number, maxLevel: number, cpms: number[]): RankedSpread[] {
    if (![500, 1500, 2500, Infinity].includes(cap) || ![40, 50, 51].includes(maxLevel)) throw new Error('計算条件を選び直してください。');
    const spreads: RankedSpread[] = [];
    for (let attack = 0; attack <= 15; attack++) {
        for (let defense = 0; defense <= 15; defense++) {
            for (let hp = 0; hp <= 15; hp++) {
                const ivs: IVs = [attack, defense, hp];
                let low = 0;
                let high = (maxLevel - 1) * 2;
                if (battleStats(pokemon, ivs, 1, cpms).cp > cap) continue;
                while (low < high) {
                    const middle = Math.ceil((low + high) / 2);
                    if (battleStats(pokemon, ivs, middle / 2 + 1, cpms).cp <= cap) low = middle;
                    else high = middle - 1;
                }
                spreads.push({ ivs, ...battleStats(pokemon, ivs, low / 2 + 1, cpms), rank: 0, percent: 0 });
            }
        }
    }
    spreads.sort((a, b) => b.product - a.product);
    for (let index = 0; index < spreads.length; index++) {
        const spread = spreads[index];
        spread.rank = index > 0 && Math.abs(spread.product - spreads[index - 1].product) < 1e-7 ? spreads[index - 1].rank : index + 1;
        spread.percent = spread.product / spreads[0].product * 100;
    }
    return spreads;
}

export function evolutionFamily(pokemon: Pokemon, catalog: Pokemon[]): Pokemon[] {
    const result: Pokemon[] = [];
    const visit = (entry: Pokemon) => {
        if (result.some(p => p.id === entry.id)) return;
        result.push(entry);
        entry.evolutions.forEach(id => {
            const target = catalog.find(p => p.id === id);
            if (target) visit(target);
        });
    };
    visit(pokemon);
    return result;
}
