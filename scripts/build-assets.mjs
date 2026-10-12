import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const pins = {
  runtime: "b225add86164ca478ef611079cd27d4e3e3a59f3",
  abi: "c800d60a4f49790dced13fc930b84ba7815d60a0",
  gpu: "bfe24e11367b3f7a8fcb5399b531d4c28b5e5c97",
  planner: "7c02795a10f783429575de6e72c6da196d96fb1a",
};
const repos = {
  runtime: "ink-runtime",
  abi: "ink-abi",
  gpu: "ink-lowering-gpu",
  planner: "ink-planner",
};
await mkdir("public/runtime", { recursive: true });
await mkdir("public/clang", { recursive: true });
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
for (const name of [
  "index.js",
  "clang.js",
  "clang.wasm",
  "lld.js",
  "lld.wasm",
  "sysroot.tar",
])
  await copyFile(`node_modules/browsercc/dist/${name}`, `public/clang/${name}`);
await copyFile("node_modules/browsercc/LICENSE", "public/clang/LICENSE");
console.log("Pinned Ink runtime, planner and browser Clang assets ready.");
