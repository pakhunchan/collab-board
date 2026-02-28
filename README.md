# CollabBoard

Real-time collaborative whiteboard with AI-powered board manipulation. Features multiplayer sync, an AI assistant for natural language commands, and an infinite canvas.

**Try it out:** [collab.pakhunchan.com](https://collab.pakhunchan.com/)

## Features

### Canvas
- Infinite pan and zoom
- Dot grid background

### Object Types
- Sticky notes
- Rectangles
- Circles
- Lines
- Text
- Frames
- Connectors

### Object Manipulation
- Selection (single and multi-select)
- Transform (resize and rotate)
- Inline text editing
- Delete, duplicate, copy/paste
- Color picker

### Real-time Collaboration
- Live object sync (<100ms latency)
- Multiplayer cursors (<50ms latency)
- Presence awareness
- Connection status indicator
- Auto-reconnection with exponential backoff

### AI Assistant
- Natural language commands to manipulate the board
- Batch create, update, and delete objects
- Templates (SWOT analysis, journey maps, retro boards)
- Context-aware manipulation of existing objects

### Board Management
- Dashboard with board listing
- Public and private boards
- Invite system with shareable links
- Member roles (owner, editor, viewer)

## Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 14 | App framework (App Router) |
| React 18 | UI components |
| Konva.js | HTML5 Canvas rendering |
| Zustand | Client state management |
| XState | Connection state machine |
| Supabase | Realtime sync + PostgreSQL database |
| Firebase Auth | Authentication |
| OpenAI API | AI assistant |
| LangSmith | AI observability |
| Tailwind CSS | Styling |
| TypeScript | Type safety |
| Vitest | Testing |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Browser    │◄───►│  Next.js API │◄───►│    Supabase      │
│  (React +    │     │   Routes     │     │  (PostgreSQL +   │
│   Konva)     │     └──────────────┘     │   Realtime)      │
│              │◄────────────────────────►│                   │
└──────┬───────┘   Supabase Realtime      └─────────────────┘
       │            (Broadcast +
       │             Presence)
       ▼
┌──────────────┐     ┌──────────────┐
│ Firebase Auth │     │  OpenAI API  │
└──────────────┘     └──────────────┘
```

### Data Flow

**Object sync** — Local mutation in Zustand store → broadcast via Supabase Realtime channel → peers receive and merge into their local stores.

**Cursor sync** — Pointer move events throttled → broadcast via Supabase Realtime → peers render remote cursors via presence store.

**AI commands** — User prompt → Next.js API route → OpenAI function calling → returns board operations → applied to local store and broadcast to peers.

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase project
- Firebase project (for authentication)
- OpenAI API key

### Environment Variables

Create a `.env.local` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# OpenAI
OPENAI_API_KEY=

# LangSmith (optional — AI observability)
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=
```

### Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Database Migrations

**Option A — Supabase CLI:**

```bash
npm i -g supabase
supabase init
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — Manual:**

Run each SQL file in `supabase/migrations/` in order via the [Supabase SQL Editor](https://supabase.com/dashboard):

- `001_initial_schema.sql` — Core tables (boards, objects, members)
- `002_board_visibility.sql` — Public/private board settings
- `003_board_invites.sql` — Invite system
- `004_channel_nonce.sql` — Realtime channel nonces
- `005_realtime_rls.sql` — Row-level security for realtime

## Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API routes (boards, invites, health)
│   ├── auth/                   # Login and signup pages
│   ├── board/[id]/             # Board editor page
│   ├── boards/                 # Board listing / dashboard
│   └── invite/                 # Invite acceptance page
├── components/
│   ├── auth/                   # Auth UI components
│   └── board/                  # Board components
│       ├── Canvas.tsx          # Main canvas (Konva stage, tools, rendering)
│       ├── AiPrompt.tsx        # AI assistant prompt UI
│       ├── Cursors.tsx         # Remote cursor rendering
│       ├── ColorPicker.tsx     # Color selection tool
│       ├── *Shape.tsx          # Shape components (Rect, Circle, Line, etc.)
│       └── ...
├── hooks/
│   ├── useBoardSync.ts         # Object sync via Supabase Realtime
│   ├── useCursors.ts           # Cursor presence sync
│   └── useConnectionManager.ts # Connection lifecycle management
├── lib/
│   ├── ai/                     # AI agent (OpenAI function calling)
│   ├── supabase/               # Supabase client, server, broadcast utils
│   ├── firebase.ts             # Firebase client config
│   ├── firebase-admin.ts       # Firebase Admin SDK
│   └── auth-context.tsx        # Auth context provider
├── machines/
│   └── connectionMachine.ts    # XState connection state machine
├── stores/
│   ├── boardStore.ts           # Board objects state (Zustand)
│   └── presenceStore.ts        # User presence state (Zustand)
├── types/
│   └── board.ts                # Board and object type definitions
└── __tests__/                  # Test files
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |

## Deployment

- **Frontend** — Deploy to [Vercel](https://vercel.com). Connect the repo and set environment variables.
- **Database** — Hosted on [Supabase](https://supabase.com). Run migrations via `supabase db push`.
- **Auth** — Managed by [Firebase](https://firebase.google.com). Configure authorized domains in the Firebase console.
