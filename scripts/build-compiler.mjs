import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
writeFileSync(
  "public/compiler-info.json",
  JSON.stringify(
    {
      schema: 1,
      distribution: "803a7f3743b14ca8f58dcba84939612515a09ccf",
      core: "2fb9b87679635c646417c1f906c7363485621008",
      javascript: "58a157213f767ece00c63769a6b429eadfebec0c",
      abi: "c800d60a4f49790dced13fc930b84ba7815d60a0",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      output: ["JavaScript", "C/Wasm", "WGSL"],
      knowledge_search: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Browser compiler: ${(bytes.length / 1048576).toFixed(2)} MiB`);
