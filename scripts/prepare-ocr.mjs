import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/ocr', { recursive: true });
await cp('node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz', 'dist/ocr/jpn.traineddata.gz');
