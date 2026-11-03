// Reply tokens for Zach's round emails. The raw token lives only in the
// Reply-To address; Firestore stores its SHA-256 hash.

import * as admin from "firebase-admin";
import { createHash, randomBytes } from "crypto";
import type { RoundGroup } from "./rounds";

export const REPLY_DOMAIN = "reply.diytaxai.com";

/**
 * Where replies are received: our reply. subdomain, or a Resend-hosted
 * <id>.resend.app address (no DNS needed). Anything else falls back.
 */
export function normalizeReplyDomain(v: unknown): string {
  const d = typeof v === "string" ? v.trim().toLowerCase() : "";
  return d === REPLY_DOMAIN || /^[a-z0-9-]{1,63}\.resend\.app$/.test(d) ? d : REPLY_DOMAIN;
}
export const TOKEN_TTL_MS = 30 * 86_400_000;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface ReplyTokenDoc {
  ownerUid: string;
  respondentUid: string;
  email: string;
  roundId: string;
  groups: Array<Pick<RoundGroup, "key" | "vendor" | "count" | "total" | "guess" | "txnIds">>;
  createdAt: number;
  expiresAt: number;
  uses: number;
}

/** Create a reply token for one person's questions; returns the Reply-To address. */
export async function createReplyAddress(
  db: admin.firestore.Firestore,
  doc: Omit<ReplyTokenDoc, "createdAt" | "expiresAt" | "uses">,
  now: number,
  domain: string = REPLY_DOMAIN
): Promise<string> {
  const token = randomBytes(20).toString("hex"); // 160 bits; lowercase survives any mail system
  await db.collection("zachReplyTokens").doc(hashToken(token)).set({ ...doc, createdAt: now, expiresAt: now + TOKEN_TTL_MS, uses: 0 });
  return `zach+${token}@${normalizeReplyDomain(domain)}`;
}
