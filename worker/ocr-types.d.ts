declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
    const createCore: (options: Record<string, unknown>) => Promise<any>;
    export default createCore;
}

declare module '*.wasm' {
    const module: WebAssembly.Module;
    export default module;
}
