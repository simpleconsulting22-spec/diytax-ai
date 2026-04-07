import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, DocumentData } from "firebase/firestore";
import { auth, db } from "../firebase";

// ─── MFA session persistence ──────────────────────────────────────────────────
// Stores { uid, ts } in localStorage so the user isn't asked for MFA on every
// page refresh. Verification expires after MFA_TTL_HOURS hours.

const MFA_KEY = "mfaVerifiedAt";
const MFA_TTL_HOURS = 24;
const MFA_TTL_MS = MFA_TTL_HOURS * 60 * 60 * 1000;

function isMfaSessionValid(uid: string): boolean {
  try {
    const raw = localStorage.getItem(MFA_KEY);
    if (!raw) return false;
    const { uid: storedUid, ts } = JSON.parse(raw) as { uid: string; ts: number };
    return storedUid === uid && Date.now() - ts < MFA_TTL_MS;
  } catch {
    return false;
  }
}

function saveMfaSession(uid: string) {
  try {
    localStorage.setItem(MFA_KEY, JSON.stringify({ uid, ts: Date.now() }));
  } catch {
    // localStorage unavailable — not fatal, user will just be re-prompted next refresh
  }
}

function clearMfaSession() {
  try {
    localStorage.removeItem(MFA_KEY);
  } catch { /* ignore */ }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export type UserRole = "owner" | "spouse" | "accountant";

interface AuthContextValue {
  user: User | null;
  userDoc: DocumentData | null;
  loading: boolean;
  mfaVerified: boolean;
  setMfaVerified: (v: boolean) => void;
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
  setMfaVerified: () => {},
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

  // Wrap setter so it also writes / clears the localStorage session.
  function setMfaVerified(v: boolean) {
    setMfaVerifiedState(v);
    if (v && user) {
      saveMfaSession(user.uid);
    } else if (!v) {
      clearMfaSession();
    }
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
        // Restore MFA verification if it was completed recently for this user.
        const alreadyVerified = isMfaSessionValid(firebaseUser.uid);
        setMfaVerifiedState(alreadyVerified);

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
        clearMfaSession();
      }

      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, userDoc, loading, mfaVerified, setMfaVerified, refreshUserDoc, role, effectiveOwnerUid }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
