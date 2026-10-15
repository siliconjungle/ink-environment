# Ink environment

Edit an Ink program, compile it on your device, run it and inspect its output,
execution placement and timings. This is a standalone package and static web app.

The environment uses Ink's pinned checker and JavaScript, Rust, Wasm and GPU
lowerings. Its Rust/Wasm compiler transport checks source and exact JSON inputs.
JavaScript and eligible WGSL/WebGPU programs execute locally in the browser.
State executes in the generated JavaScript host with normal rollback, events,
versions and checkpoints. Compiled Rust source is available for download; native
Rust and Rust/Wasm builds use the Ink CLI and Rust toolchain.

The C backend and browser Clang toolchain are removed. This browser editor does
not compile Rust source to executable Wasm. Its checker still runs in Wasm, and
the language distribution retains the Rust/Wasm execution backend. Browser
execution selects fixed JavaScript or required WebGPU explicitly; no profitability
probes run during Compile or Run. Unsupported device work reports an error.

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
state-only compilation needs the approximately 3.7 MiB Ink compiler. Assets are
loaded from the same deployment. Code and inputs are never sent to a server.

## Execution and measurements

**Compile** checks source and emits JavaScript, Rust and eligible WGSL. **Run**
executes the selected browser target once. **Benchmark** repeats the complete
workload with fresh state, consumes every output and checks exact repeated
values. These browser measurements describe the selected implementation only.
Rust/Wasm execution and adaptive planning remain available in the native Ink
build/runtime tooling; they are not browser Clang features.

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

Exact inputs are recorded in `ink-pins.json` and the matching Cargo manifest/lock.
`prepare:assets` also creates an ignored sparse checkout at `.ink-source`, pinned
to the exact distribution revision. Every lowerer uses that core through Cargo's
path override, matching the distribution build. Compiler builds verify its Git
identity and reject local core changes; no latest-revision lookup is used.
Generated `compiler-info.json`, `environment-info.json` and `runtime/assets.json`
record the distribution, editor, package identities and SHA-256 hashes. The editor
and documentation can therefore describe the same published language revision
without assuming that the editor repository and compiler share a Git history.


## License and versions

This standalone editor, browser compiler transport and documentation are [MIT licensed](LICENSE). Third-party dependencies retain their own licenses and notices. `ink-pins.json` records the exact compiler, lowerings, runtime and planner inputs; generated `compiler-info.json` and `environment-info.json` bind the built compiler and editor revision. The site exposes those manifests alongside the editor.

The pinned compiler emits the general portable-value and JSON codec interfaces. The editor remains a single-file compiler; the specification site's JSON flow demo runs a linked `std:json` program compiled by the distribution. Dynamic JSON stays on the CPU host.

The current JavaScript emission includes prepared state-call tokens and both portable (`callBinary`) and agreed-schema (`callCompact`) pure-call interfaces. Compact transport requires both peers to agree on exact argument/result schema identities; it does not change portable snapshots. The editor still compiles single files and does not run knowledge search. Its browser compiler, examples and public package are validated at the exact revisions in `ink-pins.json`.

The query example uses typed ordered `list<T>{from ...; where ...; select ...;}`
inside a normal function and consumes the result with `sum`. It preserves list
order, duplicates and word arithmetic. It demonstrates connected source code;
it does not implement external database pushdown or run optimisation search.

Generated `JsonCodec` objects also expose explicit JavaScript-only `fromJS` and
`toJS` adapters for plain object trees. These do not add implicit conversions to
Ink execution or native/Wasm callers. The site's linked JSON program demonstrates
the boundary; importing `std:json` remains outside the single-file editor's scope.
