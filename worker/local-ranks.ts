import data from '../src/data/pokemon.json' with { type: 'json' };
import type { RankRequest, RankResponse, RemoteRank } from '../src/api.ts';
import { evolutionFamily, rankSpreads, validateIVs } from '../src/ranking.ts';

export function calculateRanks(request: RankRequest, maxLevels: RemoteRank['maxLevel'][] = [50]): RankResponse {
    validateIVs(request.ivs);
    const pokemon = data.pokemon.find(entry => entry.id === request.pokemonId);
    if (!pokemon || !maxLevels.length) throw new Error('Invalid calculation request.');
    const rows: RemoteRank[] = [];
    for (const entry of evolutionFamily(pokemon, data.pokemon)) {
        for (const maxLevel of maxLevels) {
            for (const cap of [500, 1500, 2500, null] as const) {
                const spread = rankSpreads(entry, cap ?? Infinity, maxLevel, data.cpms)
                    .find(spread => spread.ivs.every((value, index) => value === request.ivs[index]));
                if (!spread) throw new Error('No eligible spread.');
                rows.push({
                    sourceId: entry.id, name: entry.label, cap, maxLevel,
                    rank: spread.rank, cp: spread.cp, level: spread.level,
                    scp: null, inheritedRank: false,
                });
            }
        }
    }
    return { request, sourceId: pokemon.id, fetchedAt: new Date().toISOString(), rows };
}
