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
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.resolveEffectiveOwner = resolveEffectiveOwner;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
async function requireAuth(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    return request.auth.uid;
}
/**
 * Resolves the effective owner UID for shared-access scenarios.
 * Shared users (spouse/accountant) have `ownerUid` written to their
 * users/{uid} doc when they accept an invite.
 */
async function resolveEffectiveOwner(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    const callerUid = request.auth.uid;
    const db = admin.firestore();
    try {
        const userDoc = await db.collection("users").doc(callerUid).get();
        if (userDoc.exists) {
            const data = userDoc.data();
            if (typeof data.ownerUid === "string" && data.ownerUid) {
                const role = data.role ?? "spouse";
                return { callerUid, effectiveOwnerUid: data.ownerUid, role };
            }
        }
    }
    catch (err) {
        console.warn("[resolveEffectiveOwner] Failed to look up user doc:", err);
        // Fall through — treat as owner.
    }
    return { callerUid, effectiveOwnerUid: callerUid, role: "owner" };
}
//# sourceMappingURL=auth.js.map