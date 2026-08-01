import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Firebase Functions cannot import from `frontend/`, so a few modules are
// duplicated into `functions/src/shared/`. Duplication is only safe if drift
// fails the build — that is what these tests are for. D5 in the readiness
// inventory was exactly this: the frontend calculator was year-indexed while
// the backend was stuck on 2024, and nothing caught it.

const backend = (name: string) => resolve(__dirname, "..", "src", "shared", name);
const frontend = (name: string) =>
  resolve(__dirname, "..", "..", "frontend", "src", "shared", name);

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("taxConstants mirror", () => {
  it("is byte-for-byte identical between frontend and functions", () => {
    // If this fails: copy the file you edited over the other one. Do not
    // hand-merge — the whole point is that there is one set of numbers.
    expect(read(backend("taxConstants.ts"))).toBe(read(frontend("taxConstants.ts")));
  });
});

describe("taxMap mirror", () => {
  // The two taxMap copies intentionally differ in comments and tooltip hints,
  // so compare the DATA that drives tax routing rather than the whole file.
  interface Row {
    category: string;
    group: string;
    taxSchedule: string;
    taxBucket: string;
  }

  function extractRows(source: string): Row[] {
    const rows: Row[] = [];
    const entry =
      /\{\s*category:\s*"([^"]+)",\s*group:\s*"([^"]+)",\s*taxSchedule:\s*"([^"]+)",\s*taxBucket:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = entry.exec(source)) !== null) {
      rows.push({ category: m[1], group: m[2], taxSchedule: m[3], taxBucket: m[4] });
    }
    return rows;
  }

  it("routes every category to the same schedule and bucket on both sides", () => {
    const backendRows = extractRows(read(backend("taxMap.ts")));
    const frontendRows = extractRows(read(frontend("taxMap.ts")));

    expect(backendRows.length).toBeGreaterThan(40);
    expect(backendRows).toEqual(frontendRows);
  });
});
