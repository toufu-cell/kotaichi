import type { RankRequest, RankResponse } from '../src/api.ts';
import { formatRanks, type DiscordImage } from './discord.ts';
import type { ImageRecognition } from './ocr.ts';

export async function discordImageResult(
    image: DiscordImage,
    recognize: (image: DiscordImage) => Promise<ImageRecognition>,
    lookup: (input: RankRequest) => Promise<RankResponse>,
) {
    const input = await recognize(image);
    const requests = 'candidateIds' in input ? input.candidateIds.map(pokemonId => ({ pokemonId, ivs: input.ivs })) : [input];
    const results: RankResponse[] = [];
    for (const request of requests) results.push(await lookup(request));
    return formatRanks({ ...results[0], rows: results.flatMap(result => result.rows) }, requests.map(request => request.pokemonId));
}
