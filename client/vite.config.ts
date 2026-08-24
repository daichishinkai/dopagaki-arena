import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@pvp/shared": path.resolve(__dirname, "../shared/src/index.ts") },
  },
  server: { fs: { allow: [path.resolve(__dirname, "..")] } },
  build: { outDir: "dist", emptyOutDir: true },
});
