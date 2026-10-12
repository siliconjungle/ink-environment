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
      distribution: "ed39c953d626f29c8687290b50057c28488acfca",
      core: "1a7a64559d0acf8c91c386bbbc8471ce327b68b4",
      javascript: "bb7d4070b07f5a9e52d138b9d7f5172eedbd6f82",
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
