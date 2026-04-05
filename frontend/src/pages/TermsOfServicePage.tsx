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

export default function TermsOfServicePage() {
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
          Terms of Service
        </h1>
        <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "40px" }}>
          Effective date: {EFFECTIVE_DATE} &nbsp;·&nbsp; Version {VERSION}
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By creating an account or using DIYTax AI ("the Service"), you agree to these Terms
            of Service. If you do not agree, do not use the Service.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            DIYTax AI is a personal finance and tax organization tool that helps you import,
            categorize, and summarize your financial transactions for tax preparation purposes.
            The Service uses AI-assisted categorization to suggest tax categories for your
            transactions.
          </p>
        </Section>

        <Section title="3. Not Tax or Legal Advice">
          <div
            style={{
              backgroundColor: "#fef9c3",
              border: "1px solid #fde047",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <strong>Important:</strong> DIYTax AI is a software tool, not a licensed tax advisor,
            CPA, or attorney. Nothing in the Service constitutes tax, legal, or financial advice.
            All outputs — including Schedule C summaries, expense categorizations, and tax
            estimates — are for organizational and informational purposes only.
          </div>
          <p>
            You are solely responsible for verifying the accuracy of all data and for the
            contents of any tax return you file. We strongly recommend consulting a licensed
            tax professional before filing.
          </p>
        </Section>

        <Section title="4. Your Account">
          <ul style={{ paddingLeft: "20px" }}>
            <li>You must be at least 18 years old to use the Service.</li>
            <li>You are responsible for maintaining the security of your account.</li>
            <li>You must provide accurate information when using the Service.</li>
            <li>You may not share your account credentials with others.</li>
          </ul>
        </Section>

        <Section title="5. Your Data">
          <p>
            You own your financial data. By using the Service, you grant DIYTax AI a limited
            license to process your data solely for the purpose of providing the Service to you.
          </p>
          <p style={{ marginTop: "12px" }}>
            You are responsible for the accuracy of data you import. DIYTax AI is not responsible
            for errors arising from incorrect or incomplete transaction data.
          </p>
        </Section>

        <Section title="6. Acceptable Use">
          <p>You agree not to:</p>
          <ul style={{ paddingLeft: "20px", marginTop: "8px" }}>
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to access other users' accounts or data</li>
            <li>Reverse engineer or attempt to extract source code from the Service</li>
            <li>Use the Service to file fraudulent tax returns</li>
            <li>Introduce malware or otherwise interfere with the Service</li>
          </ul>
        </Section>

        <Section title="7. Disclaimer of Warranties">
          <p>
            The Service is provided "as is" and "as available" without warranties of any kind,
            express or implied. We do not warrant that the Service will be error-free,
            uninterrupted, or that AI categorizations will be accurate or complete.
          </p>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            To the maximum extent permitted by law, DIYTax AI shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, including but not
            limited to tax penalties, interest, or assessments arising from your use of or
            reliance on the Service.
          </p>
        </Section>

        <Section title="9. Termination">
          <p>
            You may delete your account at any time. We may suspend or terminate your account if
            you violate these Terms. Upon termination, your data will be deleted within 30 days
            in accordance with our Privacy Policy.
          </p>
        </Section>

        <Section title="10. Changes to Terms">
          <p>
            We may update these Terms from time to time. We will notify you of material changes
            via email or in-app notice. Continued use of the Service after changes constitutes
            acceptance of the updated Terms.
          </p>
        </Section>

        <Section title="11. Governing Law">
          <p>
            These Terms are governed by the laws of the State of Delaware, without regard to
            conflict of law principles.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about these Terms?{" "}
            <a href="mailto:legal@diytax.ai" style={{ color: "#16A34A" }}>legal@diytax.ai</a>
          </p>
        </Section>

        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "24px", fontSize: "13px", color: "#9ca3af" }}>
          DIYTax AI &nbsp;·&nbsp; Terms of Service v{VERSION} &nbsp;·&nbsp; {EFFECTIVE_DATE}
        </div>
      </div>
    </div>
  );
}
