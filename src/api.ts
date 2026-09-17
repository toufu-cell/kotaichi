import type { IVs } from './ranking.ts';

export interface RankRequest {
    pokemonId: string;
    ivs: IVs;
}

export interface RemoteRank {
    sourceId: string;
    name: string;
    cap: 500 | 1500 | 2500 | null;
    maxLevel: 40 | 50 | 51;
    rank: number;
    cp: number | null;
    level: number | null;
    scp: number | null;
    inheritedRank: boolean;
}

export interface RankResponse {
    request: RankRequest;
    sourceId: string;
    fetchedAt: string;
    rows: RemoteRank[];
}
