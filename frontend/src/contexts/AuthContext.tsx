import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, DocumentData } from "firebase/firestore";
import { auth, db } from "../firebase";

interface AuthContextValue {
  user: User | null;
  userDoc: DocumentData | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  userDoc: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
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
    <AuthContext.Provider value={{ user, userDoc, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
