import { apiClient } from "../../services/apiClient";

export type FindingSeverity = "action" | "check" | "info";

export interface ZachFinding {
  id: string;
  severity: FindingSeverity;
  message: string;
  evidence: string;
  path?: string;
}

export interface ZachAnswer {
  answer: string;
  basis: "general_education" | "your_data" | "tax_engine" | "mixed" | "unsupported";
  sources: Array<{ id: string; title: string; url: string }>;
  actions: Array<{ routeId: string; path: string; label: string }>;
  missingInfo: string[];
  seeProfessional: boolean;
  followUpQuestion: string;
  unverifiedFigures: boolean;
  taxYear: number;
  tableYear: number;
  model: "fast" | "deep";
  conversationId: string;
  findings?: ZachFinding[];
}

export interface FindingsResponse {
  taxYear: number;
  tableYear: number;
  filingStatusSet: boolean;
  findings: ZachFinding[];
}

export interface AskArgs {
  message: string;
  taxYear: number;
  page: string;
  mode?: "chat" | "review";
  conversationId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export const askZach = (a: AskArgs) => apiClient.call<ZachAnswer>("askZach", a);
export const getZachFindings = (taxYear: number) =>
  apiClient.call<FindingsResponse>("getZachFindings", { taxYear });

/** Friendly text for a callable error; never blames the user's tax data. */
export function zachErrorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = (e?.code ?? "").replace("functions/", "");
  if (code === "resource-exhausted" || code === "already-exists" || code === "failed-precondition" || code === "invalid-argument") {
    return e.message ?? "Zach can't answer that right now.";
  }
  if (code === "permission-denied") return "Please sign in again with your 6-digit code to use Zach.";
  if (code === "unauthenticated") return "Please sign in to use Zach.";
  return "Zach is having trouble right now. Your tax information is safe. Please try again in a moment.";
}

export const BASIS_LABEL: Record<ZachAnswer["basis"], string> = {
  general_education: "General tax information",
  your_data: "Based on your DIYTax AI data",
  tax_engine: "From DIYTax AI's tax calculation",
  mixed: "Your data plus general tax rules",
  unsupported: "Outside what Zach can reliably answer",
};
