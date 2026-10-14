import { readFile, writeFile, mkdir } from "node:fs/promises";
import { examples } from "../src/examples.ts";
const { instance } = await WebAssembly.instantiate(
    await readFile("public/ink-compiler.wasm"),
    {},
  ),
  e = instance.exports;
export function request(value) {
  const b = new TextEncoder().encode(JSON.stringify(value)),
    p = e.ink_env_alloc(b.length);
  new Uint8Array(e.memory.buffer, p, b.length).set(b);
  try {
    const out = e.ink_env_request(p, b.length);
    const v = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(e.memory.buffer, out, e.ink_env_response_len()),
      ),
    );
    if (v.error) throw Error(v.error);
    return v.ok;
  } finally {
    e.ink_env_free(p, b.length);
  }
}
for (const example of examples) {
  const artifact = request({ op: "compile", source: example.source });
  const prepared = request({
    op: "prepare",
    core: artifact.core,
    identity: artifact.manifest.core_sha256,
    entry: example.entry,
    input: example.input,
  });
  await mkdir(`.smoke/${example.id}`, { recursive: true });
  await writeFile(
    `.smoke/${example.id}/artifact.json`,
    JSON.stringify(artifact),
  );
  await writeFile(`.smoke/${example.id}/input.json`, prepared.input);
  console.log(
    `${example.id}: checked, ${artifact.bundle ? "JS/Rust/WGSL" : "host: " + artifact.host_reason}`,
  );
}
