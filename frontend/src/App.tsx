import React from "react";
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
import OnboardingPage from "./modules/onboarding/OnboardingPage";
import DashboardPage from "./modules/dashboard/DashboardPage";
import TransactionsPage from "./pages/TransactionsPage";
import TaxFlowPage from "./pages/TaxFlowPage";
import SummaryPage from "./pages/SummaryPage";
import ImportCSVPage from "./modules/import/ImportCSVPage";
import ReviewPage from "./modules/review/ReviewPage";
import TaxSummaryPage from "./modules/tax/TaxSummaryPage";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, userDoc, loading, mfaVerified, setMfaVerified } = useAuth();
  const location = useLocation();

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
      <Route
        path="/import-csv"
        element={
          <AuthGuard>
            <ImportCSVPage />
          </AuthGuard>
        }
      />
      <Route
        path="/review"
        element={
          <AuthGuard>
            <ReviewPage />
          </AuthGuard>
        }
      />
      <Route
        path="/tax-summary"
        element={
          <AuthGuard>
            <TaxSummaryPage />
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
