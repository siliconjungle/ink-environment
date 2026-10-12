# Ink environment

Edit an Ink program, compile it on your device, run it and inspect its output,
execution placement and timings. This is a standalone package and static web app.

The environment uses the real pinned Ink checker and C, JavaScript, Wasm and GPU
lowering packages. A small Rust/Wasm transport exposes compilation and typed input
validation. Browser Clang/LLVM links the emitted freestanding C into CPU Wasm.
There is no evaluator used to execute programs, no compilation service and no
precompiled-example substitution. Editing source changes the artifacts.

Eligible pure numeric/record/vector/list modules produce JavaScript, CPU Wasm and
WGSL. They run through Ink's unchanged packed runtime, shared ABI decision Wasm and
independent bounded pipeline planner. Unsupported packed modules and state use the
literal JavaScript host; the interface displays the actual capability reason.
State scripts retain transactions, rollback, events and kept values.

## Run locally

Requires Node 22.22.1 or newer, Rust and the wasm32-unknown-unknown target.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run prepare:assets
npm run build:compiler
npm test
npm run dev
```

For a production build, use `npm run build` and `npm run preview`. Serve
`dist/app/` under HTTPS or localhost. Relative assets support a site subdirectory.
The application uses a service worker to serve locally compiled bundles from
Cache Storage, with a namespace restricted to this environment's bundle URLs.
No cross-origin isolation headers or compilation server are required.
The first packed compilation downloads roughly 90 MB of Clang/LLVM and C headers;
state-only compilation needs the approximately 1.6 MB Ink compiler. Assets are
loaded from the same deployment. Code and inputs are never sent to a server.

## Adaptive execution and measurements

**Compile** checks source, emits real targets and links Wasm. It does not execute
user functions. **Run** invokes the compiled runtime. **Benchmark** repeats the
whole captured workload and checks all returned values; state starts fresh on every
invocation. Loading, compilation, typed input validation and output formatting have
separate reported timing boundaries. Warm samples include output consumption and
repeatability checking. Browser load and clock resolution affect these results.

**Profile targets** explicitly collects pure segment observations, measures
fresh-engine target startup and fits a profile using the existing planner. It checks
all targets against CPU, then checks complete heldout requests with independently
changed u32 list values. Alternative placement is retained only if warm median and
cold-amortised execution beat CPU by 10% over the declared 256-call lifetime.
Profiles with no winning alternative retain CPU. The observations, validation and
actual dispatch/transfer counters are inspectable in the timing details.
Profiles are local to a compiled bundle and measured browser session. Feature
bounds and code/graph/runtime/planner identities remain Ink's existing contract.
Changing input shape outside measured domains retains CPU. Ordinary adaptive runs
never perform profitability probes. Diagnostic target selection is explicit and
reports fallbacks; requesting GPU is not evidence it executed GPU work.

The editor currently accepts single-file programs, function argument arrays,
fresh state scripts (256 commands) and single-pass pure graphs (8 stages). Linked
imports, automatic external knowledge search, feedback authoring and Rust-native
execution are outside this release. Pure modules beyond the packed ABI execute on
the host. These are environment limits, not claims about Ink language coverage.

## Embed

```js
import {mountEnvironment} from '@siliconjungle/ink-environment';
import '@siliconjungle/ink-environment/style.css';

const environment = mountEnvironment(document.querySelector('#editor'), {
  compilerUrl: '/environment/ink-compiler.wasm',
  homeUrl: '/',
  storageKey: 'my-ink-draft',
});
```

Deploy the companion `dist/app/` assets beside `compilerUrl` (compiler, runtime,
Clang, bundle service worker and runtime assets). Worker assets beside the
package module must also be served. `dispose()` stops pending work and removes the
editor. Draft storage is optional; compiled bundles and profiles use browser caches.

Independent package pins are in `compiler/Cargo.toml` and `Cargo.lock` and
`scripts/build-assets.mjs`. Generated `compiler-info.json` and
`runtime/assets.json` record identities and SHA-256 hashes. The initial distribution
pin is `ed39c953d626f29c8687290b50057c28488acfca`; its core subtree is identical to
`1a7a64559d0acf8c91c386bbbc8471ce327b68b4`, the revision used by the pinned lowerers.

Browser Clang comes from [browsercc](https://github.com/BertalanD/browsercc),
version 0.1.1, MIT. Ink assets retain their upstream provenance. This package has
not been published to npm.

Production browser verification is recorded in `browser-evidence.json`.
The edited three-stage example compiled and returned the same u32 result on
Wasm/JavaScript and actual WebGPU (three device dispatches). Explicit profiling
selected GPU for the first two stages and Wasm for the reduction; heldout output
checks and the warm/lifetime gate passed. These are measurements on this Mac and
browser session, not a general speed claim.

The Contracts example checks two implementations of a static specification.
`Compiler.compile(source, contractEvidence?)` accepts source-bound evidence from
Ink's contract proof producer. It is checked before any JavaScript, C/Wasm or
WGSL emission; missing or invalid required proofs are compilation errors. This
browser package does not run the external knowledge proof search. Simple clauses
can be established by the core's default normalization proof. The emitted hosts
retain precondition, transaction and invariant-checked restore behavior.

Pass contract evidence as its original JSON text to preserve full-width proof
integers: `await compiler.compile(source, await response.text())`. Programmatic
objects must use BigInt for integers outside JavaScript’s safe range; the worker
uses the exact JSON codec. Ordinary JSON.parse can irreversibly round proof data.

Contract proof identities, full backend conformance and browser Compiler API
checks are recorded in the distribution's
[source-contract validation report](https://github.com/siliconjungle/ink-lang/tree/main/reports/source-contracts-2026-10-12).

## License and versions

This standalone editor, browser compiler transport and documentation are [MIT licensed](LICENSE). Third-party dependencies and browser Clang retain their own licenses and notices. `ink-pins.json` records the exact compiler, lowerings, runtime and planner inputs; generated `compiler-info.json` and `environment-info.json` bind the built compiler and editor revision. The site exposes those manifests alongside the editor.
