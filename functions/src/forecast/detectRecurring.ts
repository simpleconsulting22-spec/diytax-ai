import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

function classifyFrequency(avgDays: number): { label: Frequency; days: number } | null {
  if (avgDays >= 6   && avgDays <= 9)   return { label: "weekly",    days: 7   };
  if (avgDays >= 12  && avgDays <= 17)  return { label: "biweekly",  days: 14  };
  if (avgDays >= 25  && avgDays <= 35)  return { label: "monthly",   days: 30  };
  if (avgDays >= 85  && avgDays <= 97)  return { label: "quarterly", days: 91  };
  if (avgDays >= 350 && avgDays <= 380) return { label: "annual",    days: 365 };
  return null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export const detectRecurring = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  const db = admin.firestore();

  // Scan last 13 months
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 13);
  const cutoffDate = cutoff.toISOString().split("T")[0];

  const snap = await db
    .collection("transactions")
    .where("uid", "==", uid)
    .where("date", ">=", cutoffDate)
    .get();

  type TxnRow = { date: string; amount: number; category: string; taxCategory: string; type: string; merchantName: string };
  const groups = new Map<string, TxnRow[]>();

  snap.docs.forEach((d) => {
    const t = d.data();
    if (!t.normalizedDescription || !t.date) return;
    const key = `${t.type ?? "expense"}::${t.normalizedDescription}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      date:         t.date as string,
      amount:       t.amount as number ?? 0,
      category:     t.category as string ?? "",
      taxCategory:  t.taxCategory as string ?? "",
      type:         t.type as string ?? "expense",
      merchantName: (t.merchantName as string) || (t.description as string) || "",
    });
  });

  // Delete existing detected items for this user
  const existing = await db.collection("recurringItems").where("uid", "==", uid).get();
  const deleteBatch = db.batch();
  existing.docs.forEach((d) => deleteBatch.delete(d.ref));
  if (!existing.empty) await deleteBatch.commit();

  const writeBatch2 = db.batch();
  const results: object[] = [];

  for (const [, txns] of groups) {
    if (txns.length < 3) continue;

    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = new Date(sorted[i - 1].date + "T12:00:00Z");
      const b = new Date(sorted[i].date + "T12:00:00Z");
      intervals.push(Math.round((b.getTime() - a.getTime()) / 86400000));
    }

    const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const variance = intervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 1;

    if (cv > 0.3) continue;

    const freq = classifyFrequency(avg);
    if (!freq) continue;

    const avgAmount = sorted.reduce((s, t) => s + t.amount, 0) / sorted.length;
    const last = sorted[sorted.length - 1];
    const nextDate = addDays(last.date, freq.days);
    const confidence = Math.round(Math.min(1, Math.max(0, 1 - cv)) * 100) / 100;

    const item = {
      uid,
      merchantName:     last.merchantName || sorted[0].merchantName,
      amount:           Math.round(avgAmount * 100) / 100,
      frequency:        freq.label,
      intervalDays:     Math.round(avg),
      lastDate:         last.date,
      nextExpectedDate: nextDate,
      category:         last.category,
      taxCategory:      last.taxCategory,
      type:             last.type,
      occurrences:      sorted.length,
      confidence,
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = db.collection("recurringItems").doc();
    writeBatch2.set(ref, item);
    results.push(item);
  }

  await writeBatch2.commit();
  return { count: results.length, items: results };
});
