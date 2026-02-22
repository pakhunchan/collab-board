import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getAuth } from "firebase/auth";

let client: SupabaseClient | null = null;
let claimsVerified = false;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  client = createClient(url, anonKey, {
    accessToken: async () => {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) return null;

      // First call: force refresh to ensure custom claims (role) are present.
      // Subsequent calls use the cached token (which now has the claim).
      if (!claimsVerified) {
        claimsVerified = true;
        return await user.getIdToken(true);
      }
      return await user.getIdToken();
    },
  });
  return client;
}

export function resetSupabaseBrowserClient() {
  client = null;
  claimsVerified = false;
}
