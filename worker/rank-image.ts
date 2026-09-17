import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { RANK_CARD_LEAGUES, type RankCardData } from '../src/discord-card.ts';

const WIDTH = 1080;
const PADDING = 48;
const NAME_WIDTH = 270;
const HEADER_TOP = 190;
const COLUMN_HEADER_HEIGHT = 60;
const FOOTER_HEIGHT = 100;
const FONT_FAMILY = 'BIZ UDPGothic';
let initialized: Promise<void> | undefined;

export interface RankImageFonts {
    regular: Uint8Array;
    bold: Uint8Array;
}

function escapeXml(value: string) {
    const entities: Record<number, string> = {
        34: '&quot;', 38: '&amp;', 39: '&apos;', 60: '&lt;', 62: '&gt;',
    };
    return value.replace(/[&<>'\u0022]/g, character => entities[character.codePointAt(0)!]);
}

function characterUnits(character: string) {
    if (/\s/u.test(character)) return 0.35;
    if (/^[\u0000-\u024f]$/u.test(character)) return 0.58;
    return 1;
}

function wrapByUnits(value: string, maxUnits: number) {
    const lines: string[] = [];
    let line = '';
    let units = 0;
    for (const character of value) {
        const next = characterUnits(character);
        if (line && units + next > maxUnits) {
            lines.push(line);
            line = '';
            units = 0;
        }
        line += character;
        units += next;
    }
    if (line) lines.push(line);
    return lines;
}

export function wrapRankCardName(value: string, maxUnits = 9.4) {
    const parenthesis = value.indexOf(String.fromCodePoint(0xff08));
    if (parenthesis > 0 && [...value].reduce((sum, character) => sum + characterUnits(character), 0) > maxUnits) {
        return [
            ...wrapByUnits(value.slice(0, parenthesis), maxUnits),
            ...wrapByUnits(value.slice(parenthesis), maxUnits),
        ];
    }
    return wrapByUnits(value, maxUnits);
}

export function isTopRank(rank: number) {
    return rank >= 1 && rank <= 30;
}

function validateCard(card: RankCardData) {
    if (!card || typeof card.title !== 'string' || card.title.length < 1 || card.title.length > 80
        || !Array.isArray(card.ivs) || card.ivs.length !== 3
        || !card.ivs.every(value => Number.isInteger(value) && value >= 0 && value <= 15)
        || !Array.isArray(card.rows) || card.rows.length < 1 || card.rows.length > 20) throw new Error('Invalid rank card.');
    for (const row of card.rows) {
        if (typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 80
            || !['本人', 'フォルム候補', '進化候補'].includes(row.role)
            || !Array.isArray(row.leagues) || row.leagues.length !== 4) throw new Error('Invalid rank row.');
        for (const cell of row.leagues) {
            if (!cell || !Number.isInteger(cell.rank) || cell.rank < 1 || cell.rank > 4096
                || !Number.isInteger(cell.cp) || cell.cp < 10
                || typeof cell.level !== 'number' || !Number.isFinite(cell.level) || cell.level < 1 || cell.level > 50) {
                throw new Error('Invalid rank cell.');
            }
        }
    }
    if (card.imageNumber && (!Number.isInteger(card.imageNumber.position) || !Number.isInteger(card.imageNumber.total)
        || card.imageNumber.position < 1 || card.imageNumber.total < 2 || card.imageNumber.position > card.imageNumber.total)) {
        throw new Error('Invalid image number.');
    }
}

export function rankCardSvg(card: RankCardData) {
    validateCard(card);
    const wrappedNames = card.rows.map(row => wrapRankCardName(row.name));
    const rowHeights = wrappedNames.map(lines => lines.length === 1 ? 104 : 87 + (lines.length - 1) * 29);
    const tableTop = HEADER_TOP;
    const rowsTop = tableTop + COLUMN_HEADER_HEIGHT;
    const rowsHeight = rowHeights.reduce((sum, height) => sum + height, 0);
    const height = rowsTop + rowsHeight + FOOTER_HEIGHT;
    const tableWidth = WIDTH - PADDING * 2;
    const leagueWidth = (tableWidth - NAME_WIDTH) / 4;
    const parts: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`,
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        `<g font-family="${FONT_FAMILY}, sans-serif" fill="#26313D">`,
        `<text x="${PADDING}" y="82" font-size="42" font-weight="700">${escapeXml(card.title)}</text>`,
        `<text x="${PADDING}" y="130" font-size="27" font-weight="700">個体値 ${card.ivs.join(' / ')}</text>`,
    ];
    if (card.imageNumber) {
        parts.push(`<text x="${WIDTH - PADDING}" y="75" text-anchor="end" font-size="24" font-weight="700" fill="#647080">${card.imageNumber.position}枚目／全${card.imageNumber.total}枚</text>`);
    }
    if (card.formUncertain) {
        parts.push(`<text x="${PADDING}" y="167" font-size="21" fill="#647080">フォルム未確定：候補を画像と見比べてください。</text>`);
    }
    parts.push(
        `<rect x="${PADDING}" y="${tableTop}" width="${tableWidth}" height="${COLUMN_HEADER_HEIGHT}" fill="#FFFFFF" stroke="#DCE1E7"/>`,
        `<text x="${PADDING + 16}" y="${tableTop + 39}" font-size="20" font-weight="700" fill="#647080">本人・進化候補</text>`,
    );
    for (const [index, league] of RANK_CARD_LEAGUES.entries()) {
        const x = PADDING + NAME_WIDTH + leagueWidth * index;
        parts.push(
            `<line x1="${x}" y1="${tableTop}" x2="${x}" y2="${rowsTop + rowsHeight}" stroke="#DCE1E7"/>`,
            `<text x="${x + leagueWidth / 2}" y="${tableTop + 39}" text-anchor="middle" font-size="20" font-weight="700">${league}</text>`,
        );
    }
    let rowTop = rowsTop;
    for (const [rowIndex, row] of card.rows.entries()) {
        const rowHeight = rowHeights[rowIndex];
        parts.push(`<rect x="${PADDING}" y="${rowTop}" width="${tableWidth}" height="${rowHeight}" fill="#FFFFFF" stroke="#DCE1E7"/>`);
        const nameLines = wrappedNames[rowIndex];
        const nameStart = rowTop + (nameLines.length > 1 ? 31 : 40);
        for (const [lineIndex, line] of nameLines.entries()) {
            parts.push(`<text x="${PADDING + 16}" y="${nameStart + lineIndex * 29}" font-size="25" font-weight="700">${escapeXml(line)}</text>`);
        }
        parts.push(`<text x="${PADDING + 16}" y="${rowTop + rowHeight - 17}" font-size="18" fill="#647080">${row.role}</text>`);
        for (const [cellIndex, cell] of row.leagues.entries()) {
            const x = PADDING + NAME_WIDTH + leagueWidth * cellIndex;
            const top = isTopRank(cell.rank);
            if (top) parts.push(`<rect x="${x + 1}" y="${rowTop + 1}" width="${leagueWidth - 2}" height="${rowHeight - 2}" fill="#FFF0C2"/>`);
            parts.push(
                `<text x="${x + leagueWidth / 2}" y="${rowTop + rowHeight / 2 - 3}" text-anchor="middle" font-size="36" font-weight="700" fill="${top ? '#956000' : '#26313D'}" data-rank="${cell.rank}" data-top-rank="${top}">${top ? '★ ' : ''}${cell.rank.toLocaleString('ja-JP')}位</text>`,
                `<text x="${x + leagueWidth / 2}" y="${rowTop + rowHeight / 2 + 29}" text-anchor="middle" font-size="18" fill="#647080">CP${cell.cp.toLocaleString('ja-JP')}　PL${cell.level}</text>`,
            );
        }
        rowTop += rowHeight;
    }
    const footerTop = rowsTop + rowsHeight;
    parts.push(
        `<text x="${PADDING}" y="${footerTop + 42}" font-size="19" fill="#647080">PL50上限｜全4,096通り｜同率は同順位｜計算用データ：PvPoke</text>`,
        `<text x="${PADDING}" y="${footerTop + 73}" font-size="17" fill="#647080">現在のCPによる参加可否と、性別・地域・イベントなどの進化条件は判定対象外です。</text>`,
        '</g></svg>',
    );
    return parts.join('');
}

export function createRankImageRenderer(wasm: WebAssembly.Module, loadFonts: () => Promise<RankImageFonts>) {
    initialized ??= initWasm(wasm);
    let fonts: Promise<RankImageFonts> | undefined;
    const getFonts = () => {
        if (!fonts) {
            const loading = loadFonts().catch(error => {
                if (fonts === loading) fonts = undefined;
                throw error;
            });
            fonts = loading;
        }
        return fonts;
    };
    return async (card: RankCardData) => {
        await initialized;
        const loaded = await getFonts();
        const svg = rankCardSvg(card);
        const renderer = new Resvg(svg, {
            background: '#FFFFFF',
            shapeRendering: 2,
            textRendering: 1,
            font: {
                fontBuffers: [loaded.regular, loaded.bold],
                defaultFontFamily: FONT_FAMILY,
                sansSerifFamily: FONT_FAMILY,
            },
        });
        try {
            const image = renderer.render();
            try { return image.asPng(); }
            finally { image.free(); }
        } finally { renderer.free(); }
    };
}
