import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";

function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
  if (!clientId || !secret) throw new HttpsError("internal", "Plaid credentials not configured.");
  const cfg = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  });
  return new PlaidApi(cfg);
}

interface AccountReport {
  institutionName: string;
  accountName:     string;
  mask:            string;
  positive:        number;
  negative:        number;
  zero:            number;
  examplesPos:     string[];
  examplesNeg:     string[];
  error?:          string;
}

/**
 * Diagnostic: pull the last 90 days for every Plaid account and report the
 * actual amount-sign distribution Plaid is returning. Used to ground-truth
 * the "PenFed sends all negative" claim with current data.
 */
export const diagnoseSignDistribution = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "512MiB" },
  async (request): Promise<{ accounts: AccountReport[] }> => {
    const uid = await requireAuth(request);
    const db  = admin.firestore();
    const plaid = getPlaidClient();

    const acctsSnap = await db.collection("accounts").where("uid", "==", uid).get();
    const accounts: AccountReport[] = [];

    const today = new Date().toISOString().split("T")[0];
    const start = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

    for (const doc of acctsSnap.docs) {
      const a = doc.data();
      const accessToken    = a.plaidAccessToken    as string | undefined;
      const plaidAccountId = a.plaidAccountId      as string | undefined;
      if (!accessToken || !plaidAccountId) continue;

      const report: AccountReport = {
        institutionName: a.institutionName ?? "?",
        accountName:     a.accountName     ?? "?",
        mask:            a.mask            ?? "",
        positive: 0, negative: 0, zero: 0,
        examplesPos: [], examplesNeg: [],
      };

      let offset = 0, total = Infinity;
      try {
        while (offset < total) {
          const r = await plaid.transactionsGet({
            access_token: accessToken,
            start_date:   start,
            end_date:     today,
            options:      { count: 500, offset, account_ids: [plaidAccountId] },
          });
          for (const t of r.data.transactions) {
            if (t.amount > 0) {
              report.positive++;
              if (report.examplesPos.length < 3) report.examplesPos.push(`+${t.amount} ${t.name}`);
            } else if (t.amount < 0) {
              report.negative++;
              if (report.examplesNeg.length < 3) report.examplesNeg.push(`${t.amount} ${t.name}`);
            } else report.zero++;
          }
          total = r.data.total_transactions;
          if (r.data.transactions.length === 0) break;
          offset += r.data.transactions.length;
        }
      } catch (e) {
        report.error = e instanceof Error ? e.message : String(e);
      }

      accounts.push(report);
    }

    return { accounts };
  },
);
