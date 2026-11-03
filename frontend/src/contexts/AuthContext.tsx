import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, DocumentData } from "firebase/firestore";
import { auth, db } from "../firebase";

// ─── MFA session state ────────────────────────────────────────────────────────
//
// Derived from the `mfaVerifiedAt` custom claim in the Firebase ID token, set
// server-side by verifyMfaCode.
//
// This used to be a { uid, ts } record in localStorage. That made the modal a
// UI formality: writing one key skipped it, and nothing outside React consulted
// it at all, so any caller with a valid ID token read every document without
// encountering MFA. The token claim is signed by Firebase, so the client cannot
// mint or extend it, and firestore.rules gates owner access on the same value —
// the modal and the data layer now agree because they read the same fact.
//
// Kept in step with MFA_CLAIM_TTL_MS in functions/src/auth/verifyMfaCode.ts.
// The rules enforce the real deadline; this only decides when to re-prompt, so
// a stale copy here costs a redundant prompt, never access.

const MFA_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the token currently in hand carries a fresh MFA claim.
 *
 * `forceRefresh` re-mints the token: Firebase does not push claim changes to a
 * live session, so immediately after verifyMfaCode the cached token still has
 * no claim and every rule check would fail.
 */
async function readMfaClaim(user: User, forceRefresh = false): Promise<boolean> {
  try {
    const { claims } = await user.getIdTokenResult(forceRefresh);
    const verifiedAt = claims.mfaVerifiedAt;
    return typeof verifiedAt === "number" && Date.now() - verifiedAt < MFA_TTL_MS;
  } catch {
    // Treat an unreadable token as unverified — fail closed.
    return false;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export type UserRole = "owner" | "spouse" | "accountant";

interface AuthContextValue {
  user: User | null;
  userDoc: DocumentData | null;
  loading: boolean;
  mfaVerified: boolean;
  /**
   * Re-mints the ID token and re-reads the MFA claim. Call after a successful
   * verifyMfaCode — the claim does not reach a live session otherwise.
   */
  refreshMfaClaim: () => Promise<void>;
  refreshUserDoc: () => Promise<void>;
  /** "owner" for normal users; "spouse" or "accountant" for shared users. */
  role: UserRole;
  /**
   * The UID whose Firestore data should be read/written.
   * - Owner:       same as user.uid
   * - Shared user: the ownerUid stored in their users/{uid} doc
   */
  effectiveOwnerUid: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  userDoc: null,
  loading: true,
  mfaVerified: false,
  refreshMfaClaim: async () => {},
  refreshUserDoc: async () => {},
  role: "owner",
  effectiveOwnerUid: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                       = useState<User | null>(null);
  const [userDoc, setUserDoc]                 = useState<DocumentData | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [mfaVerified, setMfaVerifiedState]    = useState(false);
  const [role, setRole]                       = useState<UserRole>("owner");
  const [effectiveOwnerUid, setEffectiveOwnerUid] = useState<string | null>(null);

  async function refreshMfaClaim() {
    if (!user) return;
    setMfaVerifiedState(await readMfaClaim(user, true));
  }

  async function refreshUserDoc() {
    if (!user) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : null;
    setUserDoc(data);
    // Re-resolve role and effective owner in case sharedAccess changed.
    const ownerUid = data?.ownerUid as string | undefined;
    setRole((data?.role as UserRole) ?? "owner");
    setEffectiveOwnerUid(ownerUid ?? user.uid);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Read the claim from the cached token — no forced refresh here, so a
        // page load costs no extra round trip. A user who verified in this
        // window already has the claim; anyone else gets the modal.
        setMfaVerifiedState(await readMfaClaim(firebaseUser));

        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        const data = snap.exists() ? snap.data() : null;
        setUserDoc(data);

        // Resolve role + effectiveOwnerUid.
        // Shared users (spouse/accountant) have ownerUid written to their user doc
        // when they accept an invite. Owners have no ownerUid field.
        const ownerUid = data?.ownerUid as string | undefined;
        setRole((data?.role as UserRole) ?? "owner");
        setEffectiveOwnerUid(ownerUid ?? firebaseUser.uid);
      } else {
        // User signed out — clear everything.
        setUserDoc(null);
        setMfaVerifiedState(false);
        setRole("owner");
        setEffectiveOwnerUid(null);
      }

      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, userDoc, loading, mfaVerified, refreshMfaClaim, refreshUserDoc, role, effectiveOwnerUid }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
