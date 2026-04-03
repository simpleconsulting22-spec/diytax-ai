import React, { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

const TAX_CATEGORIES = [
  "Income",
  "Advertising",
  "Meals & Entertainment",
  "Travel",
  "Office Supplies",
  "Software & Subscriptions",
  "Home Office",
  "Vehicle & Mileage",
  "Professional Services",
  "Equipment",
  "Other",
];

type FilterType = "all" | "needs_review" | "categorized";

interface Transaction {
  id: string;
  date: string;
  description: string;
  merchantName: string;
  amount: number;
  category: string;
  status: "categorized" | "needs_review";
}

export default function TransactionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadTransactions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filter]);

  async function loadTransactions(reset: boolean) {
    if (!user) return;
    setLoading(true);
    try {
      const constraints: Parameters<typeof query>[1][] = [
        where("uid", "==", user.uid),
        orderBy("date", "desc"),
        limit(50),
      ];
      if (filter !== "all") constraints.splice(1, 0, where("status", "==", filter));
      if (!reset && lastDoc) constraints.push(startAfter(lastDoc));

      const q = query(collection(db, "transactions"), ...constraints);
      const snap = await getDocs(q);
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
      setTransactions(reset ? docs : (prev) => [...prev, ...docs]);
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === 50);
    } finally {
      setLoading(false);
    }
  }

  async function handleCategoryChange(transactionId: string, category: string) {
    setUpdating(transactionId);
    try {
      await apiClient.call("updateTransactionCategory", { transactionId, category });
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === transactionId ? { ...t, category, status: "categorized" } : t
        )
      );
    } finally {
      setUpdating(null);
    }
  }

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const navStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderBottom: "1px solid #e5e7eb",
    padding: "0 32px",
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: font,
  };

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: font,
  };

  const contentStyle: React.CSSProperties = {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "40px 24px",
  };

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
    backgroundColor: active ? "#16A34A" : "#f3f4f6",
    color: active ? "#fff" : "#374151",
  });

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    backgroundColor: "#fff",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
  };

  const thStyle: React.CSSProperties = {
    padding: "14px 16px",
    textAlign: "left",
    fontSize: "12px",
    fontWeight: 700,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
  };

  const tdStyle: React.CSSProperties = {
    padding: "14px 16px",
    fontSize: "14px",
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  };

  const badgeStyle = (status: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    backgroundColor: status === "categorized" ? "#DCFCE7" : "#fef3c7",
    color: status === "categorized" ? "#15803D" : "#92400e",
    border: status === "categorized" ? "1px solid #22C55E" : undefined,
  });

  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A" }}>DIYTax AI</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            onClick={() => signOut(auth).then(() => navigate("/login"))}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={contentStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827" }}>Transactions</h1>
          <button
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {(["all", "needs_review", "categorized"] as FilterType[]).map((f) => (
            <button key={f} style={filterBtnStyle(filter === f)} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "needs_review" ? "Needs Review" : "Categorized"}
            </button>
          ))}
        </div>

        {loading && transactions.length === 0 ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px" }}>Loading transactions...</div>
        ) : transactions.length === 0 ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px" }}>No transactions found.</div>
        ) : (
          <>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Merchant</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td style={tdStyle}>{t.date}</td>
                    <td style={{ ...tdStyle, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.description}
                    </td>
                    <td style={tdStyle}>{t.merchantName}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: t.amount < 0 ? "#059669" : "#111827" }}>
                      {t.amount < 0 ? "+" : ""}${Math.abs(t.amount).toFixed(2)}
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={t.category || ""}
                        onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                        disabled={updating === t.id}
                        style={{
                          padding: "6px 10px",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          fontSize: "13px",
                          color: "#374151",
                          backgroundColor: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <option value="">Select...</option>
                        {TAX_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <span style={badgeStyle(t.status)}>
                        {t.status === "categorized" ? "Categorized" : "Needs Review"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div style={{ textAlign: "center", marginTop: "24px" }}>
                <button
                  style={{ padding: "10px 28px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                  onClick={() => loadTransactions(false)}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "Load More"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
