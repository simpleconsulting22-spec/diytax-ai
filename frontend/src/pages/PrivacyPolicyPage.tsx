import React from "react";
import { useNavigate } from "react-router-dom";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const EFFECTIVE_DATE = "April 3, 2025";
const VERSION = "1.0";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "36px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "12px" }}>
        {title}
      </h2>
      <div style={{ fontSize: "15px", color: "#374151", lineHeight: 1.75 }}>
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav style={{ backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px 10px", height: "64px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }} onClick={() => navigate("/")}>
          DIYTax AI
        </div>
        <button
          onClick={() => navigate(-1)}
          style={{ background: "none", border: "none", fontSize: "14px", color: "#6b7280", cursor: "pointer", fontFamily: font }}
        >
          ← Back
        </button>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: "30px", fontWeight: 800, color: "#111827", marginBottom: "8px" }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "40px" }}>
          Effective date: {EFFECTIVE_DATE} &nbsp;·&nbsp; Version {VERSION}
        </p>

        <Section title="1. Overview">
          <p>
            DIYTax AI ("we", "our", or "us") is committed to protecting your personal and financial
            information. This Privacy Policy explains what data we collect, how we use it, who we
            share it with, and your rights regarding that data.
          </p>
          <p style={{ marginTop: "12px" }}>
            By creating an account or using DIYTax AI, you agree to the collection and use of
            information in accordance with this policy.
          </p>
        </Section>

        <Section title="2. Data We Collect">
          <p><strong>Account information</strong></p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
            <li>Email address and name (from Google Sign-In)</li>
            <li>Account creation date and authentication records</li>
          </ul>

          <p style={{ marginTop: "16px" }}><strong>Financial and tax data</strong></p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
            <li>Transaction records you import (dates, descriptions, amounts)</li>
            <li>Bank account identifiers (name or last 4 digits) from CSV imports</li>
            <li>Tax categories and schedule assignments you create or confirm</li>
            <li>Business entity names and types you provide during setup</li>
            <li>Income source and expense type preferences</li>
          </ul>

          <p style={{ marginTop: "16px" }}><strong>Usage data</strong></p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
            <li>Pages visited and features used within the app</li>
            <li>Timestamps of actions (imports, categorizations, confirmations)</li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Data">
          <ul style={{ paddingLeft: "20px" }}>
            <li>To categorize your transactions using rules and AI assistance</li>
            <li>To compute tax schedule summaries (Schedule C, Schedule E, Schedule A)</li>
            <li>To display your financial overview on the dashboard</li>
            <li>To improve categorization accuracy through learned rules</li>
            <li>To send you security-related communications (e.g., MFA codes)</li>
          </ul>
          <p style={{ marginTop: "12px" }}>
            We do <strong>not</strong> use your financial data for advertising, sell it to third
            parties, or share it with other users.
          </p>
        </Section>

        <Section title="4. AI-Assisted Categorization">
          <p>
            When a transaction cannot be categorized by our built-in rules, it may be sent to
            OpenAI's API (gpt-4o-mini) for categorization. Only the transaction description and
            amount are sent — no personally identifiable information, account numbers, or names
            are included in these requests.
          </p>
          <p style={{ marginTop: "12px" }}>
            OpenAI processes this data subject to their{" "}
            <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#16A34A" }}>
              Privacy Policy
            </a>
            . We have opted out of OpenAI's data training on API inputs.
          </p>
        </Section>

        <Section title="5. Data Storage and Security">
          <p>
            All data is stored in Google Firebase (Firestore and Firebase Authentication), hosted
            on Google Cloud infrastructure. Data is encrypted in transit (TLS) and at rest.
          </p>
          <p style={{ marginTop: "12px" }}>
            Access to your data is restricted to your account only, enforced through Firebase
            Security Rules. No DIYTax AI employee has routine access to your financial records.
          </p>
        </Section>

        <Section title="6. Data Retention">
          <p>
            We retain your data for as long as your account is active. If you request account
            deletion, we will permanently delete your transactions, tax data, and profile
            information within 30 days.
          </p>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your location, you may have the right to:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
            <li><strong>Access</strong> — request a copy of your personal data</li>
            <li><strong>Correction</strong> — correct inaccurate data</li>
            <li><strong>Deletion</strong> — request permanent deletion of your account and data</li>
            <li><strong>Portability</strong> — export your transaction data as CSV</li>
            <li><strong>Withdraw consent</strong> — stop using the service and request deletion</li>
          </ul>
          <p style={{ marginTop: "12px" }}>
            To exercise these rights, email us at{" "}
            <a href="mailto:privacy@diytax.ai" style={{ color: "#16A34A" }}>privacy@diytax.ai</a>.
          </p>
        </Section>

        <Section title="8. California Residents (CCPA)">
          <p>
            California residents have the right to know what personal information is collected,
            to request deletion, and to opt out of the sale of personal information. We do not
            sell personal information. To submit a CCPA request, contact{" "}
            <a href="mailto:privacy@diytax.ai" style={{ color: "#16A34A" }}>privacy@diytax.ai</a>.
          </p>
        </Section>

        <Section title="9. Children's Privacy">
          <p>
            DIYTax AI is not intended for use by anyone under the age of 18. We do not knowingly
            collect personal information from minors.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update the
            effective date above and notify you via email or an in-app notice. Continued use of
            the service after changes constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about this Privacy Policy?{" "}
            <a href="mailto:privacy@diytax.ai" style={{ color: "#16A34A" }}>privacy@diytax.ai</a>
          </p>
        </Section>

        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "24px", fontSize: "13px", color: "#9ca3af" }}>
          DIYTax AI &nbsp;·&nbsp; Privacy Policy v{VERSION} &nbsp;·&nbsp; {EFFECTIVE_DATE}
        </div>
      </div>
    </div>
  );
}
