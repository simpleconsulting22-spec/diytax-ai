import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

export async function requireAuth(request: CallableRequest): Promise<string> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  return request.auth.uid;
}
