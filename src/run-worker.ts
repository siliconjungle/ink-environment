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
      if (data.settings.train)
        throw Error(
          "Profiling applies to pure packed pipelines. State executes on the host.",
        );
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
    const cache = await caches.open("ink-environment-profiles-v1");
    const profileUrl = new URL("profile.json", base);
    let saved = await cache.match(profileUrl),
      record = saved ? await saved.json() : null;
    const options = {
      parallelism: 0,
      expectedCalls: 256,
      targetKey: record?.targetKey ?? "",
      placementProfile: record?.profile ?? null,
    };
    engine = await loadInk(base, options);
    const runtimeLoadMs=performance.now()-runtimeStart;
    let training: any = null;
    if (data.settings.train) {
      send({
        progress:
          "Measuring typed pure segments on JS, Wasm and available WebGPU…",
      });
      const { collectPlacementObservations, collectPlacementStartup } =
        await import(
          /* @vite-ignore */ new URL("pipeline-profile.mjs", base).href
        );
      const { fitPlacementProfile } = await import(
        /* @vite-ignore */ new URL("pipeline-selection.mjs", base).href
      );
      const backends = ["cpu", "javascript", "gpu"];
      const observations = await collectPlacementObservations(engine, [plan], {
        backends,
        samples: 5,
        warmup: 1,
      });
      send({ progress: "Measuring fresh-engine startup…" });
      const startup = await collectPlacementStartup(
        () => loadInk(base, { parallelism: 0 }),
        plan,
        { backends, trials: 2 },
      );
      const targetKey = `${navigator.userAgent}; environment session ${base}; horizon 256`;
      let profile = fitPlacementProfile(observations, {
        targetKey,
        setupNs: startup.setup_ns,
      });
      await engine.close();
      engine = await loadInk(base, {
        parallelism: 0,
        expectedCalls: 256,
        targetKey,
        placementProfile: profile,
      });
      // Independently changed values, same measured shape; no widened feature domain.
      const heldout = structuredClone(plan);
      for (const step of heldout.steps) {
        const f = module.metadata.functions.find(
          (f: any) => f.name === step.call,
        );
        step.args = step.args.map((v: any, i: number) =>
          Array.isArray(v) &&
          f.params[i].type.kind === "list" &&
          f.params[i].type.element.kind === "u32"
            ? v.map((x: number) => (x ^ 90) >>> 0)
            : v,
        );
      }
      const oracle = await engine.pipeline(heldout, { backend: "cpu" });
      const coldStart = performance.now(),
        first = await engine.pipeline(heldout),
        coldMs = performance.now() - coldStart;
      if (!equalValues(first.values, oracle.values))
        throw Error("Heldout adaptive output differed from CPU.");
      const cpu: number[] = [],
        adaptive: number[] = [];
      for (let i = 0; i < 7; i++)
        for (const backend of i % 2 ? ["auto", "cpu"] : ["cpu", "auto"]) {
          const started = performance.now(),
            r = await engine.pipeline(heldout, { backend });
          consume(r.values);
          if (!equalValues(r.values, oracle.values))
            throw Error("Profile validation output differed from CPU.");
          (backend === "cpu" ? cpu : adaptive).push(
            performance.now() - started,
          );
        }
      const cpuMedian = median(cpu),
        adaptiveMedian = median(adaptive),
        alternative = first.backend !== "cpu";
      const passed =
        !alternative ||
        (adaptiveMedian <= cpuMedian * 0.9 &&
          coldMs + 255 * adaptiveMedian <= 256 * cpuMedian * 0.9);
      if (!passed) {
        profile = { ...profile, models: {} };
      }
      training = {
        observations,
        startup,
        heldout: {
          cpuMedianMs: cpuMedian,
          adaptiveMedianMs: adaptiveMedian,
          coldAdaptiveMs: coldMs,
          expectedCalls: 256,
          passed,
          alternative,
        },
        profile,
      };
      await cache.put(
        profileUrl,
        new Response(JSON.stringify({ targetKey, profile }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await engine.close();
      engine = await loadInk(base, {
        parallelism: 0,
        expectedCalls: 256,
        targetKey,
        placementProfile: profile,
      });
    }
    const requested = data.settings.backend ?? "auto";
    let receipt: any;
    const execute = async () => {
      receipt = await engine.pipeline(
        plan,
        requested === "auto"
          ? {}
          : { placements: [{ end: plan.steps.length, backend: requested }] },
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
        training,
        runtimeLoadMs,
        profileLoaded: !!record || !!training,
      },
    });
  } catch (error) {
    send({ error: String(error instanceof Error ? error.message : error) });
  } finally {
    if (engine) await engine.close();
    if (url) URL.revokeObjectURL(url);
  }
};
