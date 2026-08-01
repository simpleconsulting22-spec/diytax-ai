// Shared helpers for emulator integration tests.
//
// SYNTHETIC DATA ONLY. These tests talk to the local Firebase emulator suite —
// never to a real project. The project id is `demo-diytax`; the `demo-` prefix
// is a Firebase convention that makes the SDKs refuse to reach production even
// if emulator env vars were somehow missing.

import * as admin from "firebase-admin";

export const PROJECT_ID = "demo-diytax";
export const REGION = "us-central1";

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";

/** Guard: refuse to run unless the emulator env vars are actually set. */
export function assertEmulatorOnly(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Refusing to run: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are unset. " +
        "These tests must never touch a real project. Use `npm run test:integration`."
    );
  }
  if (!PROJECT_ID.startsWith("demo-")) {
    throw new Error("Refusing to run against a non-demo project id.");
  }
}

let app: admin.app.App | undefined;

export function adminApp(): admin.app.App {
  if (!app) {
    app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ projectId: PROJECT_ID });
  }
  return app;
}

export const db = () => adminApp().firestore();
export const auth = () => adminApp().auth();

/**
 * Create a synthetic Auth user and return a real ID token for it, minted by the
 * Auth emulator. Callables are then invoked over HTTP with that bearer token,
 * so the Functions emulator performs genuine token verification and the
 * `request.auth.uid` the function sees is the real thing.
 */
export async function createUserWithIdToken(uid: string, email: string): Promise<string> {
  try {
    await auth().deleteUser(uid);
  } catch {
    /* not present yet */
  }
  await auth().createUser({ uid, email, password: "synthetic-password-123" });

  const customToken = await auth().createCustomToken(uid);

  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  if (!res.ok) {
    throw new Error(`Auth emulator token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error("Auth emulator returned no idToken");
  return body.idToken;
}

export interface CallableResult {
  ok: boolean;
  status: number;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

/** Invoke a callable Cloud Function over HTTP against the Functions emulator. */
export async function callFunction(
  name: string,
  data: Record<string, unknown>,
  idToken?: string
): Promise<CallableResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, status: res.status, errorMessage: text };
  }

  if (!res.ok || parsed.error) {
    const err = (parsed.error ?? {}) as { status?: string; message?: string };
    return { ok: false, status: res.status, errorCode: err.status, errorMessage: err.message };
  }
  return { ok: true, status: res.status, result: parsed.result as Record<string, unknown> };
}

/** Delete every doc in a collection so each test file starts clean. */
export async function clearCollection(name: string): Promise<void> {
  const snap = await db().collection(name).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}
