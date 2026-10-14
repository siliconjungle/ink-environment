export async function publishBundle(artifact, base) {
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
