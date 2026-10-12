import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  base: "./",
  worker: { format: "es" },
  build:
    mode === "package"
      ? {
          outDir: "dist/package",
          copyPublicDir: false,
          lib: {
            entry: "src/index.ts",
            formats: ["es"],
            fileName: () => "index.js",
            cssFileName: "style",
          },
        }
      : { outDir: "dist/app" },
}));
