import { parseExactJSON, stringifyExactJSON } from "./exact-json.mjs";

// Inputs have already passed Ink's actual value validator in the compiler worker.
// This bridge only converts that canonical wire data to the target-native JS ABI.
export function nativeValue(value, type, named, depth = 0) {
  if (depth > 128) throw Error("Input nesting exceeds 128 levels.");
  switch (type.kind) {
    case "u32":
    case "i32":
      return Number(value);
    case "u64":
      return value;
    case "int":
      return BigInt(value.Int);
    case "f32":
      return value && typeof value === "object"
        ? { F32Bits: Number(value.F32Bits) }
        : Number(value);
    case "list":
    case "vector":
      return value.map((v) => nativeValue(v, type.element, named, depth + 1));
    case "record":
      return Object.fromEntries(
        type.fields.map((f) => [
          f.name,
          nativeValue(value[f.name], f.type, named, depth + 1),
        ]),
      );
    case "ref":
      return nativeValue(value, named[type.name], named, depth + 1);
    case "option":
      return Object.hasOwn(value, "Some")
        ? { Some: nativeValue(value.Some, type.element, named, depth + 1) }
        : { None: null };
    case "result":
      return Object.hasOwn(value, "Ok")
        ? { Ok: nativeValue(value.Ok, type.ok, named, depth + 1) }
        : { Err: nativeValue(value.Err, type.error, named, depth + 1) };
    case "unit":
    case "bool":
    case "string":
    case "id":
    case "enum":
      return value;
    default:
      throw Error(`Unsupported browser value descriptor: ${type.kind}`);
  }
}
function argumentsFor(args, entry, named) {
  return args.map((v, i) => nativeValue(v, entry.params[i].type, named));
}
export function prepareNative(input, entry, metadata) {
  const wire = parseExactJSON(input),
    named = metadata.named_types;
  if (entry === "@pipeline")
    return {
      ...wire,
      steps: wire.steps.map((step) => ({
        ...step,
        args: step.args.map((v, i) =>
          v && typeof v === "object" && Object.hasOwn(v, "step")
            ? v
            : nativeValue(
                v,
                metadata.functions.find((f) => f.name === step.call).params[i]
                  .type,
                named,
              ),
        ),
      })),
    };
  if (entry === "@script")
    return wire.map((command) => ({
      call: command.call,
      args: argumentsFor(
        command.args,
        metadata.state.actions.find((a) => a.name === command.call),
        named,
      ),
    }));
  return argumentsFor(
    wire,
    metadata.functions.find((f) => f.name === entry),
    named,
  );
}
export async function execute(module, entry, input) {
  if (entry === "@script") {
    const state = module.createState();
    const replies = [];
    for (const command of input)
      replies.push(state.invoke(command.call, command.args));
    return replies;
  }
  const declaration = module.metadata.functions.find((f) => f.name === entry);
  if (declaration.parallel) return await module.callAsync(entry, input);
  return module.call(entry, input);
}

// Every returned cell contributes to the timed observation, including large arrays.
export function consume(value) {
  let hash = 2166136261,
    cells = 0;
  function text(s) {
    for (let i = 0; i < s.length; i++)
      hash = Math.imul(hash ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  function visit(v, depth) {
    if (depth > 128 || ++cells > 1000000)
      throw Error("Output exceeds the display/measurement value budget.");
    if (v === null) {
      text("null");
      return;
    }
    if (typeof v === "object") {
      if (Array.isArray(v)) {
        text("[");
        for (const x of v) visit(x, depth + 1);
        text("]");
      } else {
        text("{");
        for (const [key, x] of Object.entries(v)) {
          text(key);
          visit(x, depth + 1);
        }
        text("}");
      }
    } else {
      text(typeof v);
      text(Object.is(v, -0) ? "-0" : String(v));
    }
  }
  visit(value, 0);
  return { hash, cells };
}
export function display(value) {
  return stringifyExactJSON(value);
}
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
export async function measure(
  module,
  entry,
  input,
  benchmark = false,
  onProgress = (_round) => {},
) {
  const firstStart = performance.now();
  const result = await execute(module, entry, input);
  const digest = consume(result);
  const firstMs = performance.now() - firstStart;
  const samples = [];
  let iterations = 1;
  if (benchmark) {
    for (let i = 0; i < 3; i++) {
      const warm = await execute(module, entry, input);
      consume(warm);
      if (!equalValues(warm, result))
        throw Error("Repeated result changed; benchmark cancelled.");
    }
    iterations = Math.max(
      1,
      Math.min(128, Math.ceil(12 / Math.max(firstMs, 0.1))),
    );
    const started = performance.now();
    for (let round = 0; round < 9; round++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const next = await execute(module, entry, input);
        consume(next);
        if (!equalValues(next, result))
          throw Error("Repeated result changed; benchmark cancelled.");
      }
      samples.push((performance.now() - start) / iterations);
      onProgress(round + 1);
      if (performance.now() - started > 1500) break;
    }
  }
  const serialStart = performance.now();
  const resultJson = display(result);
  const serialisationMs = performance.now() - serialStart;
  if (resultJson.length > 8 * 1024 * 1024)
    throw Error(
      "Result exceeds 8 MiB. Reduce this input to inspect its output.",
    );
  return {
    resultJson,
    firstMs,
    serialisationMs,
    digest,
    samples,
    iterations,
    medianMs: samples.length ? median(samples) : null,
    minMs: samples.length ? Math.min(...samples) : null,
    maxMs: samples.length ? Math.max(...samples) : null,
  };
}

export function equalValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b);
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && equalValues(a[k], b[k]))
    );
  }
  return a === b;
}
