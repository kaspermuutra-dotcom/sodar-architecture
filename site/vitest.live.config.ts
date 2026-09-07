import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Live provider smoke tests. Never run by `npm test`; see docs/SCANNER_ARCHITECTURE.md. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { environment: "node", include: ["**/*.live.test.ts"], testTimeout: 30 * 60_000, hookTimeout: 60_000 },
});
