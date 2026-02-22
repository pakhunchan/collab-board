# Security Edge Case: Realtime Channel Access After Revocation

## The Problem

When a user's access to a private board is revoked (e.g., board owner removes them), they should immediately lose the ability to read or write board data. This works correctly for REST API calls — every API route verifies board membership before proceeding. But for **Supabase Realtime WebSocket channels**, the story is different.

Supabase Realtime has no server-side API to forcibly close a client's WebSocket connection. Once a user is subscribed to a board's Realtime channel, revoking their `board_members` row does not disconnect them. They continue receiving all live broadcasts (object creates, updates, deletes, cursor movements, drawing previews) from other users on the board.

---

## Current Design

### Authentication

We use **Firebase Auth** for user identity. When a user signs in (Google OAuth or email/password), Firebase issues a JWT containing their user ID (`uid`). This JWT is passed as a `Bearer` token in the `Authorization` header of every REST API call.

**Server-side verification** happens in `src/lib/auth-helpers.ts`:
```
verifyFirebaseToken(request)  →  validates the Firebase JWT  →  returns { uid, email, name, ... }
```

### REST API Authorization

Every board-related API route calls `assertBoardAccess(uid, boardId)` after verifying the Firebase token. This function:

1. Fetches the board's `visibility` from the `boards` table
2. If `public` → access granted (any authenticated user)
3. If `private` → checks the `board_members` table for a matching `(board_id, user_id)` row
4. Throws a 403 error if no membership row exists

This is enforced at the **application layer** in Next.js API routes — not via database-level RLS policies. The server Supabase client uses the **service role key**, which bypasses all Postgres RLS.

**Result:** REST API calls are secure. A revoked user's requests are rejected immediately.

### Realtime WebSocket Channels

The browser's Supabase client (`src/lib/supabase/client.ts`) is initialized with only the **Supabase anon key**. No Firebase JWT is involved.

Each board uses **two Realtime channels** (both using Broadcast mode, not Postgres Changes):

| Channel | Name Pattern | Purpose | Hook |
|---------|-------------|---------|------|
| Objects | `board:{boardId}:objects` | Object CRUD, drawing previews, access events | `useBoardSync.ts` |
| Cursors | `board:{boardId}` | Cursor positions, user presence | `useCursors.ts` |

**There is no authentication or authorization gate on channel subscriptions.** Any client with the anon key (which is public by design) can subscribe to any channel name and receive all broadcasts.

### Current Revocation Mechanism

When the board owner removes a member via `DELETE /api/boards/{id}/members/{userId}`:

1. The `board_members` row is deleted
2. The server broadcasts an `access:revoked` event on the board's objects channel (fire-and-forget)
3. The removed user's client receives the event and shows an "Access Denied" screen

**Weaknesses:**

- **Fire-and-forget:** If the client misses the broadcast (network blip, browser tab suspended), they never get evicted and remain subscribed.
- **No enforcement:** The client voluntarily shows "Access Denied" — nothing server-side prevents them from staying on the channel.
- **No channel auth:** A technically savvy user could subscribe to any board's channel directly using the anon key, without ever going through `assertBoardAccess()`.

### Summary of Current Auth Flow

```
┌─────────────────────────────────────────────────────────┐
│                    REST API Calls                        │
│                                                         │
│  Client  ──Firebase JWT──►  Next.js API Route           │
│                             ├─ verifyFirebaseToken()     │
│                             ├─ assertBoardAccess()       │
│                             └─ Supabase (service role)   │
│                                                         │
│  Auth: Firebase JWT  ✓                                  │
│  Authorization: board_members check  ✓                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 Realtime WebSocket                       │
│                                                         │
│  Client  ──anon key──►  Supabase Realtime               │
│                          └─ subscribe to channel name    │
│                                                         │
│  Auth: anon key only  ✗  (no user identity)             │
│  Authorization: none  ✗  (any channel name accepted)    │
└─────────────────────────────────────────────────────────┘
```

---

## Planned Design

We address this with two complementary layers:

### Layer 1: Channel Rotation (Instant Revocation)

Instead of trying to kick a user off a channel, we **rotate the channel** — create a new one with an unpredictable name and move all authorized users to it. The revoked user is left on the dead old channel.

**How it works:**

1. Add a `channel_nonce` column (UUID) to the `boards` table
2. Channel names include the nonce: `board:{boardId}:{nonce}:objects`
3. On member removal:
   - Delete the `board_members` row
   - Generate a new UUID nonce and save it to the board
   - Broadcast a `channel:rotated` event on the **old** channel with the new nonce
4. Authorized clients receive the event, update their local nonce, and reconnect to the new channel
5. The revoked client either sees "Access Denied" (if they received the event) or is left on a dead channel (if they missed it)

**What this solves:**
- Revoked user immediately stops receiving updates (old channel is dead)
- Even if they miss the revocation broadcast, they get no further data
- The UUID nonce is unpredictable — they can't guess the new channel name

**What this doesn't solve:**
- If the revoked user somehow obtains the new nonce, they could subscribe to the new channel because there's still no server-side authorization on channel subscriptions

### Layer 2: Firebase JWT + Supabase RLS (Server-Enforced Authorization)

We configure Supabase to validate Firebase JWTs and enforce board membership via Postgres RLS policies on Realtime channel subscriptions.

**How it works:**

1. Configure Supabase to accept Firebase as a third-party JWT issuer (via Google's JWKS endpoint)
2. The browser Supabase client passes the Firebase JWT (not just the anon key) when connecting
3. Supabase validates the JWT and makes `auth.uid()` available in Postgres
4. RLS policies on Realtime authorization check `board_members` for the user's `auth.uid()`
5. Channel subscription is rejected if no matching membership row exists

**What this solves:**
- Server-enforced gate on channel subscriptions — no membership row, no access
- Even if the revoked user knows the channel nonce, they can't subscribe
- Closes the "anon key = access to any channel" vulnerability

### How the Two Layers Work Together

| Attack vector | Channel rotation | RLS |
|---|---|---|
| Stay on old channel, keep receiving | Blocked (channel is dead) | — |
| Subscribe to new channel (guess nonce) | Blocked (UUID is unpredictable) | Blocked (no membership) |
| Subscribe to new channel (obtained nonce) | Not blocked | **Blocked** (no membership) |
| Use still-valid Firebase JWT (~1hr window) | Blocked (old channel dead) | Blocked (membership check, not JWT validity) |
| Use anon key without any JWT | Blocked (can't guess nonce) | **Blocked** (no JWT = no `auth.uid()`) |
| REST API calls after revocation | — | — (already blocked by `assertBoardAccess`) |

**No gap remains.** Channel rotation provides instant revocation. RLS provides server-enforced authorization as a backstop.

### Summary of Planned Auth Flow

```
┌─────────────────────────────────────────────────────────┐
│                    REST API Calls                        │
│                        (unchanged)                       │
│                                                         │
│  Client  ──Firebase JWT──►  Next.js API Route           │
│                             ├─ verifyFirebaseToken()     │
│                             ├─ assertBoardAccess()       │
│                             └─ Supabase (service role)   │
│                                                         │
│  Auth: Firebase JWT  ✓                                  │
│  Authorization: board_members check  ✓                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 Realtime WebSocket                       │
│                       (new)                              │
│                                                         │
│  Client  ──Firebase JWT──►  Supabase Realtime           │
│                              ├─ validate JWT (JWKS)     │
│                              ├─ extract auth.uid()      │
│                              ├─ RLS: check board_members│
│                              └─ subscribe to channel    │
│                                                         │
│  Auth: Firebase JWT  ✓  (user identity verified)        │
│  Authorization: RLS  ✓  (board membership enforced)     │
│  Channel name: includes UUID nonce  ✓  (unpredictable)  │
└─────────────────────────────────────────────────────────┘
```
