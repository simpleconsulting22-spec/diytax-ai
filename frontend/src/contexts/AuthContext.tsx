import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, DocumentData } from "firebase/firestore";
import { auth, db } from "../firebase";

interface AuthContextValue {
  user: User | null;
  userDoc: DocumentData | null;
  loading: boolean;
  mfaVerified: boolean;
  setMfaVerified: (v: boolean) => void;
  refreshUserDoc: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  userDoc: null,
  loading: true,
  mfaVerified: false,
  setMfaVerified: () => {},
  refreshUserDoc: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaVerified, setMfaVerified] = useState(false);

  async function refreshUserDoc() {
    if (!user) return;
    const snap = await getDoc(doc(db, "users", user.uid));
    setUserDoc(snap.exists() ? snap.data() : null);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setMfaVerified(false);
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        setUserDoc(snap.exists() ? snap.data() : null);
      } else {
        setUserDoc(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, userDoc, loading, mfaVerified, setMfaVerified, refreshUserDoc }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
