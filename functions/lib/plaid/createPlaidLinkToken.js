"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlaidLinkToken = void 0;
const https_1 = require("firebase-functions/v2/https");
const plaid_1 = require("plaid");
const auth_1 = require("../middleware/auth");
exports.createPlaidLinkToken = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
    if (!clientId || !secret) {
        throw new https_1.HttpsError("internal", "Plaid credentials not configured.");
    }
    const configuration = new plaid_1.Configuration({
        basePath: plaid_1.PlaidEnvironments[plaidEnv] ?? plaid_1.PlaidEnvironments.sandbox,
        baseOptions: {
            headers: {
                "PLAID-CLIENT-ID": clientId,
                "PLAID-SECRET": secret,
            },
        },
    });
    const plaidClient = new plaid_1.PlaidApi(configuration);
    const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: uid },
        client_name: "DIYTax AI",
        products: [plaid_1.Products.Transactions],
        country_codes: [plaid_1.CountryCode.Us],
        language: "en",
    });
    return { linkToken: response.data.link_token };
});
//# sourceMappingURL=createPlaidLinkToken.js.map