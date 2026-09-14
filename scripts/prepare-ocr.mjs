import { cp, mkdir } from 'node:fs/promises';

await mkdir('public/ocr', { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
await cp('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt', 'public/ocr/worker.min.js.LICENSE.txt');
await cp('node_modules/tesseract.js/LICENSE.md', 'public/ocr/LICENSE.md');
await cp('node_modules/tesseract.js-core', 'public/ocr/core', { recursive: true });
await cp('node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz', 'public/ocr/jpn.traineddata.gz');
