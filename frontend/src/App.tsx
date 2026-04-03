import React, { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import MfaModal from "./components/MfaModal";
import LoginPage from "./pages/LoginPage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import TransactionsPage from "./pages/TransactionsPage";
import TaxFlowPage from "./pages/TaxFlowPage";
import SummaryPage from "./pages/SummaryPage";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, userDoc, loading } = useAuth();
  const location = useLocation();
  const [mfaVerified, setMfaVerified] = useState(false);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif" }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!mfaVerified) {
    return <MfaModal onVerified={() => setMfaVerified(true)} />;
  }

  if (userDoc && userDoc.onboardingComplete === false && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/onboarding"
        element={
          <AuthGuard>
            <OnboardingPage />
          </AuthGuard>
        }
      />
      <Route
        path="/dashboard"
        element={
          <AuthGuard>
            <DashboardPage />
          </AuthGuard>
        }
      />
      <Route
        path="/transactions"
        element={
          <AuthGuard>
            <TransactionsPage />
          </AuthGuard>
        }
      />
      <Route
        path="/tax-flow"
        element={
          <AuthGuard>
            <TaxFlowPage />
          </AuthGuard>
        }
      />
      <Route
        path="/summary"
        element={
          <AuthGuard>
            <SummaryPage />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
