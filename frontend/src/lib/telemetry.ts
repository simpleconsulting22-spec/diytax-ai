// Telemetry — minimal event tracking surface.
//
// The codebase doesn't currently have a real analytics provider wired in.
// This file gives every caller a single function to use (so adding a
// provider later is one place to change), and emits to console when
// ?debug=1 is in the URL so we can see events fire during development.
//
// Replace the body of `track` with a real provider (PostHog / GA4 / Segment
// / Firebase Analytics) when ready — the call sites will not need to change.

const DEBUG_LOGS =
  typeof window !== "undefined" &&
  /(?:\?|&)debug=1\b/.test(window.location.search);

export type TelemetryProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

export function track(event: string, props?: TelemetryProperties): void {
  if (DEBUG_LOGS) {
    // eslint-disable-next-line no-console
    console.log("[telemetry]", event, props ?? {});
  }
  // TODO: forward to a real analytics provider here.
}
