import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds the static frontend only (spec Phase 10: "같은 그래프 JSON을 읽기만
 * 함" -- this is a read-only viewer, never a dev server the CLI depends on).
 * Output goes to `dist-client/` so it never collides with `tsc -p
 * tsconfig.server.json`'s `dist-server/` (the Hono server `server.ts`
 * serves this directory as static files at runtime).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-client",
    emptyOutDir: true,
  },
});
