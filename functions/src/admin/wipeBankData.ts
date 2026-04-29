import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// One-off full reset for the admin user. Pinned to a single email so the
// callable cannot be invoked by anyone else even if it lingers in production.
// Delete this file (and remove the export from index.ts) after the cleanup.

const ALLOWED_EMAIL = "deboijiwola@gmail.com";

interface WipeResult {
  dryRun: boolean;
  counts: {
    transactions: number;
    imports: number;
    accounts: number;
    plaidItemsToRemove: number;
  };
  deleted?: {
    transactions: number;
    imports: number;
    accounts: number;
    plaidItemsRemoved: number;
    plaidItemsRemoveFailed: number;
  };
}

function getPlaidClient(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
  if (!clientId || !secret) return null;
  const configuration = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

export const adminWipeBankData = onCall({ cors: true, invoker: "public" }, async (request): Promise<WipeResult> => {
  const email = (request.auth?.token?.email as string | undefined)?.toLowerCase();
  if (!email || email !== ALLOWED_EMAIL) {
    throw new HttpsError("permission-denied", "Not authorized.");
  }
  const uid = request.auth!.uid;

  const confirm = (request.data as { confirm?: boolean } | undefined)?.confirm === true;
  const db = admin.firestore();

  const [txnSnap, importSnap, acctSnap] = await Promise.all([
    db.collection("transactions").where("uid", "==", uid).get(),
    db.collection("imports").where("userId", "==", uid).get(),
    db.collection("accounts").where("uid", "==", uid).get(),
  ]);

  // Group access tokens by plaidItemId so we only call itemRemove once per item.
  const accessTokensByItem = new Map<string, string>();
  acctSnap.docs.forEach((d) => {
    const data = d.data();
    const itemId = data.plaidItemId as string | undefined;
    const token  = data.plaidAccessToken as string | undefined;
    if (itemId && token && !accessTokensByItem.has(itemId)) {
      accessTokensByItem.set(itemId, token);
    }
  });

  const counts = {
    transactions:       txnSnap.size,
    imports:            importSnap.size,
    accounts:           acctSnap.size,
    plaidItemsToRemove: accessTokensByItem.size,
  };

  if (!confirm) {
    return { dryRun: true, counts };
  }

  // Tell Plaid we're done with these connections so they're not left "live"
  // on Plaid's side (frees billing slots and stops webhook deliveries).
  // If a removal fails (e.g. token already invalid), we count it but proceed.
  const plaidClient = getPlaidClient();
  let plaidItemsRemoved = 0;
  let plaidItemsRemoveFailed = 0;
  if (plaidClient) {
    for (const token of accessTokensByItem.values()) {
      try {
        await plaidClient.itemRemove({ access_token: token });
        plaidItemsRemoved++;
      } catch {
        plaidItemsRemoveFailed++;
      }
    }
  }

  async function batchDelete(docs: FirebaseFirestore.QueryDocumentSnapshot[]) {
    for (let i = 0; i < docs.length; i += 499) {
      const batch = db.batch();
      docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  await batchDelete(txnSnap.docs);
  await batchDelete(importSnap.docs);
  await batchDelete(acctSnap.docs);

  return {
    dryRun: false,
    counts,
    deleted: {
      transactions:           txnSnap.size,
      imports:                importSnap.size,
      accounts:               acctSnap.size,
      plaidItemsRemoved,
      plaidItemsRemoveFailed,
    },
  };
});
