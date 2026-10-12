// Browser LLVM is a physical toolchain; Ink's emitters remain the code authority.
export async function compileWasm(bundle, base, progress = (_message) => {}) {
  progress("Loading browser Clang/LLVM…");
  const { Clang, LLD, setUpSysroot } = await import(
    new URL("clang/index.js", base)
  );
  const flags = [
    "-x",
    "c",
    "--target=wasm32-unknown-unknown",
    "-O3",
    "-msimd128",
    "-std=c11",
    "-ffreestanding",
    "-nostdlib",
    "-Wl,--no-entry",
    "-Wl,--export=__heap_base",
    "-Wl,--export-memory",
    ...bundle.exports.map((s) => `-Wl,--export=${s}`),
    "-o",
    "cpu.wasm",
  ];
  let log = "";
  const config = {
    printErr: (s) => {
      log += s + "\n";
    },
  };
  const sysroot = await (
    await fetch(new URL("clang/sysroot.tar", base))
  ).arrayBuffer();
  const driver = await Clang({ ...config, thisProgram: "clang" });
  driver.FS.writeFile("cpu.c", bundle.c);
  if (driver.callMain([...flags, "cpu.c", "-###"]) !== 0)
    throw Error(log || "Clang driver failed.");
  const parseLine = (key) => {
    const line = log.split("\n").find((line) => line.includes(key));
    if (!line) throw Error(`Clang did not produce ${key} invocation: ${log}`);
    const args = [...line.matchAll(/"([^"]*)"/g)]
      .map((match) => match[1])
      .slice(1);
    return { args, output: args[args.indexOf("-o") + 1] };
  };
  const compiler = parseLine("-cc1"),
    linker = parseLine("wasm-ld");
  const invocation = {
    compilerArgs: compiler.args,
    compilerArtifact: compiler.output,
    linkerArgs: linker.args,
    linerArtifact: linker.output,
  };
  log = "";
  progress("Compiling the emitted C to Wasm…");
  const clang = await Clang({ ...config, thisProgram: "clang" });
  setUpSysroot(clang, sysroot);
  clang.FS.writeFile("cpu.c", bundle.c);
  if (clang.callMain(invocation.compilerArgs) !== 0)
    throw Error(log || "Clang compilation failed.");
  const object = clang.FS.readFile(invocation.compilerArtifact, {
    encoding: "binary",
  });
  progress("Linking the Wasm module…");
  const lld = await LLD({ ...config, thisProgram: "wasm-ld" });
  setUpSysroot(lld, sysroot);
  lld.FS.writeFile(invocation.compilerArtifact, object);
  if (lld.callMain(invocation.linkerArgs) !== 0)
    throw Error(log || "Wasm linking failed.");
  const bytes = lld.FS.readFile(invocation.linerArtifact, {
    encoding: "binary",
  }).slice();
  const module = await WebAssembly.compile(bytes);
  if (WebAssembly.Module.imports(module).length)
    throw Error("Generated CPU Wasm unexpectedly requires host imports.");
  return bytes;
}
export async function publishBundle(artifact, wasm, base) {
  const metadata = await (
    await fetch(new URL("runtime/assets.json", base))
  ).json();
  const manifest = {
    ...artifact.bundle.manifest,
    runtime_host_sha256: metadata.runtimeHostHash,
    pipeline_planner_sha256: metadata.plannerHash,
  };
  const url = new URL(`bundles/${crypto.randomUUID()}/`, base).href;
  const cache = await caches.open("ink-environment-bundles-v1");
  const put = (name, body, type) =>
    cache.put(
      new URL(name, url),
      new Response(body, { headers: { "Content-Type": type } }),
    );
  await put("manifest.json", JSON.stringify(manifest), "application/json");
  await put("program.mjs", artifact.javascript, "text/javascript");
  await put("cpu.wasm", wasm, "application/wasm");
  for (const [name, shader] of Object.entries(artifact.bundle.shaders))
    await put(name, shader, "text/plain");
  for (const name of Object.keys(metadata.assets)) {
    const response = await fetch(new URL(`runtime/${name}`, base));
    if (!response.ok) throw Error(`Runtime asset ${name}: ${response.status}`);
    await put(
      name,
      await response.arrayBuffer(),
      name.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
  }
  return url;
}
