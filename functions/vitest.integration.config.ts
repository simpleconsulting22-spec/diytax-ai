import { defineConfig } from "vitest/config";

// Integration tests run against the Firebase emulator suite and are kept out of
// the default `npm test` run, which must stay fast and offline.
// Launch with `npm run test:integration` (starts the emulators for you).
export default defineConfig({
  test: {
    include: ["integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The emulator is shared mutable state — run files sequentially.
    fileParallelism: false,
  },
});
