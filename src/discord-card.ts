import data from './data/pokemon.json' with { type: 'json' };
import type { RankResponse, RemoteRank } from './api.ts';
import type { IVs } from './ranking.ts';

export const RANK_CARD_LEAGUES = ['スーパー', 'ハイパー', 'リトル', 'マスター'] as const;

export interface RankCardCell {
    rank: number;
    cp: number;
    level: number;
}

export interface RankCardRow {
    name: string;
    role: '本人' | 'フォルム候補' | '進化候補';
    leagues: [RankCardCell, RankCardCell, RankCardCell, RankCardCell];
}

export interface RankCardData {
    title: string;
    ivs: IVs;
    formUncertain: boolean;
    imageNumber?: { position: number; total: number };
    rows: RankCardRow[];
}

export interface DiscordRankResult {
    content: string;
    card: RankCardData;
}

const CAPS = [1500, 2500, 500, null] as const;

function cellFor(rows: RemoteRank[], cap: typeof CAPS[number]): RankCardCell {
    const row = rows.find(candidate => candidate.maxLevel === 50 && candidate.cap === cap);
    if (!row || row.cp === null || row.level === null) throw new Error('Missing PL50 rank.');
    return { rank: row.rank, cp: row.cp, level: row.level };
}

export function buildDiscordRankResult(
    result: RankResponse,
    candidateIds = [result.request.pokemonId],
    imageNumber?: RankCardData['imageNumber'],
): DiscordRankResult {
    const pokemon = data.pokemon.find(entry => entry.id === result.request.pokemonId);
    if (!pokemon) throw new Error('Unknown Pokémon.');
    const candidates = candidateIds.map(id => data.pokemon.find(entry => entry.id === id));
    if (candidates.some(candidate => !candidate)) throw new Error('Unknown form candidate.');
    const candidateSet = new Set(candidateIds);
    const formUncertain = candidateSet.size > 1;
    const title = formUncertain ? `${pokemon.name}（フォルム未確定）` : pokemon.label;
    const sourceIds = [...new Set(result.rows.filter(row => row.maxLevel === 50).map(row => row.sourceId))];
    const priority = (sourceId: string) => {
        if (candidateSet.has(sourceId)) return 0;
        const rows = result.rows.filter(row => row.sourceId === sourceId && row.maxLevel === 50);
        if (rows.some(row => row.rank >= 1 && row.rank <= 30)) return 1;
        return /^(メガ|ゲンシ)/.test(rows[0]?.name ?? '') ? 3 : 2;
    };
    sourceIds.sort((left, right) => priority(left) - priority(right));
    const rows = sourceIds.map((sourceId): RankCardRow => {
        const ranks = result.rows.filter(row => row.sourceId === sourceId && row.maxLevel === 50);
        const name = ranks[0]?.name;
        if (!name) throw new Error('Missing rank candidate.');
        return {
            name,
            role: candidateSet.has(sourceId) ? (formUncertain ? 'フォルム候補' : '本人') : '進化候補',
            leagues: CAPS.map(cap => cellFor(ranks, cap)) as RankCardRow['leagues'],
        };
    });
    const ivs = result.request.ivs;
    const content = formUncertain
        ? `${title}｜個体値 ${ivs.join(' / ')}\nフォルム候補を順位表で確認してください。`
        : `${title}｜個体値 ${ivs.join(' / ')}\n順位表を添付しました。`;
    return { content, card: { title, ivs, formUncertain, imageNumber, rows } };
}
