import { useEffect, useState, useCallback } from "react";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { doc, setDoc } from "firebase/firestore";
import { app, db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;

export type NotifPermission = "default" | "granted" | "denied" | "unsupported";

export function useNotifications() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotifPermission>("default");
  const [token, setToken]           = useState<string | null>(null);

  useEffect(() => {
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    setPermission(Notification.permission as NotifPermission);
  }, []);

  const saveToken = useCallback(async (uid: string) => {
    if (!VAPID_KEY) { console.warn("[FCM] VITE_FCM_VAPID_KEY not set"); return; }
    const supported = await isSupported();
    if (!supported) return;
    try {
      const messaging = getMessaging(app);
      const fcmToken  = await getToken(messaging, { vapidKey: VAPID_KEY });
      setToken(fcmToken);
      await setDoc(doc(db, "users", uid), { fcmToken }, { merge: true });
    } catch (err) {
      console.error("[FCM] getToken error:", err);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!user) return;
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    const result = await Notification.requestPermission();
    setPermission(result as NotifPermission);
    if (result === "granted") await saveToken(user.uid);
  }, [user, saveToken]);

  // Refresh token on load if already granted
  useEffect(() => {
    if (!user || permission !== "granted") return;
    saveToken(user.uid);
  }, [user, permission, saveToken]);

  return { permission, token, requestPermission };
}
