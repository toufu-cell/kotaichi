import { mkdir, writeFile } from 'node:fs/promises';

async function get(url, json = false) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Data fetch failed: ${response.status} ${url}`);
    return json ? response.json() : response.text();
}

const [pvpCommit, namesCommit] = await Promise.all([
    get('https://api.github.com/repos/pvpoke/pvpoke/commits/master', true),
    get('https://api.github.com/repos/PokeAPI/pokeapi/commits/master', true),
]);
const pvpRoot = `https://raw.githubusercontent.com/pvpoke/pvpoke/${pvpCommit.sha}`;
const namesRoot = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${namesCommit.sha}`;
const [gm, csv, pokemonCode, pvpLicense, namesLicense] = await Promise.all([
    get(`${pvpRoot}/src/data/gamemaster.json`, true),
    get(`${namesRoot}/data/v2/csv/pokemon_species_names.csv`),
    get(`${pvpRoot}/src/js/pokemon/Pokemon.js`),
    get(`${pvpRoot}/LICENSE`),
    get(`${namesRoot}/LICENSE.md`),
]);
const names = new Map(csv.split('\n').map(line => line.split(',')).filter(row => row[1] === '1').map(row => [Number(row[0]), row[2]]));
const excluded = p => p.released !== true || p.tags?.includes('mega') || p.tags?.includes('duplicate') || /_(shadow|mega|primal)/.test(p.speciesId);
const selected = gm.pokemon.filter(p => !excluded(p));
const ids = new Set(selected.map(p => p.speciesId));
const pokemon = selected.map(p => {
    const name = names.get(p.dex);
    if (!name || !['atk', 'def', 'hp'].every(key => Number.isFinite(p.baseStats[key]) && p.baseStats[key] > 0)) {
        throw new Error(`Invalid species data: ${p.speciesId}`);
    }
    const englishForm = p.speciesName.match(/\((.+)\)/)?.[1];
    const formNames = { Alolan: 'アローラ', Galarian: 'ガラル', Hisuian: 'ヒスイ', Paldean: 'パルデア', Female: 'メス', Male: 'オス', Normal: 'ノーマル', Attack: 'アタック', Defense: 'ディフェンス', Speed: 'スピード', Origin: 'オリジン', Altered: 'アナザー', Sunny: 'たいよう', Rainy: 'あまみず', Snowy: 'ゆきぐも' };
    const form = formNames[englishForm] ?? englishForm ?? (p.speciesId.includes('_') ? p.speciesId.split('_').slice(1).join(' ') : '');
    const evolutionAliases = { lycranroc_dusk: 'lycanroc_dusk' };
    const evolutions = (p.family?.evolutions ?? []).map(id => evolutionAliases[id] ?? id).filter(id => {
        if (ids.has(id)) return true;
        const target = gm.pokemon.find(entry => entry.speciesId === id);
        if (!target) throw new Error(`Missing evolution: ${p.speciesId} -> ${id}`);
        return false;
    });
    return { id: p.speciesId, dex: p.dex, name, label: form ? `${name}（${form}）` : name, englishName: p.speciesName, stats: p.baseStats, types: p.types.filter(type => type !== 'none'), evolutions };
});
if (ids.size !== pokemon.length || new Set(pokemon.map(p => p.label)).size !== pokemon.length || pokemon.length < 500) throw new Error('Invalid species catalog');
const cpms = JSON.parse(pokemonCode.match(/var cpms = (\[[^;]+\]);/)?.[1] ?? 'null').slice(0, 101);
if (cpms.length !== 101 || cpms.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= cpms[index - 1]))) throw new Error('Invalid CP multipliers');
await mkdir('src/data', { recursive: true });
await mkdir('public/licenses', { recursive: true });
await writeFile('src/data/pokemon.json', JSON.stringify({ updatedAt: new Date().toISOString(), gameMasterDate: gm.timestamp, pvpCommit: pvpCommit.sha, namesCommit: namesCommit.sha, pokemon, cpms }, null, 2) + '\n');
await writeFile('public/licenses/pvpoke.txt', pvpLicense);
await writeFile('public/licenses/pokeapi.txt', namesLicense);
console.log(`Prepared ${pokemon.length} species and forms.`);
