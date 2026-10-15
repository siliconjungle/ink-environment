import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { examples } from "../src/examples.ts";
import {formatInk,formatJSON} from "../src/ink-syntax.mjs";
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
    assert.equal(typeof artifact.rust, "string");
    if (artifact.bundle) { assert.equal(typeof artifact.bundle.rust, "string"); assert.equal(Object.hasOwn(artifact.bundle, "c"), false); }
    assert.equal(
      !!artifact.bundle,
      ["adaptive", "pipeline", "queries", "generic", "contracts"].includes(example.id),
    );
  }
});
test("ordered query syntax preserves duplicates and composes with an ordinary consumer", async () => {
  const example=examples.find(x=>x.id==='queries');
  const artifact=compile(example.source), module=await load(artifact);
  assert.deepEqual(module.functions.selected([3,1,3,2],2),[9,9,6]);
  assert.equal(module.functions.total([3,1,3,2],2),24);
  assert.deepEqual(module.functions.selected([],0),[]);
  assert.equal(module.functions.total([],0),0);
  assert.deepEqual(module.functions.selected([4294967295],0),[4294967293]);
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
test("browser emission exposes owned portable and agreed-schema boundaries", async () => {
  const artifact = compile("module transport; record Packet { key:String, count:u64, bits:f32, } fn echo(packet:Packet)->Packet{return packet;}"), module = await load(artifact);
  const value = {key:"\ufeff雪",count:18446744073709551615n,bits:{F32Bits:0x7fa00001}}, codecs = module.valueCodecs.echo;
  for (const compact of [false,true]) {
    const input = compact ? codecs.arguments.compact() : codecs.arguments;
    const output = compact ? codecs.result.compact() : codecs.result;
    const bytes = input.encode({packet:value}), before = bytes.slice();
    const reply = (compact ? module.callCompact : module.callBinary)("echo",bytes);
    assert.deepEqual(bytes,before);assert.deepEqual(output.decode(reply),value);
    reply.fill(0);assert.deepEqual(bytes,before);
    for (let end=0;end<bytes.length;end++) assert.throws(()=>input.validate(bytes.subarray(0,end)));
  }
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


test("static contracts share collection semantics and reject false implementations", async () => {
  const example=examples.find(x=>x.id==="contracts"),artifact=compile(example.source),module=await load(artifact);
  assert.equal(module.functions.next(41),42);
  assert.equal(module.functions.distinct([1,2,1]),false);
  assert.equal(module.functions.same_bag([1,2,1],[2,1,1]),true);
  assert.throws(()=>compile(example.source.replace("return 1+x;","return x;")),/contract|proof|ensures/);
  assert.throws(()=>request({op:"compile",source:example.source,contractEvidence:{schema:1,semantics:"ink-contracts-v1",source_sha256:"wrong"}}));
});


test("formatted examples still compile and keep their exact typed inputs", () => {
  for(const example of examples){
    const original=compile(example.source),formatted=compile(formatInk(example.source));
    const before=prepare(original,example.entry,example.input);
    const after=prepare(formatted,example.entry,formatJSON(example.input));
    assert.deepEqual(after,before,example.id);
  }
});
