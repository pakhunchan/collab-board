# CollabBoard — Product Requirements Document

**Version:** 1.0
**Last Updated:** February 16, 2026

---

## 1. Executive Summary

CollabBoard is a real-time collaborative whiteboard with AI-powered board manipulation. The core constraint: **bulletproof multiplayer sync first, features second**. This PRD is structured as incrementally testable sections — each section ends with explicit test criteria that must pass before moving to the next.

**MVP Deadline:** 24 hours
**Full Feature Set:** 4 days
**Final Submission:** 7 days

---

## 2. Technical Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Frontend** | Next.js 14+ (App Router) + React 18 | Vercel deployment, TypeScript, strong AI tooling knowledge |
| **Canvas** | Konva.js via `react-konva` | React-idiomatic canvas, built-in Transformer for resize/rotate, handles 500+ objects |
| **State Management** | XState + Zustand | XState for state machines (connection, editing modes, sync), Zustand for board object data |
| **Authentication** | Firebase Auth | Email/password + Google OAuth, fast setup, client-side SDK with `onAuthStateChanged` listener |
| **Database** | Supabase PostgreSQL | Board persistence, object storage. Server-side auth validation (no RLS dependency on Supabase Auth) |
| **Real-time Sync** | Supabase Realtime (Broadcast + Presence) | WebSocket-based, <50ms cursor sync, Broadcast for ephemeral data, Presence for online users |
| **AI Agent** | OpenAI API (function calling) | Function calling maps 1:1 to board operations, <2s response |
| **Deployment** | Vercel (app) + Supabase (managed) + Firebase (auth) | Zero-ops, free tiers |

### Auth Architecture Note

Firebase Auth handles all user-facing authentication. The Next.js server verifies Firebase ID tokens on API routes. Supabase is accessed via service role key on the server — no RLS policies needed. The Supabase Realtime client on the frontend connects using the anon key with channel-level access (board ID as channel name).

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Vercel (Next.js)                    │
│                                                      │
│  ┌───────────┐  ┌────────────┐  ┌──────────────┐    │
│  │  Board UI  │  │  Firebase   │  │  AI Agent    │    │
│  │  (react-  │  │   Auth      │  │  (/api/ai)   │    │
│  │   konva)  │  │  (client)   │  │              │    │
│  └─────┬─────┘  └──────┬─────┘  └──────┬───────┘    │
└────────┼────────────────┼───────────────┼────────────┘
         │                │               │
    ┌────▼────────────────┤         ┌─────▼──────┐
    │     Supabase        │         │  OpenAI API │
    │  PostgreSQL +       │         │  (function  │
    │  Realtime           │         │  calling)   │
    │  (Broadcast,        │         └────────────┘
    │   Presence)         │
    └─────────────────────┘
              │
        ┌─────▼─────┐
        │  Firebase  │
        │  Auth      │
        │  (verify   │
        │  tokens)   │
        └────────────┘
```

### Data Flow Patterns

**User Joins Board:**
```
User → Sign in via Firebase Auth → Navigate to /board/[id]
→ Subscribe to Supabase Realtime channel (board:[id])
→ Fetch board state from PostgreSQL via API → Render canvas
```

**User Creates/Moves Object:**
```
User action → Optimistic local state update (Zustand)
→ Broadcast delta via Supabase Realtime
→ Write to PostgreSQL (debounced 200-500ms)
→ Other clients receive broadcast → Re-render
```

**Cursor Tracking:**
```
Mouse move → Throttle ~20/sec → Broadcast cursor position
→ Other clients receive → Render remote cursor with name label
```

**Presence:**
```
User joins → Supabase Presence .track({ userId, displayName })
→ Other clients receive presence_join → Update online list
→ User leaves → .untrack() → presence_leave
```

**AI Command:**
```
User types command → POST /api/ai { message, boardId, firebaseToken }
→ Verify Firebase token → Fetch board state from PostgreSQL
→ Send to OpenAI with functions → Execute function calls (INSERT/UPDATE)
→ Broadcast deltas → All users see AI changes in real-time
```

### Conflict Resolution

- **Strategy:** Last-write-wins using `updated_at` timestamps
- **Rationale:** Spec explicitly allows this. Spatial whiteboard layout makes conflicts rare.
- **Edge case:** Two users move same object → last broadcast wins

### Reconnection Handling (XState)

1. `disconnected` → Show offline indicator
2. `reconnecting` → Re-subscribe to Realtime channel
3. `fetching` → Fetch full board state from PostgreSQL
4. `reconciling` → Merge with pending local updates
5. `connected` → Resume broadcasting

---

## 4. Database Schema

```sql
-- Boards table
create table boards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Board',
  created_by text not null,           -- Firebase UID
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Board members (access control)
create table board_members (
  board_id uuid references boards(id) on delete cascade,
  user_id text not null,              -- Firebase UID
  display_name text,
  role text default 'editor',
  joined_at timestamptz default now(),
  primary key (board_id, user_id)
);

-- Board objects (all whiteboard elements)
create table board_objects (
  id uuid primary key default gen_random_uuid(),
  board_id uuid references boards(id) on delete cascade,
  type text not null,       -- 'sticky_note' | 'rectangle' | 'circle' | 'line' | 'text' | 'frame' | 'connector'
  x float not null default 0,
  y float not null default 0,
  width float,
  height float,
  rotation float default 0,
  text text,
  color text default '#FFEB3B',
  z_index int default 0,
  properties jsonb default '{}',     -- type-specific data (points, fromId, toId, etc.)
  created_by text,                   -- Firebase UID
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Indexes
create index idx_board_objects_board_id on board_objects(board_id);
create index idx_board_objects_updated_at on board_objects(updated_at);
```

### Object Type Schema

| Type | Required Fields | Properties (JSONB) |
|------|----------------|-------------------|
| `sticky_note` | type, x, y, text, color, width, height | fontSize |
| `rectangle` | type, x, y, width, height, color | strokeColor, strokeWidth |
| `circle` | type, x, y, width, height, color | strokeColor, strokeWidth |
| `line` | type, x, y, color, properties.points | strokeWidth |
| `text` | type, x, y, text, color | fontSize, fontWeight |
| `frame` | type, x, y, width, height, properties.title | borderColor |
| `connector` | type, properties.fromId, properties.toId | style, strokeWidth |

---

## 5. Project Structure

```
collab-board/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Landing / board list
│   │   ├── layout.tsx                  # Root layout + providers
│   │   ├── globals.css
│   │   ├── auth/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── board/[id]/
│   │   │   └── page.tsx                # Board page (canvas + UI)
│   │   └── api/
│   │       ├── boards/
│   │       │   └── route.ts            # Board CRUD
│   │       ├── boards/[id]/
│   │       │   ├── route.ts            # Single board operations
│   │       │   └── objects/
│   │       │       └── route.ts        # Board objects CRUD
│   │       └── ai/
│   │           └── route.ts            # AI agent endpoint
│   ├── components/
│   │   ├── board/
│   │   │   ├── Canvas.tsx              # Konva Stage + pan/zoom
│   │   │   ├── BoardObject.tsx         # Renders objects by type
│   │   │   ├── StickyNote.tsx
│   │   │   ├── Shape.tsx               # Rectangle / Circle / Line
│   │   │   ├── TextElement.tsx
│   │   │   ├── Frame.tsx
│   │   │   ├── Connector.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   ├── SelectionBox.tsx
│   │   │   ├── Cursors.tsx
│   │   │   ├── PresenceBar.tsx
│   │   │   └── ColorPicker.tsx
│   │   ├── ai/
│   │   │   └── AiChatPanel.tsx
│   │   └── auth/
│   │       └── AuthForm.tsx
│   ├── lib/
│   │   ├── firebase.ts                 # Firebase app + auth init
│   │   ├── supabase/
│   │   │   ├── client.ts               # Browser Supabase client (anon key)
│   │   │   └── server.ts               # Server Supabase client (service role)
│   │   ├── auth-context.tsx            # React context for Firebase Auth
│   │   ├── realtime.ts                 # Realtime channel helpers
│   │   └── ai-tools.ts                # AI tool definitions + executors
│   ├── hooks/
│   │   ├── useBoard.ts                 # Board CRUD operations
│   │   ├── useCanvas.ts                # Pan/zoom/selection state
│   │   ├── useRealtime.ts              # Supabase Realtime subscription
│   │   └── useCursors.ts              # Cursor tracking via Broadcast
│   ├── machines/
│   │   ├── connectionMachine.ts        # XState: connection lifecycle
│   │   ├── editorMachine.ts            # XState: editing modes
│   │   └── syncMachine.ts             # XState: sync state management
│   ├── stores/
│   │   └── boardStore.ts              # Zustand store for board objects
│   └── types/
│       └── board.ts                   # TypeScript types
├── public/
├── .env.local
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## 6. Environment Variables

```env
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# OpenAI
OPENAI_API_KEY=sk-...

# App
NEXT_PUBLIC_APP_URL=https://collabboard.vercel.app
```

---

## 7. Dependencies

```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-konva": "^18.2.10",
    "konva": "^9.3.0",
    "firebase": "^10.8.0",
    "firebase-admin": "^12.0.0",
    "@supabase/supabase-js": "^2.39.0",
    "openai": "^4.28.0",
    "xstate": "^5.0.0",
    "@xstate/react": "^4.0.0",
    "zustand": "^4.5.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@types/uuid": "^9",
    "typescript": "^5",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "eslint": "^8",
    "eslint-config-next": "^14"
  }
}
```

---

## 8. Build Sections (Incrementally Testable)

Each section must pass its tests before proceeding to the next. This is the core of the build strategy. Sections are intentionally small — if something breaks, you know exactly where.

---

### SECTION 1: Project Init + Firebase Auth

**Goal:** User can sign up, log in, and access a protected page.

**Build:**
1. Initialize Next.js project with TypeScript + Tailwind
2. Create Firebase project, enable Email/Password + Google auth providers
3. Initialize Firebase in `src/lib/firebase.ts`
4. Create `AuthContext` provider in `src/lib/auth-context.tsx` wrapping `onAuthStateChanged`
5. Build login page (`/auth/login`) and signup page (`/auth/signup`) with `AuthForm` component
6. Create protected layout for `/board/*` routes — redirect to `/auth/login` if not authenticated
7. Landing page (`/`) — simple page with "Go to Board" button (hardcoded board ID for now)

**Test Criteria:**
- [ ] `npm run dev` starts without errors
- [ ] Can create a new account with email/password
- [ ] Can log in with existing account
- [ ] Can log in with Google OAuth
- [ ] Unauthenticated user visiting `/board/test` is redirected to `/auth/login`
- [ ] Authenticated user can access `/board/test` (blank page is fine)
- [ ] Can log out and get redirected to login
- [ ] Firebase console shows registered users

---

### SECTION 2: Supabase Connection + Database Schema

**Goal:** Supabase project is set up, schema is created, and we can read/write from Next.js.

**Build:**
1. Create Supabase project, save credentials to `.env.local`
2. Create Supabase server client (`src/lib/supabase/server.ts`) using service role key
3. Create Supabase browser client (`src/lib/supabase/client.ts`) using anon key
4. Run database migration (create `boards`, `board_members`, `board_objects` tables)
5. Create a test API route `GET /api/health` that queries Supabase and returns connection status
6. Create API route `POST /api/boards` — creates a board (validates Firebase ID token, inserts into `boards` + `board_members`)
7. Create API route `GET /api/boards/[id]` — fetches a single board

**Test Criteria:**
- [ ] `GET /api/health` returns `{ status: "ok", supabase: "connected" }`
- [ ] Tables exist in Supabase dashboard (boards, board_members, board_objects)
- [ ] `POST /api/boards` with valid Firebase token creates a board and returns its ID
- [ ] `POST /api/boards` with no/invalid token returns 401
- [ ] `GET /api/boards/[id]` returns the created board
- [ ] Board row in Supabase dashboard shows correct `created_by` (Firebase UID)

---

### SECTION 3: Deploy Skeleton

**Goal:** Deploy what we have (auth + empty board page) to Vercel. Catch deployment/config issues now, not after building everything.

**Build:**
1. Set all environment variables in Vercel dashboard (Firebase + Supabase keys)
2. Deploy to Vercel (`vercel deploy --prod` or push to main)
3. Verify all features work on the public URL, not just localhost

**Test Criteria:**
- [ ] App is accessible at public Vercel URL
- [ ] Can sign up / log in on the public URL
- [ ] Protected route redirect works on public URL
- [ ] `/api/health` returns ok on public URL (Supabase connection works in production)
- [ ] No console errors related to missing env vars

---

### SECTION 4: Infinite Canvas with Pan/Zoom

**Goal:** Empty canvas that supports infinite pan and zoom on the board page.

**Build:**
1. Create `Canvas.tsx` with Konva `<Stage>` and `<Layer>`
2. Implement pan: Stage `draggable` prop + constrain to middle-mouse or space+drag
3. Implement zoom: `onWheel` handler with scale transformation around cursor position
4. Render on the `/board/[id]` page (behind auth protection)
5. Add basic toolbar placeholder (select, pan, sticky note tool buttons — non-functional for now)

**Test Criteria:**
- [ ] Board page shows canvas (gray background or dot grid)
- [ ] Can pan the canvas by dragging (middle mouse or space+drag)
- [ ] Can zoom in/out with scroll wheel
- [ ] Zoom is centered on cursor position
- [ ] Pan and zoom are smooth (60 FPS — check DevTools Performance tab)
- [ ] Canvas feels "infinite" — no visible edges at any zoom level
- [ ] Toolbar renders with tool buttons (buttons don't need to work yet)

---

### SECTION 5: Sticky Notes — Local Only (No Sync)

**Goal:** Can create, edit text, and drag-move sticky notes on the canvas. Local state only — no network, no sync. This isolates the Konva component from real-time complexity.

**Build:**
1. Create Zustand `boardStore.ts` — holds `Map<id, BoardObject>`, methods: `addObject`, `updateObject`, `removeObject`
2. Create `StickyNote.tsx` Konva component (Group containing Rect + Text)
3. Toolbar: click "Sticky Note" tool → click canvas → creates new sticky note at click position
4. Drag sticky note → updates `x, y` in Zustand store
5. Double-click sticky note → opens inline text editing (HTML overlay positioned on canvas)
6. Create `BoardObject.tsx` wrapper that renders the correct component by `type`

**Test Criteria:**
- [ ] Click "Sticky Note" in toolbar, then click on canvas → yellow sticky note appears
- [ ] Can create multiple sticky notes at different positions
- [ ] Drag a sticky note → it moves smoothly, stays where you drop it
- [ ] Double-click sticky note → can edit text, press Enter or click away to confirm
- [ ] Edited text persists in the note after closing editor
- [ ] Notes render correctly at different zoom levels
- [ ] Creating and dragging notes maintains 60 FPS

---

### SECTION 6: Real-time Cursors

**Goal:** Two browser tabs show each other's cursors with name labels in real-time. This proves the Supabase Realtime connection works before adding object sync.

**Build:**
1. Create `useRealtime.ts` hook — subscribes to Supabase Realtime channel `board:{boardId}`
2. Create `useCursors.ts` hook — broadcasts cursor position via Realtime Broadcast, throttled to ~20/sec
3. Create `Cursors.tsx` component — renders other users' cursor positions as colored arrows with name labels
4. Create XState `connectionMachine.ts` with states: `disconnected → connecting → connected → reconnecting`
5. Wire connection machine to control Realtime subscription lifecycle

**Test Criteria:**
- [ ] Open 2 browser tabs (same board URL, logged in as different users)
- [ ] Tab A moves mouse → Tab B sees Tab A's cursor with name label
- [ ] Tab B moves mouse → Tab A sees Tab B's cursor
- [ ] Cursor latency feels instant (<50ms)
- [ ] Cursors are smoothly animated (no teleporting/jumping)
- [ ] Each cursor has a different color and shows user's display name
- [ ] Close Tab A → Tab B no longer sees Tab A's cursor (within a few seconds)
- [ ] Cursors render correctly when canvas is panned/zoomed

---

### SECTION 7: Object Sync — Real-time Broadcast

**Goal:** When a user creates, moves, or edits a sticky note, other users see the change in real-time via Broadcast. No DB persistence yet — this is ephemeral sync only.

**Build:**
1. On object create/update/delete in Zustand store, broadcast the delta via Realtime Broadcast
2. On receiving a broadcast event, apply the delta to the local Zustand store
3. Handle all three event types: `object:create`, `object:update`, `object:delete`
4. Ensure the sender does NOT apply their own broadcast (deduplicate by sender ID)

**Test Criteria:**
- [ ] Tab A creates sticky note → appears in Tab B within <100ms
- [ ] Tab A moves sticky note → movement reflected in Tab B within <100ms
- [ ] Tab A edits sticky note text → updated text appears in Tab B
- [ ] Tab B creates a note → Tab A sees it
- [ ] Create 10 sticky notes rapidly in Tab A → all 10 appear in Tab B
- [ ] Move a note back and forth quickly → Tab B tracks it smoothly
- [ ] **Known limitation (ok for now):** Refreshing the page loses all objects (no persistence yet)

---

### SECTION 8: Object Persistence — Database Read/Write

**Goal:** Board objects persist to PostgreSQL. Refreshing the page or all users leaving and returning does not lose data.

**Build:**
1. Create API route `POST /api/boards/[id]/objects` — insert object into `board_objects` table
2. Create API route `GET /api/boards/[id]/objects` — fetch all objects for a board
3. Create API route `PATCH /api/boards/[id]/objects/[objectId]` — update an object
4. Create API route `DELETE /api/boards/[id]/objects/[objectId]` — delete an object
5. On page mount: fetch all objects from DB via GET, populate Zustand store
6. On object create: immediately POST to DB (in addition to broadcast)
7. On object update: debounce 300ms then PATCH to DB (broadcast remains instant)
8. On object delete: immediately DELETE from DB (in addition to broadcast)

**Test Criteria:**
- [ ] Create 5 sticky notes → refresh page → all 5 are still there
- [ ] Move a note, edit its text → refresh → changes persisted
- [ ] Close ALL browser tabs → reopen board → all objects are there
- [ ] Tab A creates objects → Tab B refreshes → Tab B sees all objects (loaded from DB)
- [ ] Supabase dashboard shows rows in `board_objects` table
- [ ] Rapid edits (move note 20 times quickly) → only a few DB writes (debounce working), but final position is persisted

---

### SECTION 9: Rectangles + Selection/Transformer

**Goal:** Second object type (rectangle). Click-to-select with resize/rotate handles.

**Build:**
1. Create `Shape.tsx` component for rectangles (Konva Rect)
2. Add "Rectangle" tool to toolbar
3. Click canvas with rectangle tool → creates rectangle at click position
4. Implement single-click selection (click object → shows Konva Transformer handles)
5. Transformer enables: resize (corner handles) + rotate (rotation handle)
6. Selection state in Zustand (`selectedObjectIds`)
7. Click empty canvas → deselect all
8. Selection + transform changes sync via broadcast + persist to DB (reuses Section 7-8 infrastructure)

**Test Criteria:**
- [ ] Click "Rectangle" in toolbar, click canvas → rectangle appears
- [ ] Click rectangle → Transformer handles appear (resize + rotate)
- [ ] Drag corner handle → rectangle resizes
- [ ] Drag rotation handle → rectangle rotates
- [ ] Click empty space → deselects (handles disappear)
- [ ] Can also select and transform sticky notes (not just rectangles)
- [ ] Rectangle create/move/resize/rotate syncs to other tabs in <100ms
- [ ] Rectangle changes persist after refresh
- [ ] Sticky notes and rectangles coexist correctly on the same board

---

### SECTION 10: Presence Awareness

**Goal:** Users can see who else is currently on the board.

**Build:**
1. Create `PresenceBar.tsx` — shows list of online users with colored avatars/initials
2. Use Supabase Presence (`.track()` / `.untrack()`) on the board channel
3. Track: `{ userId, displayName, color }` per user
4. Show presence bar at top of board page
5. User colors assigned deterministically from userId (hash → color palette), matching cursor colors

**Test Criteria:**
- [ ] Open Tab A → presence bar shows 1 user (you)
- [ ] Open Tab B (different account) → both tabs show 2 users
- [ ] Close Tab B → Tab A updates to show 1 user within a few seconds
- [ ] Each user has a distinct color that matches their cursor color
- [ ] Display names are correct
- [ ] Open 3+ tabs with different accounts → all shown in presence bar

---

### SECTION 11: Reconnection Handling

**Goal:** Graceful handling of network disconnections with visual feedback and state recovery.

**Build:**
1. XState connection machine handles: detect disconnect → show offline indicator → auto-reconnect → re-subscribe to Realtime → re-fetch board state from DB → reconcile with local state
2. Add visual connection status indicator (green = connected, yellow = reconnecting, red = offline)
3. Toast notification on disconnect/reconnect events

**Test Criteria:**
- [ ] Chrome DevTools → Network → Offline: connection indicator turns red/yellow
- [ ] Re-enable network → indicator turns green, board state is restored
- [ ] Tab A goes offline → Tab B creates 3 objects → Tab A comes back online → Tab A sees all 3 new objects
- [ ] Tab A goes offline → Tab A creates an object locally → Tab A reconnects → object persists to DB and syncs to Tab B
- [ ] No data loss during disconnect/reconnect cycle
- [ ] Toast notifications appear for disconnect/reconnect events

---

### SECTION 12: MVP Gate — Full Verification

**Goal:** Re-deploy and run the complete MVP checklist against the production URL.

**Build:**
1. Re-deploy to Vercel with all changes since Section 3
2. Run every test below against the **production URL** (not localhost)

**Test Criteria (ALL required to pass MVP):**
- [ ] **Deployed and publicly accessible** at Vercel URL
- [ ] **User authentication** — can sign up and log in (Firebase Auth)
- [ ] **Infinite board** with smooth pan/zoom
- [ ] **Sticky notes** — create, edit text, change position
- [ ] **At least one shape type** — rectangles with resize/rotate
- [ ] **Create, move, edit objects** — all operations work
- [ ] **Real-time sync** — 2 users in different browsers see each other's changes <100ms
- [ ] **Multiplayer cursors** with name labels, <50ms latency
- [ ] **Presence awareness** — can see who's online
- [ ] **State persistence** — board survives refresh, all-users-leave, reconnection
- [ ] **Stress test:** create 20 objects rapidly, verify sync and no data loss

---

## === MVP COMPLETE — STOP AND VERIFY ALL SECTION 12 TESTS PASS ===

Everything below is post-MVP. Do not proceed until MVP is fully tested and deployed.

---

### SECTION 13: Additional Shapes & Text Elements

**Goal:** Circle, line, and standalone text elements.

**Build:**
1. Extend `Shape.tsx` for circles (Konva Circle/Ellipse)
2. Add line tool — click-drag to create line (Konva Line with two points)
3. Create `TextElement.tsx` — standalone text on canvas, double-click to edit
4. Add corresponding toolbar buttons
5. All new types sync/persist using existing infrastructure

**Test Criteria:**
- [ ] Can create circles — renders correctly, resize/rotate works
- [ ] Circle create/move/resize syncs to other tabs and persists after refresh
- [ ] Can create lines — syncs to other tabs and persists
- [ ] Can create standalone text, edit inline — syncs and persists
- [ ] All object types (sticky, rect, circle, line, text) coexist and render correctly
- [ ] Selecting any type shows Transformer handles

---

### SECTION 14: Connectors & Frames

**Goal:** Lines/arrows connecting objects. Frame containers for grouping.

**Build:**
1. Create `Connector.tsx` — draws line/arrow between two objects using their positions
2. Connector creation: select connector tool, click source object, click target object
3. Connectors update dynamically when connected objects move
4. Create `Frame.tsx` — labeled rectangular container (title bar + border)
5. Frames render behind other objects (lower z-index)
6. Store connector endpoints as `properties.fromId` / `properties.toId`

**Test Criteria:**
- [ ] Can create a connector between two objects — renders as line/arrow
- [ ] Moving a connected object → connector endpoints update in real-time
- [ ] Connectors sync to other tabs and persist after refresh
- [ ] Can create frames with editable titles
- [ ] Frames render behind other objects
- [ ] Frames sync to other tabs and persist
- [ ] Deleting a connected object removes or orphans its connectors gracefully

---

### SECTION 15: Advanced Selection & Operations

**Goal:** Multi-select, delete, duplicate, copy/paste, color picker.

**Build:**
1. Shift-click for multi-select (adds/removes from selection)
2. Drag-to-select box (`SelectionBox.tsx`) — selects all objects within box
3. Delete key → deletes selected objects (broadcast + DB delete)
4. Ctrl+D → duplicate selected objects (offset by 20px)
5. Ctrl+C / Ctrl+V → copy/paste (local clipboard, paste at cursor position)
6. Color picker UI (`ColorPicker.tsx`) for changing selected object colors

**Test Criteria:**
- [ ] Shift-click selects multiple objects, shift-click again deselects
- [ ] Drag box selects all fully enclosed objects
- [ ] Delete key removes selected objects — syncs to other tabs, gone after refresh
- [ ] Ctrl+D duplicates with offset — syncs to other tabs, persists
- [ ] Ctrl+C then Ctrl+V pastes at new position
- [ ] Color picker changes object color — syncs to other tabs, persists
- [ ] All operations work on mixed selections (sticky + rect + circle etc.)

---

### SECTION 16: AI Agent — Basic Commands

**Goal:** AI chat panel with single-step creation and manipulation commands.

**Build:**
1. Create `AiChatPanel.tsx` — slide-out panel with text input and message history
2. Create `/api/ai/route.ts`:
   - Verify Firebase token
   - Fetch board state from PostgreSQL
   - Send to OpenAI with function definitions
   - Execute returned function calls (INSERT/UPDATE board_objects)
   - Broadcast deltas via Supabase Realtime
3. Implement AI tool functions:
   - `createStickyNote(text, x, y, color)`
   - `createShape(type, x, y, width, height, color)`
   - `createFrame(title, x, y, width, height)`
   - `createConnector(fromId, toId, style)`
   - `moveObject(objectId, x, y)`
   - `resizeObject(objectId, width, height)`
   - `updateText(objectId, newText)`
   - `changeColor(objectId, color)`
   - `getBoardState()`

**Test Criteria:**
- [ ] AI chat panel opens/closes
- [ ] "Add a yellow sticky note that says 'User Research'" → sticky note appears on board
- [ ] "Create a blue rectangle at position 200, 300" → rectangle appears
- [ ] "Change the sticky note color to green" → color changes
- [ ] "Move the rectangle to 500, 500" → rectangle moves
- [ ] AI-created/modified objects appear for ALL connected users in real-time
- [ ] AI-created objects persist after refresh
- [ ] Response latency <2 seconds for single-step commands
- [ ] 6+ distinct command types work
- [ ] Error messages shown in chat panel for invalid commands

---

### SECTION 17: AI Agent — Complex Commands

**Goal:** Multi-step template generation, layout commands, context-aware manipulation.

**Build:**
1. Enhance system prompt to support multi-step reasoning and chained function calls
2. Complex templates: SWOT analysis (4 frames in 2x2 grid), user journey map, retrospective board
3. Layout commands: "Arrange in a grid", "Space evenly"
4. Context-aware: "Move all pink sticky notes to the right side" (uses getBoardState)

**Test Criteria:**
- [ ] "Create a SWOT analysis" → 4 labeled quadrants appear correctly arranged
- [ ] "Build a user journey map with 5 stages" → 5 frames in a row with stage labels
- [ ] "Set up a retrospective board" → 3 columns (What Went Well, What Didn't, Action Items)
- [ ] "Arrange these sticky notes in a grid" → objects align with even spacing
- [ ] "Move all pink sticky notes to the right" → only pink notes move
- [ ] Two users issue AI commands simultaneously → no conflicts, both execute
- [ ] Multi-step commands complete without partial failures
- [ ] All AI-generated content syncs to other tabs and persists

---

### SECTION 18: Polish, Performance & Final Verification

**Goal:** Hit performance targets. Polish UX. Final deployment and verification.

**Build:**
1. Performance: create 500+ objects, verify 60 FPS pan/zoom
2. Optimize: Konva layer caching, React.memo on shape components, Zustand selectors
3. Test with 5+ concurrent users
4. Board list dashboard page (create new boards, see your boards, delete boards)
5. Shareable board links (anyone with link can join)
6. Keyboard shortcuts: ESC to deselect, arrow keys to nudge, Del to delete
7. Final Vercel deployment

**Test Criteria:**
- [ ] 500+ objects on board → pan/zoom at 60 FPS
- [ ] 5+ concurrent users editing simultaneously → no degradation
- [ ] Object sync confirmed <100ms, cursor sync confirmed <50ms
- [ ] Network throttle (Chrome → Slow 3G) → objects eventually sync, reconnection works
- [ ] Dashboard: can create new board, see list of boards, navigate to board
- [ ] Shareable link: copy link, open in incognito, join board
- [ ] Keyboard shortcuts: ESC deselects, arrow keys nudge, Del deletes
- [ ] Final production URL passes all MVP gate tests (Section 12) again
- [ ] Full test suite from spec passes:
  - [ ] 2 users editing simultaneously in different browsers
  - [ ] One user refreshing mid-edit (state persists)
  - [ ] Rapid creation/movement (sync performance)
  - [ ] Network throttling and disconnection recovery
  - [ ] 5+ concurrent users without degradation

---

## 9. Performance Targets (Reference)

| Metric | Target | Testing Method |
|--------|--------|----------------|
| Frame rate | 60 FPS during pan/zoom/manipulation | Chrome DevTools Performance tab |
| Object sync latency | <100ms | Create in Tab A, measure in Tab B |
| Cursor sync latency | <50ms | Move in Tab A, measure in Tab B |
| Object capacity | 500+ without performance drops | Bulk create, verify FPS |
| Concurrent users | 5+ without degradation | 5+ browser tabs as different users |
| AI response time | <2s for single-step | Time from send to objects appearing |

---

## 10. Evaluation Testing Scenarios (from spec)

These will be used for evaluation. Ensure all pass:

1. **2 users editing simultaneously** in different browsers
2. **One user refreshing mid-edit** — state persistence check
3. **Rapid creation and movement** of sticky notes and shapes — sync performance
4. **Network throttling and disconnection recovery**
5. **5+ concurrent users** without degradation

---

## 11. Cost Projections

### AI API Cost Estimates

**Assumptions:**
- 5 AI commands per user per session
- 2 sessions per user per month
- ~1500 tokens per command (1000 input, 500 output)
- GPT-4 Turbo: ~$10/1M input, ~$30/1M output

| Scale | Supabase | Vercel | Firebase Auth | AI API | Total |
|-------|----------|--------|---------------|--------|-------|
| 100 users | Free | Free | Free | ~$25 | ~$25/mo |
| 1,000 users | $25 (Pro) | Free | Free | ~$250 | ~$275/mo |
| 10,000 users | $100+ | $20 (Pro) | Free | ~$2,500 | ~$2,620/mo |
| 100,000 users | $500+ | $150+ | $0.06/verify | ~$25,000 | ~$25,650/mo |

Firebase Auth is free for email/password and Google up to very high scale (no per-MAU cost for basic providers).

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Real-time sync complexity | High | Start with cursor sync (simplest). Test with 2 tabs continuously. Don't move to next section until sync works. |
| Firebase + Supabase integration | Medium | Firebase handles auth only. Supabase accessed via service role on server. No RLS dependency. |
| Canvas performance at scale | Medium | Profile with 500+ objects early. Use Konva layer caching, React.memo, virtualization if needed. |
| AI API costs | Low (dev) | Track usage. Rate limit in production. |
| Deployment issues | Low | Deploy early (Section 8). Keep deployed MVP working at all times. |

---

## 13. Submission Deliverables

| Deliverable | Requirements |
|-------------|-------------|
| GitHub Repository | Setup guide, architecture overview, deployed link |
| Demo Video (3-5 min) | Real-time collaboration, AI commands, architecture explanation |
| Pre-Search Document | Completed checklist from Phase 1-3 |
| AI Development Log | 1-page: tools, MCPs, effective prompts, code analysis, learnings |
| AI Cost Analysis | Dev spend + projections for 100/1K/10K/100K users |
| Deployed Application | Public URL, supports 5+ users with auth |
| Social Post | X or LinkedIn with description, features, demo, tag @GauntletAI |

---

**End of PRD**
