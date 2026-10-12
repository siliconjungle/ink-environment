/// <reference types="vite/client" />
import { mountEnvironment } from "./index";
mountEnvironment(document.querySelector<HTMLElement>("#app")!, {
  compilerUrl: new URL(
    `${import.meta.env.BASE_URL}ink-compiler.wasm`,
    location.href,
  ).href,
  initialExample:
    new URLSearchParams(location.search).get("example") ?? undefined,
  homeUrl: "https://siliconjungle.github.io/ink-spec-site/",
  storageKey: "ink-environment-draft-v1",
});
