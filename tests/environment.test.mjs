import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { examples } from "../src/examples.ts";
import {
  prepareNative,
  execute,
  measure,
  equalValues,
} from "../src/runtime.mjs";
import { parseExactJSON, stringifyExactJSON } from "../src/exact-json.mjs";
const { instance } = await WebAssembly.instantiate(
    await readFile("public/ink-compiler.wasm"),
    {},
  ),
  e = instance.exports;
function request(value) {
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
const compile = (source) => request({ op: "compile", source });
const prepare = (artifact, entry, input) =>
  request({
    op: "prepare",
    core: artifact.core,
    identity: artifact.manifest.core_sha256,
    entry,
    input,
  }).input;
const load = (artifact) =>
  import(
    "data:text/javascript;base64," +
      Buffer.from(artifact.javascript).toString("base64")
  );
test("every shipped example uses the checker and exact input boundary", () => {
  for (const example of examples) {
    const artifact = compile(example.source);
    assert.ok(prepare(artifact, example.entry, example.input));
    assert.equal(
      !!artifact.bundle,
      ["adaptive", "pipeline"].includes(example.id),
    );
  }
});
test("pipeline rejects untyped ports, forward references and domain errors", () => {
  const artifact = compile(examples[0].source);
  for (const input of [
    { steps: [{ id: "x", call: "adjust", args: [{ step: "later" }] }] },
    { steps: [{ id: "x", call: "adjust", args: [[-1]] }] },
    {
      steps: [
        { id: "x", call: "total", args: [[1]] },
        { id: "y", call: "adjust", args: [{ step: "x" }] },
      ],
    },
  ])
    assert.throws(() => prepare(artifact, "@pipeline", JSON.stringify(input)));
});
test("compiled state maintains results and rolls back a failed change", async () => {
  for (const id of ["prices", "rollback"]) {
    const example = examples.find((x) => x.id === id),
      artifact = compile(example.source),
      module = await load(artifact);
    const input = prepareNative(
      prepare(artifact, example.entry, example.input),
      example.entry,
      module.metadata,
    );
    const results = await execute(module, example.entry, input);
    if (id === "prices") {
      assert.equal(results[2].result, 100n);
      assert.equal(results[4].result, 105n);
    } else assert.deepEqual(results.at(-1).result, { Some: 42n });
  }
});
test("exact u64 reaches generated JS without rounding", async () => {
  const artifact = compile("module exact; fn word(x:u64)->u64{return x;}"),
    module = await load(artifact);
  const input = prepareNative(
    prepare(artifact, "word", "[18446744073709551615]"),
    "word",
    module.metadata,
  );
  assert.equal(await execute(module, "word", input), 18446744073709551615n);
  assert.throws(() => prepare(artifact, "word", "[18446744073709551616]"));
});
test("benchmark consumes outputs and checks exact repeated values", async () => {
  let calls = 0;
  const module = {
    metadata: { functions: [{ name: "f" }] },
    call: () => {
      calls++;
      return { out: [1, 2, 3] };
    },
  };
  const result = await measure(module, "f", [], true);
  assert.equal(result.samples.length, 9);
  assert.ok(calls > 9);
  assert.equal(result.digest.cells, 5);
  assert.equal(equalValues(-0, 0), false);
  assert.equal(equalValues({ x: 1 }, { x: 2 }), false);
  assert.equal(
    stringifyExactJSON(parseExactJSON("[18446744073709551615]")),
    "[18446744073709551615]",
  );
});
