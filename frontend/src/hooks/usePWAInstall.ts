import { useEffect, useState, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled]         = useState(false);
  const [dismissed, setDismissed]         = useState(
    () => localStorage.getItem("pwa_install_dismissed") === "1"
  );

  useEffect(() => {
    // Already running as standalone PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    function onPrompt(e: Event) {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }, [installPrompt]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem("pwa_install_dismissed", "1");
  }, []);

  return {
    canInstall: !!installPrompt && !installed && !dismissed,
    installed,
    promptInstall,
    dismiss,
  };
}
