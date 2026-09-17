import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBars, matchNames, nameRectangle } from '../src/detection.ts';
const catalog = JSON.parse(readFileSync(new URL('../src/data/pokemon.json', import.meta.url), 'utf8')).pokemon;

function appraisal(values: number[], width = 1000) {
    const height = Math.round(width * 2.16);
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const start = Math.round(width * 0.12);
    const length = Math.round(width * 0.345);
    values.forEach((value, row) => {
        const top = Math.round(height * 0.76 + row * width * 0.09);
        for (let y = top; y < top + Math.round(width * 0.018); y++) {
            for (let x = start; x < start + length; x++) {
                if ([1 / 3, 2 / 3].some(divider => Math.abs(x - start - length * divider) <= Math.max(1, width * 0.0015))) continue;
                const color = x - start < length * value / 15 ? (value === 15 ? [239, 126, 130] : [247, 163, 73]) : [227, 227, 229];
                data.set([...color, 255], (y * width + x) * 4);
            }
        }
    });
    return { data, width, height };
}

test('解像度が異なっても、0から15までの灰色・橙色・満点のバーを読む', () => {
    for (const width of [375, 750, 1000]) {
        for (let value = 0; value <= 15; value++) {
            const values = [value, 15 - value, 11];
            assert.deepEqual(detectBars(appraisal(values, width))?.ivs, values, `${width}px: ${values}`);
        }
    }
});

test('3本揃わない画像や目盛りの途中にある不確かな値は確定しない', () => {
    assert.equal(detectBars(appraisal([])), null);
    assert.equal(detectBars(appraisal([8, 3])), null);
    assert.equal(detectBars(appraisal([8.5, 3, 11])), null);
});

test('OCRの空白・濁点・小書きカナを補正し、完全表記と複数候補を優先する', () => {
    assert.deepEqual(matchNames('テル ビル\n', catalog).map(p => p.id), ['houndour']);
    assert.deepEqual(matchNames('デルビル', catalog).map(p => p.id), ['houndour']);
    assert.deepEqual(matchNames('ニヤ オハ 八', catalog).map(p => p.id), ['sprigatito']);
    assert.deepEqual(matchNames('ニヤ ロー テ', catalog).map(p => p.id), ['floragato']);
    assert.ok(matchNames('ロコン', catalog).length >= 2);
    const base = catalog[0];
    const exactCatalog = [{ ...base, id: 'small', name: 'ニャオハ' }, { ...base, id: 'large', name: 'ニヤオハ' }];
    assert.deepEqual(matchNames('ニヤオハ', exactCatalog).map(p => p.id), ['large']);
    const collisionCatalog = [{ ...base, id: 'small-ya', name: 'ニャオハ' }, { ...base, id: 'small-o', name: 'ニヤォハ' }];
    assert.deepEqual(matchNames('ニヤオハ', collisionCatalog).map(p => p.id), ['small-ya', 'small-o']);
    assert.deepEqual(matchNames('不明なニックネーム', catalog), []);
});

test('名前の切出し位置は緑の背景ではなく白いカード内のHPバーから決める', () => {
    for (const width of [375, 1000]) {
        const pixels = appraisal([13, 13, 12], width);
        const paint = (left: number, top: number, right: number, bottom: number, color: number[]) => {
            for (let y = Math.round(top); y < Math.round(bottom); y++) {
                for (let x = Math.round(left); x < Math.round(right); x++) pixels.data.set([...color, 255], (y * width + x) * 4);
            }
        };
        paint(0, pixels.height * 0.22, width, pixels.height * 0.36, [110, 235, 170]);
        assert.equal(nameRectangle(pixels).top, Math.round(pixels.height * 0.32));
        const healthY = Math.round(width * 0.98);
        paint(width * 0.25, healthY, width * 0.75, healthY + width * 0.012, [110, 235, 170]);
        const rectangle = nameRectangle(pixels);
        assert.equal(rectangle.top, Math.round(healthY - width * 0.135));
        assert.ok(rectangle.top + rectangle.height < healthY);
    }
});
