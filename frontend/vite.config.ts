import { defineConfig } from "vite";
import { execSync } from "node:child_process";

// Inject build-time fingerprints so the running UI can identify which bundle
// it is. Used by ImportCSVPage's footer to disprove stale-service-worker
// hypotheses during diagnostics.
function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  build: { outDir: "dist" },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_SHA__:  JSON.stringify(gitSha()),
  },
});
