import { mkdir, writeFile, copyFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import './prepare-core.mjs';
const versions = JSON.parse(await readFile(new URL('../ink-pins.json', import.meta.url), 'utf8'));
const pins = Object.fromEntries(['runtime', 'abi', 'gpu', 'planner'].map(name => [name, versions[name]]));
const repos = {
  runtime: "ink-runtime",
  abi: "ink-abi",
  gpu: "ink-lowering-gpu",
  planner: "ink-planner",
};
await mkdir("public/runtime", { recursive: true });
const assets = {};
async function asset(packageName, path, name) {
  const url = `https://raw.githubusercontent.com/siliconjungle/${repos[packageName]}/${pins[packageName]}/${path}`;
  const r = await fetch(url);
  if (!r.ok) throw Error(`${url}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  await writeFile(`public/runtime/${name}`, bytes);
  assets[name] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    package: packageName,
    pin: pins[packageName],
    path,
  };
  return bytes;
}
const hostNames = [
  "ink-compute",
  "pipeline-contract",
  "backend-selection",
  "prepared-wasm",
  "pipeline-workers",
  "pipeline-worker",
  "pipeline-profile",
];
for (const name of hostNames)
  await asset(
    "runtime",
    `hosts/${name}.mjs`,
    `${name === "ink-compute" ? "ink-gpu" : name}.mjs`,
  );
await asset("gpu", "devices/compute.mjs", "ink-device.mjs");
await asset("abi", "src/packed.mjs", "ink-abi.mjs");
await asset("abi", "src/selection.mjs", "ink-selection.mjs");
await asset("abi", "selection.wasm", "ink-selection.wasm");
await asset(
  "planner",
  "browser/pipeline-selection.mjs",
  "pipeline-selection.mjs",
);
const hosts = [];
for (const name of [
  "ink-gpu.mjs",
  "pipeline-contract.mjs",
  "backend-selection.mjs",
  "prepared-wasm.mjs",
  "ink-abi.mjs",
  "ink-selection.mjs",
])
  hosts.push([name, await readFile(`public/runtime/${name}`, "utf8")]);
hosts.push(["ink-selection.wasm.sha256", assets["ink-selection.wasm"].sha256]);
for (const name of [
  "pipeline-workers.mjs",
  "pipeline-worker.mjs",
  "ink-device.mjs",
])
  hosts.push([name, await readFile(`public/runtime/${name}`, "utf8")]);
await writeFile(
  "public/runtime/assets.json",
  JSON.stringify(
    {
      pins,
      assets,
      runtimeHostHash: createHash("sha256")
        .update(JSON.stringify(hosts))
        .digest("hex"),
      plannerHash: assets["pipeline-selection.mjs"].sha256,
    },
    null,
    2,
  ),
);
console.log("Pinned Ink runtime and planner assets ready.");

await copyFile("LICENSE", "public/ink-license.txt");

// Remove obsolete generated toolchain assets when upgrading an existing checkout.
await rm("public/clang", {recursive:true, force:true});
