import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";

function getPlaidClient(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
  if (!clientId || !secret) return null;
  const cfg = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  });
  return new PlaidApi(cfg);
}

interface DeleteResult {
  txnsDeleted:        number;
  importsDeleted:     number;
  accountDocDeleted:  boolean;
  plaidItemRemoved:   boolean;
  plaidItemRemoveError?: string;
}

/**
 * Single source of truth for deleting a Plaid-linked account end to end:
 *
 *   1. Delete every transaction on the account
 *   2. Delete every import record on the account
 *   3. If this is the LAST account on the Plaid item (no siblings), call
 *      itemRemove so Plaid releases the connection on their side. If other
 *      accounts on the same item still exist (e.g. you're deleting just the
 *      Savings account but keeping Checking on the same PenFed item), the
 *      Plaid item stays alive.
 *   4. Delete the account doc itself.
 *
 * Idempotent: if the account doesn't exist, returns zero counts.
 */
export const deletePlaidAccount = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "512MiB" },
  async (request): Promise<DeleteResult> => {
    const uid = await requireAuth(request);
    const data = request.data as { accountId?: string };
    if (!data.accountId) {
      throw new HttpsError("invalid-argument", "accountId is required.");
    }

    const db = admin.firestore();
    const acctSnap = await db.collection("accounts").doc(data.accountId).get();

    if (!acctSnap.exists) {
      return { txnsDeleted: 0, importsDeleted: 0, accountDocDeleted: false, plaidItemRemoved: false };
    }
    const acct = acctSnap.data()!;
    if (acct.uid !== uid) {
      throw new HttpsError("permission-denied", "Not your account.");
    }

    const result: DeleteResult = {
      txnsDeleted: 0,
      importsDeleted: 0,
      accountDocDeleted: false,
      plaidItemRemoved: false,
    };

    // 1. Transactions
    const txnSnap = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("accountId", "==", data.accountId)
      .get();
    for (let i = 0; i < txnSnap.docs.length; i += 499) {
      const batch = db.batch();
      txnSnap.docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    result.txnsDeleted = txnSnap.size;

    // 2. Imports
    const importSnap = await db.collection("imports")
      .where("userId", "==", uid)
      .where("accountId", "==", data.accountId)
      .get();
    for (let i = 0; i < importSnap.docs.length; i += 499) {
      const batch = db.batch();
      importSnap.docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    result.importsDeleted = importSnap.size;

    // 3. itemRemove if last account on this item
    const itemId      = acct.plaidItemId      as string | undefined;
    const accessToken = acct.plaidAccessToken as string | undefined;
    if (itemId && accessToken) {
      const siblingSnap = await db.collection("accounts")
        .where("uid", "==", uid)
        .where("plaidItemId", "==", itemId)
        .get();
      // siblingSnap includes THIS account doc; > 1 means other accounts on the same item
      const siblingsRemain = siblingSnap.size > 1;

      if (!siblingsRemain) {
        const plaid = getPlaidClient();
        if (plaid) {
          try {
            await plaid.itemRemove({ access_token: accessToken });
            result.plaidItemRemoved = true;
            console.log(`[DELETE_ACCT] uid=${uid} acct=${data.accountId} itemRemove ok (last account on item ${itemId})`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            result.plaidItemRemoveError = msg;
            console.warn(`[DELETE_ACCT] uid=${uid} acct=${data.accountId} itemRemove failed: ${msg}`);
          }
        }
      } else {
        console.log(`[DELETE_ACCT] uid=${uid} acct=${data.accountId} kept Plaid item ${itemId} alive (${siblingSnap.size - 1} other account(s) still on it)`);
      }
    }

    // 4. Account doc
    await acctSnap.ref.delete();
    result.accountDocDeleted = true;

    return result;
  },
);
