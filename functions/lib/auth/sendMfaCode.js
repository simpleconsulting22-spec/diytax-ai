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
const dotenv = __importStar(require("dotenv"));
const auth_1 = require("../middleware/auth");
const twilio_1 = __importDefault(require("twilio"));
dotenv.config();
/**
 * Sends a verification code via Twilio Verify (purpose-built OTP service —
 * faster and more reliable than the generic Messages API).
 *
 * Required environment variables (functions/.env):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_VERIFY_SERVICE_SID   — starts with "VA", from Twilio Console → Verify → Services
 */
exports.sendMfaCode = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.phoneNumber) {
        throw new https_1.HttpsError("invalid-argument", "Phone number is required.");
    }
    const phone = data.phoneNumber.trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        throw new https_1.HttpsError("invalid-argument", "Phone number must be in E.164 format (e.g. +15551234567).");
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!accountSid || !authToken || !verifyServiceSid) {
        console.error("Missing Twilio environment variables");
        throw new https_1.HttpsError("internal", "SMS service is not configured.");
    }
    // Store the phone on userSecurity so verifyMfaCode can use it
    const db = admin.firestore();
    await db.collection("userSecurity").doc(uid).set({ mfaPhone: phone, mfaVerified: false }, { merge: true });
    const client = (0, twilio_1.default)(accountSid, authToken);
    try {
        await client.verify.v2
            .services(verifyServiceSid)
            .verifications.create({ to: phone, channel: "sms" });
        console.log(`Verify SMS dispatched to ${phone.slice(0, 6)}****`);
        return { sent: true };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.error("Twilio Verify error:", msg);
        throw new https_1.HttpsError("internal", "Failed to send SMS verification code.");
    }
});
//# sourceMappingURL=sendMfaCode.js.map