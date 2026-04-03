import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import { requireAuth } from "../middleware/auth";

export const sendMfaCode = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { email?: string };
  if (!data.email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes

  const db = admin.firestore();

  await db.collection("userSecurity").doc(uid).set({
    mfaCode: code,
    mfaCodeExpiry: expiry,
    mfaVerified: false,
  });

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  await transporter.sendMail({
    from: `"DIYTax AI" <${gmailUser}>`,
    to: data.email,
    subject: "DIYTax AI - Your Verification Code",
    text: `Your DIYTax AI verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, please ignore this email.`,
  });

  return { sent: true };
});
