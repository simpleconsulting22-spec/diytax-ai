// Deterministic confidence scoring. Every Insight's TrustMeta.confidence
// passes through this so the rules are consistent across sections.

import type { Confidence, DataQuality, InsightDriver, TrustMeta } from "../types";

export interface ConfidenceInput {
  dataQuality: DataQuality;
  drivers:     InsightDriver[];
  /** Number of source rows the insight was computed from */
  rowCount:    number;
}

export function deriveConfidence(input: ConfidenceInput): { confidence: Confidence; reasons: string[] } {
  const { dataQuality, drivers, rowCount } = input;
  const reasons: string[] = [];
  let score = 100;

  if (dataQuality.syncedPct < 1) {
    score -= 25;
    reasons.push(`${Math.round(dataQuality.syncedPct * 100)}% of accounts synced`);
  }
  if (dataQuality.staleAccounts.length > 0) {
    score -= 15;
    reasons.push(`${dataQuality.staleAccounts.length} stale account${dataQuality.staleAccounts.length !== 1 ? "s" : ""}`);
  }
  if (rowCount < 10) {
    score -= 25;
    reasons.push(`Only ${rowCount} transactions in window`);
  }
  if (drivers.length < 2) {
    score -= 10;
    reasons.push("Single driver");
  }

  const confidence: Confidence =
    score >= 80 ? "high"   :
    score >= 55 ? "medium" :
                  "low";
  return { confidence, reasons };
}

export interface BuildTrustInput extends ConfidenceInput {
  windowLabel:   string;
  windowStart:   string;
  windowEnd:     string;
  baselineLabel: string;
}

export function buildTrust(input: BuildTrustInput): TrustMeta {
  const { confidence, reasons } = deriveConfidence(input);
  return {
    windowLabel:    input.windowLabel,
    windowStart:    input.windowStart,
    windowEnd:      input.windowEnd,
    baselineLabel:  input.baselineLabel,
    drivers:        input.drivers,
    confidence,
    confidenceReasons: reasons.length > 0 ? reasons : undefined,
  };
}
