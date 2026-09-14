export function sampleResult() {
    const rows = [];
    for (const maxLevel of [40, 50, 51]) {
        for (const [sourceId, name] of [['houndour', 'デルビル'], ['houndoom', 'ヘルガー']]) {
            for (const cap of [500, 1500, 2500, null]) {
                const isHoundoom = sourceId === 'houndoom';
                const high = cap === 2500 || cap === null;
                const rank = isHoundoom ? (cap === 500 ? 2786 : high ? (maxLevel === 40 ? 2399 : 2338) : 1654) : (cap === 500 ? 1181 : maxLevel === 51 ? 2501 : 2556);
                rows.push({ sourceId, name, cap, maxLevel, rank, cp: isHoundoom ? (cap === 500 ? 475 : high ? (maxLevel === 40 ? 2434 : 2496) : 1495) : (cap === 500 ? 499 : 1235), level: 21.5, scp: null, inheritedRank: false });
            }
        }
    }
    return { request: { pokemonId: 'houndour', ivs: [8, 3, 11] }, sourceId: 'houndour', fetchedAt: new Date().toISOString(), rows };
}
