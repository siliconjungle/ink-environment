import "./style.css";
import { enableBundles } from "./bundles";
import { Compiler, Runner, type Artifact } from "./client";
import { examples } from "./examples";
export { examples, Compiler, Runner };
export type { Artifact };
export type EnvironmentOptions = {
  compilerUrl: string;
  homeUrl?: string;
  initialSource?: string;
  initialExample?: string;
  initialInput?: string;
  initialEntry?: string;
  storageKey?: string;
};
export function mountEnvironment(
  root: HTMLElement,
  options: EnvironmentOptions,
) {
  const compiler = new Compiler(options.compilerUrl, (message) =>
      status(message),
    ),
    runner = new Runner(new URL("./", options.compilerUrl).href);
  let artifact: Artifact | null = null,
    compiledSource = "",
    busy = false,
    sequence = 0,
    disposed = false;
  let resultJson = "",
    selectedExample =
      examples.find((value) => value.id === options.initialExample) ??
      examples[0];
  async function release(owned: Artifact | null) {
    if (!owned?.bundleUrl) return;
    const cache = await caches.open("ink-environment-bundles-v1");
    for (const key of await cache.keys())
      if (key.url.startsWith(owned.bundleUrl)) await cache.delete(key);
    await (
      await caches.open("ink-environment-profiles-v1")
    ).delete(new URL("profile.json", owned.bundleUrl));
  }
  root.classList.add("ink-environment");
  root.innerHTML = `<header class="env-header"><div><a class="env-brand">ink</a><span class="env-slash">/ environment</span></div><span class="env-local">JS / WebGPU · Rust exports</span></header>
  <div class="env-intro"><div><h1>Write. Compile. Run.</h1><p>Edit Ink. Compile real targets. See the results and where the work ran.</p></div><a class="env-repo" href="https://github.com/siliconjungle/ink-environment">Editor source ↗</a></div>
  <div class="env-toolbar"><label>Example <select id="env-example" aria-label="Example program"></select></label><div class="env-actions"><button id="env-compile" class="env-primary">Compile</button><button id="env-run" disabled>Run</button><button id="env-benchmark" disabled>Benchmark</button><button id="env-stop" disabled>Stop</button></div></div>
  <div class="env-execution"><label>Execution <select id="env-backend"><option value="javascript">JavaScript</option><option value="gpu">WebGPU · requires device support</option></select></label><span>Rust/Wasm builds use the native Ink toolchain.</span></div><div class="env-status" role="status" aria-live="polite"><span id="env-status">Ready to compile.</span><span id="env-size"></span></div>
  <div class="env-grid"><section class="env-panel env-source"><div class="env-panel-heading"><h2>Ink source</h2><span>⌘ / Ctrl + Enter to compile</span></div><label class="env-sr" for="env-source">Ink source</label><div class="env-editor"><pre id="env-lines" aria-hidden="true"></pre><textarea id="env-source" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea></div></section>
  <div class="env-right"><section class="env-panel"><div class="env-panel-heading"><h2>Inputs</h2><select id="env-entry" aria-label="Entry point" disabled><option>Compile to choose an entry</option></select></div><p id="env-signature" class="env-signature">A state script or a function's JSON arguments.</p><label class="env-sr" for="env-input">Input JSON</label><textarea id="env-input" class="env-input" spellcheck="false" wrap="off"></textarea><details class="env-help"><summary>Input format</summary><p>Functions take a JSON argument array, for example <code>[[1, 2, 3], 2]</code>. State scripts take <code>[{"call":"total","args":[]}]</code>. Integer tokens keep their exact precision; use <code>{"Int":"123"}</code> for exact Int values. Pure pipelines use <code>{"inputs":{},"steps":[{"id":"a","call":"transform","args":[[1,2,3]]}]}</code>; later arguments can use <code>{"step":"a"}</code>. Single-file programs only.</p></details></section>
  <section class="env-panel env-result"><div class="env-panel-heading"><h2>Results</h2><button id="env-download-result" disabled>Download JSON</button></div><pre id="env-result" tabindex="0">Compile your program, then run it.</pre></section></div></div>
  <section class="env-panel env-placement"><div class="env-panel-heading"><h2>Execution placement</h2><span id="env-targets">Compile to inspect targets</span></div><div id="env-stage-strip" class="env-stage-strip"></div><pre id="env-placement">No execution yet.</pre></section><section class="env-panel env-performance"><div class="env-panel-heading"><h2>Performance</h2><span>Measured here, on this browser</span></div><div class="env-metrics"><div><span>Compile</span><strong id="env-compile-time">—</strong></div><div><span>First execution + output consumption</span><strong id="env-first-time">—</strong></div><div><span>Repeated median · output checked</span><strong id="env-median-time">—</strong></div><div><span>Samples</span><strong id="env-sample-count">—</strong></div></div><p id="env-measure-note">Run records one execution. Benchmark repeats the complete workload, starting with fresh state each time and consuming every returned value.</p><details><summary>Timing boundary and samples</summary><pre id="env-details">No measurements yet.</pre><p>Execution includes function calls or state creation and the full command script, plus output consumption and repeatability checks. Compiler loading, compilation, input validation/conversion, module loading and output formatting are separate. Rendering and worker message delivery are outside the execution timer. These are local measurements, not a comparison against another language or backend.</p></details></section>
  <details class="env-generated"><summary>Compiled artifacts <span id="env-code-size"></span></summary><button id="env-download-js" disabled>Download JavaScript</button><button id="env-download-rust" disabled>Download Rust source</button><pre id="env-generated-code" tabindex="0">No compiled module yet.</pre></details>
  <footer class="env-footer"><p>Code and inputs stay in your browser. Ink’s checker and target emitters run in Wasm; Rust source builds through the native Ink toolchain. The compiled Ink runtime executes the program.</p><p>Eligible pure pipelines execute on JavaScript or WebGPU. State executes on the host. Run never collects profitability measurements. External knowledge search and linked imports are outside this single-file environment.</p><p><a href="https://github.com/siliconjungle/ink-environment">Standalone editor repository</a> · <a href="${new URL("ink-license.txt", new URL(options.compilerUrl, document.baseURI)).href}">MIT license</a> · <a href="${new URL("environment-info.json", new URL(options.compilerUrl, document.baseURI)).href}">Compiler and package versions</a></p></footer>`;
  const element = <T extends HTMLElement>(id: string) =>
    root.querySelector<T>(`#env-${id}`)!;
  const source = element<HTMLTextAreaElement>("source"),
    input = element<HTMLTextAreaElement>("input"),
    entry = element<HTMLSelectElement>("entry"),
    example = element<HTMLSelectElement>("example");
  const compileButton = element<HTMLButtonElement>("compile"),
    runButton = element<HTMLButtonElement>("run"),
    benchmarkButton = element<HTMLButtonElement>("benchmark"),
    stopButton = element<HTMLButtonElement>("stop"),
    backend = element<HTMLSelectElement>("backend");
  root.querySelector<HTMLAnchorElement>(".env-brand")!.href =
    options.homeUrl ?? "https://siliconjungle.github.io/ink-spec-site/";
  for (const value of examples) {
    const option = document.createElement("option");
    option.value = value.id;
    option.textContent = value.name;
    example.append(option);
  }
  example.value = selectedExample.id;
  function status(text: string, error = false) {
    element("status").textContent = text;
    element("status").classList.toggle("env-error", error);
  }
  function controls() {
    const ready = !!artifact && source.value === compiledSource && !busy;
    compileButton.disabled = busy;
    runButton.disabled = !ready;
    benchmarkButton.disabled = !ready;

    backend.disabled =
      busy || !artifact?.bundleUrl || entry.value === "@script";
    stopButton.disabled = !busy;
    entry.disabled = busy || !artifact;
    example.disabled = busy;
    source.readOnly = busy;
    input.readOnly = busy;
  }
  function lines() {
    element("lines").textContent = Array.from(
      { length: source.value.split("\n").length },
      (_, i) => String(i + 1),
    ).join("\n");
    element("size").textContent =
      `${new TextEncoder().encode(source.value).length.toLocaleString()} source bytes`;
  }
  function save() {
    if (!options.storageKey) return;
    try {
      localStorage.setItem(
        options.storageKey,
        JSON.stringify({
          source: source.value,
          input: input.value,
          entry: entry.value,
          example: example.value,
        }),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  function format(ms: number | null) {
    return ms === null ? "—" : `${ms < 1 ? ms.toFixed(3) : ms.toFixed(2)} ms`;
  }
  function resetRun() {
    resultJson = "";
    element("result").textContent = "Ready to run.";
    for (const key of ["first-time", "median-time", "sample-count"])
      element(key).textContent = "—";
    element<HTMLButtonElement>("download-result").disabled = true;
    element("details").textContent =
      "No execution measurements for these inputs.";
  }
  function signature() {
    if (!artifact) return;
    if (entry.value === "@pipeline") {
      element("signature").textContent =
        "Pure stage graph. Values flow through typed references on the selected target.";
    } else if (entry.value === "@script") {
      const names = artifact.manifest.state?.actions
        ?.map((a: any) => a.name)
        .join(", ");
      element("signature").textContent =
        `Fresh state. Commands: ${names ?? "none"}`;
    } else {
      const f = artifact.manifest.functions.find(
        (f: any) => f.name === entry.value,
      );
      element("signature").textContent =
        `${f.name}(${f.params.map((p: any) => `${p.name}: ${p.type.name ?? p.type.kind}`).join(", ")}) → ${f.result.name ?? f.result.kind}`;
    }
  }
  function download(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function compile() {
    const previous = artifact;
    artifact = null;
    void release(previous);
    const current = ++sequence;
    busy = true;
    controls();
    status("Checking Ink and emitting targets…");
    try {
      await enableBundles(new URL("./", options.compilerUrl).href);
      const value = await compiler.compile(source.value);
      if (disposed || current !== sequence) return;
      if (value.bundleUrl) {
        const probe = await fetch(new URL("ink-gpu.mjs", value.bundleUrl));
        if (!probe.ok)
          throw Error(
            `Local bundle loader returned ${probe.status}; controller ${navigator.serviceWorker.controller?.scriptURL ?? "none"}; cached ${!!(await (await caches.open("ink-environment-bundles-v1")).match(new URL("ink-gpu.mjs", value.bundleUrl)))}`,
          );
      }
      artifact = value;
      compiledSource = source.value;
      entry.replaceChildren();
      if (value.bundleUrl) {
        const option = document.createElement("option");
        option.value = "@pipeline";
        option.textContent = "Pure pipeline · fixed placement";
        entry.append(option);
      }
      if (value.manifest.state?.actions?.length) {
        const option = document.createElement("option");
        option.value = "@script";
        option.textContent = "State script · fresh state";
        entry.append(option);
      }
      for (const f of value.manifest.functions.filter(
        (f: any) => !f.internal && !f.name.startsWith("__ink_"),
      )) {
        const option = document.createElement("option");
        option.value = f.name;
        option.textContent = f.name;
        entry.append(option);
      }
      const preferred = options.initialEntry ?? selectedExample.entry;
      if ([...entry.options].some((option) => option.value === preferred))
        entry.value = preferred;
      if (!entry.options.length)
        throw Error("No public function, query or change to run.");
      signature();
      resetRun();
      element("compile-time").textContent = format(value.compileMs);
      element("targets").textContent = value.bundleUrl
        ? "JavaScript + WGSL · Rust/Wasm source exported"
        : "JavaScript host";
      element("placement").textContent = value.bundleUrl
        ? "Compiled targets ready. Choose JavaScript or an eligible WebGPU target."
        : (value.host_reason ?? "Host execution");
      element("generated-code").textContent =
        (value.bundle
          ? JSON.stringify(
              {
                manifest: value.bundle.manifest,
                shaders: value.bundle.shaders,
                rust: value.bundle.rust,
              },
              null,
              2,
            ) + "\n\n"
          : "") +
        value.javascript.slice(0, 200000) +
        (value.javascript.length > 200000
          ? "\n… display truncated; download the complete module."
          : "");
      element("code-size").textContent =
        `· ${new TextEncoder().encode(value.javascript).length.toLocaleString()} bytes`;
      element<HTMLButtonElement>("download-js").disabled = false;
      element<HTMLButtonElement>("download-rust").disabled = !value.rust;
      status("Compiled. Choose inputs, then Run or Benchmark.");
      save();
    } catch (error) {
      if (current !== sequence) return;
      artifact = null;
      element("compile-time").textContent = "—";
      element("result").textContent = String(
        error instanceof Error ? error.message : error,
      );
      status("Compilation failed. See the diagnostic in Results.", true);
    } finally {
      if (current === sequence) {
        busy = false;
        controls();
      }
    }
  }
  async function run(benchmark: boolean) {
    if (!artifact || source.value !== compiledSource || busy) return;
    const current = ++sequence;
    busy = true;
    controls();
    status("Checking input types…");
    const compiled = artifact;
    try {
      const prepared = await compiler.prepare(
        compiled,
        entry.value,
        input.value,
      );
      if (disposed || current !== sequence) return;
      status(
        benchmark
            ? "Benchmarking compiled execution…"
            : "Running compiled Ink…",
      );
      const value = await runner.run(
        compiled,
        entry.value,
        prepared.input,
        benchmark,
        (message) => status(String(message)),
        { backend: backend.value },
      );
      if (disposed || current !== sequence) return;
      resultJson = value.resultJson;
      element("result").textContent =
        resultJson.length > 60000
          ? `${resultJson.slice(0, 60000)}\n… display truncated. Download JSON for the complete result.`
          : pretty(resultJson);
      element<HTMLButtonElement>("download-result").disabled = false;
      element("first-time").textContent = format(value.firstMs);
      element("median-time").textContent = format(value.medianMs);
      element("sample-count").textContent = value.samples.length
        ? `${value.samples.length} × ${value.iterations}`
        : "1 run";
      element("measure-note").textContent = benchmark
        ? "Repeated calls use fresh state and consume every output cell. Browser load and timer precision can affect these measurements."
        : "First execution measured. Use Benchmark for repeated samples; each starts with fresh state.";
      element("details").textContent = JSON.stringify(
        {
          compilerLoadMs: compiled.compilerLoadMs,
          compileMs: compiled.compileMs,
          inputValidationMs: prepared.validationMs,
          moduleLoadMs: value.moduleLoadMs,
          runtimeLoadMs:value.runtimeLoadMs,
          inputBridgeMs: value.bridgeMs,
          firstExecutionAndConsumptionMs: value.firstMs,
          outputFormattingMs: value.serialisationMs,
          warmSamplesMs: value.samples,
          iterationsPerSample: value.iterations,
          minMs: value.minMs,
          maxMs: value.maxMs,
          outputCells: value.digest.cells,
          outputDigest: value.digest.hash,
          backend: value.backend,
          placement: value.placement,
          stages: value.stages,
          counters: value.counters,
          coreIdentity: compiled.manifest.core_sha256,
        },
        null,
        2,
      );
      const nativePlan =
        entry.value === "@pipeline"
          ? JSON.parse(input.value)
          : { steps: [{ id: "result", call: entry.value }] };
      const strip = element("stage-strip");
      strip.replaceChildren();
      for (const [index, step] of (
        nativePlan.steps ?? [{ id: "state script" }]
      ).entries()) {
        const receipt = value.stages?.find(
          (stage: any) => index >= stage.start && index < stage.end,
        );
        const chip = document.createElement("div");
        chip.className = "env-stage";
        const label = document.createElement("strong");
        label.textContent = step.id;
        const target = document.createElement("span");
        const actual = receipt?.backend ?? value.backend;
        target.textContent =
          actual === "cpu"
            ? "Wasm"
            : actual === "gpu"
              ? "WebGPU"
              : actual === "javascript"
                ? "JavaScript"
                : actual;
        chip.append(label, target);
        strip.append(chip);
      }
      element("placement").textContent = JSON.stringify(
        {
          actualBackend: value.backend,
          profileLoaded: value.profileLoaded ?? false,
          placement: value.placement
            ? { ...value.placement, scope: undefined }
            : undefined,
          stages: value.stages,
          counters: value.counters,
        },
        null,
        2,
      );
      status(
        benchmark
          ? "Benchmark complete. Full output checked for repeatability."
          : "Run complete.",
      );
      save();
    } catch (error) {
      if (current !== sequence) return;
      element("result").textContent = String(
        error instanceof Error ? error.message : error,
      );
      status("Run failed. See the diagnostic in Results.", true);
    } finally {
      if (current === sequence) {
        busy = false;
        controls();
      }
    }
  }
  function pretty(text: string) {
    // Pretty-print without reparsing exact integers through JavaScript Number.
    let result = "",
      indent = 0,
      string = false,
      escaped = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (string) {
        result += c;
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') string = false;
        continue;
      }
      if (c === '"') {
        string = true;
        result += c;
      } else if (c === "{" || c === "[") {
        result += c;
        if (text[i + 1] !== "}" && text[i + 1] !== "]") {
          indent++;
          result += "\n" + "  ".repeat(indent);
        }
      } else if (c === "}" || c === "]") {
        if (text[i - 1] !== "{" && text[i - 1] !== "[") {
          indent--;
          result += "\n" + "  ".repeat(Math.max(0, indent));
        }
        result += c;
      } else if (c === ",") result += ",\n" + "  ".repeat(indent);
      else if (c === ":") result += ": ";
      else result += c;
    }
    return result;
  }
  compileButton.onclick = compile;
  runButton.onclick = () => run(false);
  benchmarkButton.onclick = () => run(true);
  stopButton.onclick = () => {
    sequence++;
    compiler.stop();
    runner.stop();
    busy = false;
    status("Stopped. Compile again if a compilation was interrupted.");
    controls();
  };
  example.onchange = () => {
    selectedExample = examples.find((value) => value.id === example.value)!;
    source.value = selectedExample.source;
    input.value = selectedExample.input;
    void release(artifact);
    artifact = null;
    lines();
    resetRun();
    status("Example loaded. Compile to run it.");
    controls();
    save();
  };
  source.oninput = () => {
    lines();
    status("Source changed. Compile before running.");
    controls();
    save();
  };
  source.onscroll = () => {
    element("lines").scrollTop = source.scrollTop;
  };
  input.oninput = () => {
    resetRun();
    save();
  };
  entry.onchange = () => {
    signature();
    resetRun();
    controls();
    save();
  };
  source.onkeydown = (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      source.setRangeText(
        "    ",
        source.selectionStart,
        source.selectionEnd,
        "end",
      );
      source.dispatchEvent(new Event("input"));
    }
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.shiftKey ? run(false) : !busy && compile();
    }
  });
  element("download-js").onclick = () => {
    if (artifact)
      download(artifact.javascript, "ink-program.mjs", "text/javascript");
  };
  element("download-rust").onclick = () => { if (artifact?.rust) download(artifact.rust, "ink-program.rs", "text/plain"); };
  element("download-result").onclick = () =>
    download(resultJson, "ink-result.json", "application/json");
  source.value = options.initialSource ?? selectedExample.source;
  input.value = options.initialInput ?? selectedExample.input;
  if (options.storageKey && !options.initialSource && !options.initialExample) {
    try {
      const saved = JSON.parse(
        localStorage.getItem(options.storageKey) ?? "null",
      );
      if (
        saved &&
        typeof saved.source === "string" &&
        typeof saved.input === "string"
      ) {
        source.value = saved.source;
        input.value = saved.input;
        selectedExample =
          examples.find((value) => value.id === saved.example) ?? examples[0];
        example.value = selectedExample.id;
      }
    } catch {
      /* A corrupt or unavailable draft never prevents startup. */
    }
  }
  lines();
  controls();
  return {
    compile,
    run: () => run(false),
    benchmark: () => run(true),
    dispose() {
      disposed = true;
      sequence++;
      compiler.stop();
      runner.stop();
      void release(artifact);
      root.replaceChildren();
    },
  };
}
