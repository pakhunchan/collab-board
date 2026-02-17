import { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "./firebase-admin";

export async function verifyFirebaseToken(
  request: Request
): Promise<DecodedIdToken> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const token = header.slice(7);
  return adminAuth.verifyIdToken(token);
}
