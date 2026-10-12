/// <reference lib="webworker" />
import { compileWasm, publishBundle } from "./clang.mjs";
let instance: WebAssembly.Instance | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
let loadMs = 0;
async function initialise(url: string) {
  const start = performance.now();
  const response = await fetch(url);
  if (!response.ok)
    throw Error(`Compiler download failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  instance = (await WebAssembly.instantiate(bytes, {})).instance;
  loadMs = performance.now() - start;
}
function request(value: unknown) {
  const exports = instance!.exports as unknown as {
    memory: WebAssembly.Memory;
    ink_env_alloc(n: number): number;
    ink_env_free(p: number, n: number): void;
    ink_env_request(p: number, n: number): number;
    ink_env_response_len(): number;
  };
  const bytes = encoder.encode(JSON.stringify(value));
  const input = exports.ink_env_alloc(bytes.length);
  if (!input) throw Error("Compiler request exceeds its memory limit.");
  try {
    new Uint8Array(exports.memory.buffer, input, bytes.length).set(bytes);
    const output = exports.ink_env_request(input, bytes.length);
    const length = exports.ink_env_response_len();
    if (length > 16 * 1024 * 1024)
      throw Error("Compiler response exceeds 16 MiB.");
    const message = JSON.parse(
      decoder.decode(new Uint8Array(exports.memory.buffer, output, length)),
    );
    if (message.error) throw Error(message.error);
    return message.ok;
  } finally {
    exports.ink_env_free(input, bytes.length);
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (!instance) await initialise(data.compilerUrl);
    const start = performance.now();
    const value = request(data.request);
    if (data.request.op === "compile" && value.bundle) {
      const base = new URL("./", data.compilerUrl).href;
      const wasm = await compileWasm(value.bundle, base, (message: string) =>
        self.postMessage({ id: data.id, progress: message }),
      );
      value.bundleUrl = await publishBundle(value, wasm, base);
      value.wasmBytes = wasm.byteLength;
    }
    self.postMessage({
      id: data.id,
      ok: value,
      elapsedMs: performance.now() - start,
      loadMs,
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: String(error instanceof Error ? error.message : error),
    });
  }
};
