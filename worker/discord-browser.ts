import type { RankRequest, RankResponse } from '../src/api.ts';
import { buildDiscordRankResult } from '../src/discord-card.ts';
import type { DiscordImage } from './discord.ts';
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
    const imageNumber = image.total && image.total > 1 && image.position
        ? { position: image.position, total: image.total }
        : undefined;
    return buildDiscordRankResult(
        { ...results[0], rows: results.flatMap(result => result.rows) },
        requests.map(request => request.pokemonId),
        imageNumber,
    );
}
