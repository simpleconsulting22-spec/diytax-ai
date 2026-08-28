import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { TaxYearProvider } from "./contexts/TaxYearContext";
import MfaModal from "./components/MfaModal";
import LoginPage from "./pages/LoginPage";
import OnboardingPage from "./modules/onboarding/OnboardingPage";
import DashboardPage from "./modules/dashboard/DashboardPage";
import TransactionsPage from "./pages/TransactionsPage";
import ImportCSVPage from "./modules/import/ImportCSVPage";
import ReviewPage from "./modules/review/ReviewPage";
import TaxSummaryPage from "./modules/tax/TaxSummaryPage";
import ScheduleEPage from "./modules/tax/ScheduleEPage";
import ScheduleAPage from "./modules/tax/ScheduleAPage";
import DeductionsPage from "./modules/deductions/DeductionsPage";
import SSAPage from "./modules/income/SSAPage";
import RetirementPage from "./modules/income/RetirementPage";
import BudgetPage from "./modules/budget/BudgetPage";
import CoachPage from "./modules/coach/CoachPage";
import TransfersPage from "./modules/transfers/TransfersPage";
import ManageAccessPage from "./pages/ManageAccessPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import TermsOfServicePage from "./pages/TermsOfServicePage";
import LandingPage from "./pages/LandingPage";
import QuickCaptureFAB from "./modules/capture/QuickCaptureFAB";
import NotificationSettingsPage from "./modules/settings/NotificationSettingsPage";
import CategoriesPage from "./modules/settings/CategoriesPage";
import BankAccountsPage from "./modules/bank/BankAccountsPage";
import SpendingForecastPage from "./modules/forecast/SpendingForecastPage";
import TaxEstimatePage from "./modules/forecast/TaxEstimatePage";
import AIParserPage from "./modules/parser/AIParserPage";
import PWAInstallBanner from "./components/PWAInstallBanner";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, userDoc, loading, mfaVerified, refreshMfaClaim, role } = useAuth();
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

  // Every role enrols, including spouses and accountants. They read and write
  // the owner's financial records, so prompting owners alone would leave that
  // data reachable with a single factor through a shared account — and the
  // Firestore rules require the claim of shared users too, so skipping the
  // prompt for them would render the app unusable rather than merely laxer.
  if (!mfaVerified) {
    // refreshMfaClaim re-mints the ID token so the new claim is actually in
    // hand. Flipping local state instead would clear the modal while every
    // Firestore read still failed the rule check.
    return <MfaModal onVerified={refreshMfaClaim} />;
  }

  // Skip onboarding for shared users — they access the owner's data, not their own.
  if (role === "owner" && (!userDoc || userDoc.onboardingComplete !== true) && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite/:inviteId" element={<AcceptInvitePage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/terms-of-service" element={<TermsOfServicePage />} />
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
        element={<Navigate to="/tax-summary" replace />}
      />
      {/* Legacy summary route. /tax-summary is the canonical, Schedule C/E
          aware surface; the old page computed different totals from the same
          data, so the two could disagree. Redirect rather than keep both. */}
      <Route
        path="/summary"
        element={<Navigate to="/tax-summary" replace />}
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
      <Route
        path="/schedule-e"
        element={
          <AuthGuard>
            <ScheduleEPage />
          </AuthGuard>
        }
      />
      <Route
        path="/schedule-a"
        element={
          <AuthGuard>
            <ScheduleAPage />
          </AuthGuard>
        }
      />
      <Route
        path="/deductions"
        element={
          <AuthGuard>
            <DeductionsPage />
          </AuthGuard>
        }
      />
      <Route
        path="/income/ssa"
        element={
          <AuthGuard>
            <SSAPage />
          </AuthGuard>
        }
      />
      <Route
        path="/income/retirement"
        element={
          <AuthGuard>
            <RetirementPage />
          </AuthGuard>
        }
      />
      {/* Phase 1 (active): /budget renders the new Money Coach. The old
         BudgetPage stays accessible at /budget-legacy as a fallback while
         we shake out edge cases. /coach kept as an alias so dogfood
         bookmarks from Phase 0 don't break. */}
      <Route
        path="/budget"
        element={
          <AuthGuard>
            <CoachPage />
          </AuthGuard>
        }
      />
      <Route
        path="/coach"
        element={
          <AuthGuard>
            <CoachPage />
          </AuthGuard>
        }
      />
      <Route
        path="/budget-legacy"
        element={
          <AuthGuard>
            <BudgetPage />
          </AuthGuard>
        }
      />
      <Route
        path="/transfers"
        element={
          <AuthGuard>
            <TransfersPage />
          </AuthGuard>
        }
      />
      <Route
        path="/manage-access"
        element={
          <AuthGuard>
            <ManageAccessPage />
          </AuthGuard>
        }
      />
      <Route
        path="/bank-accounts"
        element={
          <AuthGuard>
            <BankAccountsPage />
          </AuthGuard>
        }
      />
      <Route
        path="/spending-forecast"
        element={
          <AuthGuard>
            <SpendingForecastPage />
          </AuthGuard>
        }
      />
      <Route
        path="/tax-estimate"
        element={
          <AuthGuard>
            <TaxEstimatePage />
          </AuthGuard>
        }
      />
      <Route path="/forecast" element={<Navigate to="/spending-forecast" replace />} />
      <Route
        path="/settings/notifications"
        element={
          <AuthGuard>
            <NotificationSettingsPage />
          </AuthGuard>
        }
      />
      <Route
        path="/settings/categories"
        element={
          <AuthGuard>
            <CategoriesPage />
          </AuthGuard>
        }
      />
      <Route
        path="/ai-parser"
        element={
          <AuthGuard>
            <AIParserPage />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TaxYearProvider>
          <AppRoutes />
          <QuickCaptureFAB />
          <PWAInstallBanner />
        </TaxYearProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
