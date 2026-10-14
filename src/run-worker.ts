/// <reference lib="webworker" />
import {
  prepareNative,
  measure,
  equalValues,
  consume,
  display,
  median,
} from "./runtime.mjs";
const send = (value: any) => self.postMessage(value);
self.onmessage = async ({ data }) => {
  let url = "",
    engine: any;
  try {
    const artifact = data.artifact,
      start = performance.now();
    url = URL.createObjectURL(
      new Blob([artifact.javascript], { type: "text/javascript" }),
    );
    const module = await import(/* @vite-ignore */ url);
    const moduleLoadMs = performance.now() - start,
      prep = performance.now();
    const input = prepareNative(data.input, data.entry, module.metadata),
      bridgeMs = performance.now() - prep;
    if (!artifact.bundleUrl || data.entry === "@script") {
      const result = await measure(
        module,
        data.entry,
        input,
        data.benchmark,
        (round: number) => send({ progress: `Sample ${round}…` }),
      );
      send({
        ok: {
          ...result,
          moduleLoadMs,
          bridgeMs,
          backend: "javascript",
          placement: {
            reason:
              artifact.host_reason ?? "State actions execute on the host.",
          },
        },
      });
      return;
    }
    const base = artifact.bundleUrl;
    const runtimeStart=performance.now();
    const { loadInk } = await import(
      /* @vite-ignore */ new URL("ink-gpu.mjs", base).href
    );
    const plan =
      data.entry === "@pipeline"
        ? input
        : { steps: [{ id: "result", call: data.entry, args: input }] };
    engine = await loadInk(base, {parallelism:0, policy:"static", staticBackend:"javascript", backend:"javascript"});
    const runtimeLoadMs = performance.now() - runtimeStart;
    const requested = data.settings.backend ?? "javascript";
    if (!["javascript", "gpu"].includes(requested)) throw Error("Choose JavaScript or WebGPU. Build Rust/Wasm with the native toolchain.");
    let receipt: any;
    const execute = async () => {
      receipt = await engine.pipeline(
        plan,
        {backend: requested === "gpu" ? "gpu-required" : "javascript"},
      );
      return receipt.values;
    };
    const measureModule = {
      metadata: { functions: [{ name: "pipeline", parallel: true }] },
      callAsync: execute,
    };
    const result = await measure(
      measureModule,
      "pipeline",
      [],
      data.benchmark,
      (round: number) => send({ progress: `Sample ${round}…` }),
    );
    send({
      ok: {
        ...result,
        moduleLoadMs,
        bridgeMs,
        backend: receipt.backend,
        placement: receipt.placement,
        stages: receipt.stages,
        counters: receipt.counters,
        runtimeLoadMs,
        profileLoaded: false,
      },
    });
  } catch (error) {
    send({ error: String(error instanceof Error ? error.message : error) });
  } finally {
    if (engine) await engine.close();
    if (url) URL.revokeObjectURL(url);
  }
};
