"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMfaCode = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const mail_1 = __importDefault(require("@sendgrid/mail"));
const dotenv = __importStar(require("dotenv"));
const auth_1 = require("../middleware/auth");
dotenv.config();
exports.sendMfaCode = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    console.log("🚀 sendMfaCode triggered");
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.email) {
        throw new https_1.HttpsError("invalid-argument", "Email is required.");
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes
    const db = admin.firestore();
    await db.collection("userSecurity").doc(uid).set({
        mfaCode: code,
        mfaCodeExpiry: expiry,
        mfaVerified: false,
    });
    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
        console.error("❌ Missing SendGrid environment variables");
        throw new https_1.HttpsError("internal", "SendGrid environment variables not configured.");
    }
    mail_1.default.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
        to: data.email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: "DIYTax AI - Your Verification Code",
        text: `Your DIYTax AI verification code is: ${code}

This code expires in 10 minutes.

If you did not request this code, please ignore this email.`,
    };
    console.log("📧 Sending email via SendGrid...");
    try {
        const response = await mail_1.default.send(msg);
        console.log("✅ SENDGRID RESPONSE:", response[0].statusCode);
        return { sent: true };
    }
    catch (error) {
        console.error("❌ SENDGRID ERROR:", error.response?.body || error.message);
        throw new https_1.HttpsError("internal", "Failed to send verification email.");
    }
});
//# sourceMappingURL=sendMfaCode.js.map