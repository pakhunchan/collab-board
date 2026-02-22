# Fix: Realtime "Connecting" After Security Implementation

## Context

After implementing the `security_edge_case.md` plan (channel nonce rotation + Firebase JWT + Supabase RLS), additional users get stuck in "Connecting" for Realtime channels. REST API works fine (users can load boards, see objects, refresh). The issue is specifically that Realtime channel subscriptions never reach `SUBSCRIBED` state.

## Root Cause

**Firebase JWTs are missing the `role: "authenticated"` custom claim**, so Supabase defaults them to the `anon` PostgreSQL role. The RLS policies on `realtime.messages` target `TO authenticated` only, which blocks `anon` users from subscribing to private channels.

Why the claim is missing:
1. The `processSignUp` Cloud Function sets `{ role: "authenticated" }` asynchronously **after** user creation — the first token issued during sign-up won't have it
2. For existing users, the migration script was needed, but had issues
3. `getIdToken()` returns a **cached** token — even after the claim is set server-side, cached tokens don't include it until they expire (~1hr) or are force-refreshed

Without `role: "authenticated"` in the JWT → Supabase assigns `anon` role → `TO authenticated` RLS policy doesn't apply → channel subscription silently fails → "Connecting" forever.

## Fix

### 1. Force token refresh in `accessToken` callback

**File:** `src/lib/supabase/client.ts`

The `accessToken` callback should detect a missing `role` claim and force-refresh once. This ensures the token sent to Supabase Realtime always has the correct role.

```typescript
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
```

### 2. Force refresh after sign-up to handle Cloud Function race

**File:** `src/lib/auth-context.tsx`

After `createUserWithEmailAndPassword`, the `processSignUp` Cloud Function runs asynchronously to set the `role` claim. We need to wait briefly and force-refresh the token so subsequent Supabase operations have the claim.

In the `signUp` function:
```typescript
const signUp = async (email: string, password: string) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Wait for processSignUp Cloud Function to set custom claims, then refresh token
  await new Promise((r) => setTimeout(r, 2000));
  await cred.user.getIdToken(true);
};
```

### 3. Reset Supabase client on sign-out

**File:** `src/lib/auth-context.tsx`

Import and call `resetSupabaseBrowserClient()` on sign-out so the next user gets a fresh client with fresh claims verification:

```typescript
import { resetSupabaseBrowserClient } from "./supabase/client";

const signOut = async () => {
  await firebaseSignOut(auth);
  resetSupabaseBrowserClient();
};
```

### 4. Optimize RLS policy with `(select ...)` wrappers

**Run in Supabase SQL Editor**

Supabase docs recommend wrapping `realtime.topic()` and `auth.jwt()` calls in `(select ...)` for per-statement caching in the Realtime context:

```sql
DROP POLICY IF EXISTS "board_realtime_select" ON "realtime"."messages";
DROP POLICY IF EXISTS "board_realtime_insert" ON "realtime"."messages";

CREATE POLICY "board_realtime_select"
ON "realtime"."messages"
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE id::text = split_part((select realtime.topic()), ':', 2)
        AND visibility = 'public'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE user_id = (select auth.jwt()->>'sub')
        AND board_id::text = split_part((select realtime.topic()), ':', 2)
    )
  )
);

CREATE POLICY "board_realtime_insert"
ON "realtime"."messages"
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.messages.extension IN ('broadcast', 'presence')
  AND (
    EXISTS (
      SELECT 1 FROM public.boards
      WHERE id::text = split_part((select realtime.topic()), ':', 2)
        AND visibility = 'public'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.board_members
      WHERE user_id = (select auth.jwt()->>'sub')
        AND board_id::text = split_part((select realtime.topic()), ':', 2)
    )
  )
);
```

## Files to Modify

1. `src/lib/supabase/client.ts` — Add force-refresh logic and reset function
2. `src/lib/auth-context.tsx` — Force refresh after sign-up, reset client on sign-out

## Manual Steps (Supabase Dashboard)

1. Run the updated RLS policy SQL in Supabase SQL Editor (step 4 above)
2. Verify in **Authentication → Third-party Auth** that Firebase is enabled with the correct project ID

## Verification

1. **Check JWT claims**: After sign-in, open browser devtools and run:
   ```js
   const token = await firebase.auth().currentUser.getIdToken(true);
   console.log(JSON.parse(atob(token.split('.')[1])));
   ```
   Verify `role: "authenticated"` and `sub` (Firebase UID) are present.

2. **Test Realtime**: Open the board with two different users. Both should see "Connected" status (not "Connecting"). Real-time cursor movements and object changes should propagate between users.

3. **Test sign-up flow**: Create a brand new user, join a board, verify Realtime connects.
