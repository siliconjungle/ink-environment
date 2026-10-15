import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {verifyCore} from './prepare-core.mjs';
verifyCore();
mkdirSync("public", { recursive: true });
execFileSync(
  "cargo",
  [
    "build",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--manifest-path",
    "compiler/Cargo.toml",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RUSTFLAGS:
        "-C link-arg=-z -C link-arg=stack-size=8388608 -C link-arg=--max-memory=268435456",
    },
  },
);
copyFileSync(
  "compiler/target/wasm32-unknown-unknown/release/ink_browser_compiler.wasm",
  "public/ink-compiler.wasm",
);
const bytes = readFileSync("public/ink-compiler.wasm");
const pins = JSON.parse(readFileSync("ink-pins.json", "utf8"));
const revision = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim();
writeFileSync(
  "public/compiler-info.json",
  JSON.stringify(
    {
      schema: 1,
      environment_revision: revision,
      license: "MIT",
      packages: pins,
      distribution: pins.distribution,
      core: pins.core,
      javascript: pins.javascript,
      abi: pins.abi,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      output: ["JavaScript", "Rust", "Rust/Wasm source", "WGSL"],
      knowledge_search: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Browser compiler: ${(bytes.length / 1048576).toFixed(2)} MiB`);

writeFileSync("public/environment-info.json", JSON.stringify({schema: 1, repository: "https://github.com/siliconjungle/ink-environment", revision, compiler: JSON.parse(readFileSync("public/compiler-info.json", "utf8"))}, null, 2)+"\n");
