import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await Promise.all([
    mkdir('dist/ocr', { recursive: true }),
    mkdir('dist/fonts', { recursive: true }),
    mkdir('dist/licenses', { recursive: true }),
]);
await Promise.all([
    cp('node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz', 'dist/ocr/jpn.traineddata.gz'),
    cp('node_modules/@expo-google-fonts/biz-udpgothic/400Regular/BIZUDPGothic_400Regular.ttf', 'dist/fonts/BIZUDPGothic-Regular.ttf'),
    cp('node_modules/@expo-google-fonts/biz-udpgothic/700Bold/BIZUDPGothic_700Bold.ttf', 'dist/fonts/BIZUDPGothic-Bold.ttf'),
    cp('public/licenses/biz-udpgothic.txt', 'dist/licenses/biz-udpgothic.txt'),
]);
