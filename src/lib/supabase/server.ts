import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(url, serviceRoleKey);
}
