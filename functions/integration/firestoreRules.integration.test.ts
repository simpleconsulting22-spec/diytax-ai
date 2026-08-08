// Security-rules tests, run against the Firestore emulator.
//
// SYNTHETIC DATA ONLY — project id is `demo-diytax` (see emulatorHarness.ts for
// why the `demo-` prefix matters). Launch with `npm run test:integration`.
//
// These exercise firestore.rules directly rather than any application code.
// Rules are the only thing standing between a signed-in client and every other
// user's financial data, and until now nothing verified them: a rule could be
// syntactically valid, deploy cleanly, and still be wrong. Two classes of bug
// motivated this file — a collection with no rule at all (default-denied, so
// the feature silently never worked) and a rule whose condition was weaker
// than intended (readable by anyone).

import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { PROJECT_ID } from "./emulatorHarness";

const OWNER = "owner-uid";
const OWNER_EMAIL = "owner@example.com";
const SPOUSE = "spouse-uid";
const SPOUSE_EMAIL = "spouse@example.com";
const ACCOUNTANT = "accountant-uid";
const ACCOUNTANT_EMAIL = "accountant@example.com";
const STRANGER = "stranger-uid";
const STRANGER_EMAIL = "stranger@example.com";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Refusing to run: FIRESTORE_EMULATOR_HOST is unset. These tests must " +
        "never touch a real project. Use `npm run test:integration`."
    );
  }
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed the shared-access graph the rule helpers read. isSharedUser() and
  // sharedRole() both get() the OWNER's user doc, so these fields are what
  // grant spouse/accountant access to everything else.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", OWNER), {
      email: OWNER_EMAIL,
      sharedUids: [SPOUSE, ACCOUNTANT],
      sharedRoles: { [SPOUSE]: "spouse", [ACCOUNTANT]: "accountant" },
    });
  });
});

/** Signed-in client whose token carries an email, as Firebase Auth issues. */
function asUser(uid: string, email: string) {
  return testEnv.authenticatedContext(uid, { email }).firestore();
}
const asAnon = () => testEnv.unauthenticatedContext().firestore();

async function seed(path: string, id: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path, id), data);
  });
}

// ─── /invites — the enumeration hole ─────────────────────────────────────────

describe("invites", () => {
  const PENDING = {
    email: SPOUSE_EMAIL,
    role: "spouse",
    ownerUid: OWNER,
    ownerName: "Owner",
    status: "pending",
    expiresAt: Date.now() + 86_400_000,
  };

  beforeEach(() => seed("invites", "invite-1", PENDING));

  it("REGRESSION: an anonymous client cannot enumerate pending invites", async () => {
    // The original defect. `allow read` covers list queries and is evaluated
    // per candidate document, so a rule admitting any pending invite let a
    // logged-out client page through every outstanding invite in the database
    // — each carrying an email address, an ownerUid, and a redeemable token.
    const q = query(collection(asAnon(), "invites"), where("status", "==", "pending"));
    await assertFails(getDocs(q));
  });

  it("an anonymous client cannot read an invite even knowing its ID", async () => {
    await assertFails(getDoc(doc(asAnon(), "invites", "invite-1")));
  });

  it("a signed-in stranger cannot read someone else's invite", async () => {
    await assertFails(getDoc(doc(asUser(STRANGER, STRANGER_EMAIL), "invites", "invite-1")));
  });

  it("the invited address can read its own invite", async () => {
    await assertSucceeds(getDoc(doc(asUser(SPOUSE, SPOUSE_EMAIL), "invites", "invite-1")));
  });

  it("the owner can read invites they sent", async () => {
    await assertSucceeds(getDoc(doc(asUser(OWNER, OWNER_EMAIL), "invites", "invite-1")));
  });

  it("no client may write an invite — only the admin SDK", async () => {
    const db = asUser(OWNER, OWNER_EMAIL);
    await assertFails(setDoc(doc(db, "invites", "invite-2"), { ...PENDING }));
    await assertFails(deleteDoc(doc(db, "invites", "invite-1")));
  });
});

// ─── Collections that had no rules at all ────────────────────────────────────
//
// ssaForms, retirementForms and plannedBills are written straight from the
// client. With no matching rule they were default-denied, so /income/ssa,
// /income/retirement and /spending-forecast were non-functional in production.

describe.each([
  { name: "ssaForms", ownerField: "userId", payload: { totalBenefits: 1200, taxYear: 2025 } },
  {
    name: "retirementForms",
    ownerField: "userId",
    payload: { payerName: "Acme", totalDistribution: 5000, taxableAmount: 4000, taxYear: 2025 },
  },
  {
    name: "plannedBills",
    ownerField: "uid",
    payload: { description: "Rent", amount: 2000, dueDate: "2026-09-01", type: "expense" },
  },
])("$name", ({ name, ownerField, payload }) => {
  const owned = { [ownerField]: OWNER, ...payload };

  it("the owner can create", async () => {
    await assertSucceeds(
      setDoc(doc(asUser(OWNER, OWNER_EMAIL), name, "row-new"), owned)
    );
  });

  it("the owner can read, update and delete", async () => {
    await seed(name, "row-1", owned);
    const db = asUser(OWNER, OWNER_EMAIL);
    await assertSucceeds(getDoc(doc(db, name, "row-1")));
    await assertSucceeds(setDoc(doc(db, name, "row-1"), { ...owned, amount: 1 }));
    await assertSucceeds(deleteDoc(doc(db, name, "row-1")));
  });

  it("a spouse can read and write the owner's rows", async () => {
    await seed(name, "row-1", owned);
    const db = asUser(SPOUSE, SPOUSE_EMAIL);
    await assertSucceeds(getDoc(doc(db, name, "row-1")));
    await assertSucceeds(setDoc(doc(db, name, "row-1"), { ...owned, amount: 2 }));
  });

  it("an accountant can read but not write — these are income records", async () => {
    await seed(name, "row-1", owned);
    const db = asUser(ACCOUNTANT, ACCOUNTANT_EMAIL);
    await assertSucceeds(getDoc(doc(db, name, "row-1")));
    await assertFails(setDoc(doc(db, name, "row-1"), { ...owned, amount: 3 }));
  });

  it("only the owner may delete — not a spouse", async () => {
    await seed(name, "row-1", owned);
    await assertFails(deleteDoc(doc(asUser(SPOUSE, SPOUSE_EMAIL), name, "row-1")));
  });

  it("a stranger can do nothing", async () => {
    await seed(name, "row-1", owned);
    const db = asUser(STRANGER, STRANGER_EMAIL);
    await assertFails(getDoc(doc(db, name, "row-1")));
    await assertFails(setDoc(doc(db, name, "row-1"), { ...owned, amount: 4 }));
    await assertFails(deleteDoc(doc(db, name, "row-1")));
  });

  it("a client cannot create a row owned by someone else", async () => {
    await assertFails(
      setDoc(doc(asUser(STRANGER, STRANGER_EMAIL), name, "row-forged"), owned)
    );
  });

  it("an anonymous client can do nothing", async () => {
    await seed(name, "row-1", owned);
    await assertFails(getDoc(doc(asAnon(), name, "row-1")));
    await assertFails(setDoc(doc(asAnon(), name, "row-2"), owned));
  });
});

// ─── Transactions — the accountant field allowlist ───────────────────────────
//
// The narrowest rule in the file, and the one most likely to break silently
// under an unrelated schema change.

describe("transactions", () => {
  const TXN = {
    uid: OWNER,
    date: "2026-01-15",
    amount: -42.5,
    description: "COSTCO",
    category: "Office Supplies",
  };

  beforeEach(() => seed("transactions", "txn-1", TXN));

  it("an accountant may change categorization fields", async () => {
    await assertSucceeds(
      setDoc(
        doc(asUser(ACCOUNTANT, ACCOUNTANT_EMAIL), "transactions", "txn-1"),
        { ...TXN, category: "Meals", isUserModified: true },
        { merge: true }
      )
    );
  });

  it("an accountant may NOT change the amount", async () => {
    await assertFails(
      setDoc(
        doc(asUser(ACCOUNTANT, ACCOUNTANT_EMAIL), "transactions", "txn-1"),
        { amount: -1 },
        { merge: true }
      )
    );
  });

  it("an accountant may not reassign a transaction to another user", async () => {
    await assertFails(
      setDoc(
        doc(asUser(ACCOUNTANT, ACCOUNTANT_EMAIL), "transactions", "txn-1"),
        { uid: STRANGER },
        { merge: true }
      )
    );
  });

  it("an accountant may not delete", async () => {
    await assertFails(
      deleteDoc(doc(asUser(ACCOUNTANT, ACCOUNTANT_EMAIL), "transactions", "txn-1"))
    );
  });

  it("a spouse has full write", async () => {
    await assertSucceeds(
      setDoc(
        doc(asUser(SPOUSE, SPOUSE_EMAIL), "transactions", "txn-1"),
        { amount: -50 },
        { merge: true }
      )
    );
  });

  it("a stranger cannot read", async () => {
    await assertFails(
      getDoc(doc(asUser(STRANGER, STRANGER_EMAIL), "transactions", "txn-1"))
    );
  });
});

// ─── Collections closed to all client access ─────────────────────────────────

describe("admin-only collections", () => {
  it("userSecurity is unreadable by its own user — MFA state is server-side", async () => {
    await seed("userSecurity", OWNER, { mfaVerified: true });
    const db = asUser(OWNER, OWNER_EMAIL);
    await assertFails(getDoc(doc(db, "userSecurity", OWNER)));
    await assertFails(setDoc(doc(db, "userSecurity", OWNER), { mfaVerified: true }));
  });

  it("recurringItems is readable but not client-writable", async () => {
    await seed("recurringItems", "rec-1", { uid: OWNER, description: "Netflix" });
    const db = asUser(OWNER, OWNER_EMAIL);
    await assertSucceeds(getDoc(doc(db, "recurringItems", "rec-1")));
    await assertFails(setDoc(doc(db, "recurringItems", "rec-1"), { uid: OWNER }));
  });
});
