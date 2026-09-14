import type { IVs, Pokemon } from './ranking.ts';

interface Pixels { data: Uint8ClampedArray; width: number; height: number }
export interface Bar { x: number; y: number; width: number; height: number; value: number }

function pixelType(data: Uint8ClampedArray, index: number) {
    const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
    if (r > 205 && g > 95 && g < 205 && b < 145 && r - g > 40) return 2;
    if (r > 205 && g > 65 && g < 175 && b > 70 && b < 180 && r - g > 65) return 2;
    if (r >= 195 && r < 242 && Math.abs(r - g) < 9 && Math.abs(g - b) < 9) return 1;
    return 0;
}

export function detectBars(pixels: Pixels): { ivs: IVs; bars: Bar[] } | null {
    const { data, width, height } = pixels;
    const rows: Bar[] = [];
    const gapLimit = Math.max(3, Math.round(width * 0.009));
    for (let y = Math.floor(height * 0.4); y < height * 0.94; y++) {
        let start = -1;
        let last = -1;
        let colorEnd = -1;
        let count = 0;
        const finish = () => {
            const length = last - start + 1;
            if (start >= width * 0.035 && start < width * 0.25 && length >= width * 0.26 && length <= width * 0.5 && count / length > 0.86) {
                const raw = colorEnd < 0 ? 0 : (colorEnd - start + 1) / length * 15;
                const dividers = [1 / 3, 2 / 3].every(fraction => {
                    const center = Math.round(start + length * fraction);
                    for (let x = center - Math.ceil(width * 0.005); x <= center + Math.ceil(width * 0.005); x++) {
                        const index = (y * width + x) * 4;
                        if (data[index] > 242 && data[index + 1] > 242 && data[index + 2] > 242) return true;
                    }
                    return false;
                });
                if (dividers && Math.abs(raw - Math.round(raw)) < 0.24) rows.push({ x: start, y, width: length, height: 1, value: Math.round(raw) });
            }
            start = -1; last = -1; colorEnd = -1; count = 0;
        };
        for (let x = Math.floor(width * 0.03); x < width * 0.75; x++) {
            const type = pixelType(data, (y * width + x) * 4);
            if (type) {
                if (start < 0) start = x;
                last = x;
                count++;
                if (type === 2) colorEnd = x;
            } else if (start >= 0 && x - last > gapLimit) finish();
        }
        finish();
    }
    const groups: Bar[][] = [];
    for (const row of rows) {
        const group = groups.at(-1);
        if (group && row.y - group.at(-1)!.y <= 2 && Math.abs(row.x - group[0].x) < width * 0.02) group.push(row);
        else groups.push([row]);
    }
    const bars = groups.filter(group => group.length >= Math.max(3, width * 0.004) && group.length < width * 0.04 && group.filter(row => row.value === group[Math.floor(group.length / 2)].value).length / group.length > 0.7).map(group => {
        const middle = group[Math.floor(group.length / 2)];
        return { ...middle, height: group.length };
    });
    const matches: Bar[][] = [];
    for (let index = 0; index + 2 < bars.length; index++) {
        const three = bars.slice(index, index + 3);
        const gap1 = three[1].y - three[0].y;
        const gap2 = three[2].y - three[1].y;
        if (gap1 > width * 0.045 && gap1 < width * 0.18 && Math.abs(gap1 - gap2) < width * 0.015 && three.every(bar => Math.abs(bar.x - three[0].x) < width * 0.015 && Math.abs(bar.width - three[0].width) < width * 0.015)) matches.push(three);
    }
    if (matches.length !== 1) return null;
    return { ivs: matches[0].map(bar => bar.value) as IVs, bars: matches[0] };
}

export function nameRectangle(pixels: Pixels) {
    const { data, width, height } = pixels;
    let healthY = -1;
    for (let y = Math.floor(height * 0.22); y < height * 0.65; y++) {
        let green = 0;
        for (let x = Math.floor(width * 0.22); x < width * 0.78; x++) {
            const index = (y * width + x) * 4;
            const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
            if (g > 160 && g > r * 1.2 && b > 100 && g > b * 1.05) green++;
        }
        const whiteMargins = [0.2, 0.8].every(fraction => {
            const index = (y * width + Math.round(width * fraction)) * 4;
            return data[index] > 242 && data[index + 1] > 242 && data[index + 2] > 235;
        });
        if (green > width * 0.38 && whiteMargins) { healthY = y; break; }
    }
    return healthY >= 0
        ? { left: Math.round(width * 0.17), top: Math.max(0, Math.round(healthY - width * 0.135)), width: Math.round(width * 0.66), height: Math.round(width * 0.115) }
        : { left: Math.round(width * 0.16), top: Math.round(height * 0.32), width: Math.round(width * 0.68), height: Math.round(height * 0.2) };
}

function normalize(text: string) {
    return text.normalize('NFKC').toLowerCase().replace(/[\u3041-\u3096]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60)).replace(/[^\p{L}\p{N}♀♂ー]/gu, '');
}

export function matchNames(text: string, catalog: Pokemon[]): Pokemon[] {
    const normalized = normalize(text);
    if (!normalized) return [];
    let matches = catalog.filter(p => normalized.includes(normalize(p.name)) || normalized === normalize(p.englishName));
    if (!matches.length) {
        const withoutVoicing = (value: string) => value.normalize('NFD').replace(/[\u3099\u309a]/g, '');
        matches = catalog.filter(p => withoutVoicing(normalized) === withoutVoicing(normalize(p.name)));
    }
    const longest = Math.max(0, ...matches.map(p => normalize(p.name).length));
    return matches.filter(p => normalize(p.name).length === longest);
}
