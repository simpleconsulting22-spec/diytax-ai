"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const https_1 = require("firebase-functions/v2/https");
async function requireAuth(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in.");
    }
    return request.auth.uid;
}
//# sourceMappingURL=auth.js.map