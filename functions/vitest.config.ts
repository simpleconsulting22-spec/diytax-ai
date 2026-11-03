import { defineConfig } from "vitest/config";

// Tests live outside `src` so `tsc -p tsconfig.json` (include: ["src"]) never
// compiles them into `lib/` and they stay out of the deployed bundle.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
