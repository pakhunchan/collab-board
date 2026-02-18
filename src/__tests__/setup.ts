import { vi } from "vitest";

// --- Mock user state ---
let mockUid = "owner-uid-123";
let mockEmail = "owner@test.com";
let mockName = "Test Owner";
let shouldRejectAuth = false;

export function setMockUser(opts: {
  uid?: string;
  email?: string;
  name?: string;
}) {
  if (opts.uid !== undefined) mockUid = opts.uid;
  if (opts.email !== undefined) mockEmail = opts.email;
  if (opts.name !== undefined) mockName = opts.name;
}

export function setAuthShouldReject(reject: boolean) {
  shouldRejectAuth = reject;
}

export function resetMockUser() {
  mockUid = "owner-uid-123";
  mockEmail = "owner@test.com";
  mockName = "Test Owner";
  shouldRejectAuth = false;
}

// --- Supabase chainable mock ---

/**
 * Creates a chainable mock that mimics Supabase's query builder.
 * Every method returns the chain itself. Awaiting the chain resolves to `resolveValue`.
 */
export function mockChain(resolveValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "insert",
    "delete",
    "update",
    "eq",
    "neq",
    "gt",
    "lt",
    "gte",
    "lte",
    "order",
    "limit",
  ];

  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => resolveValue);

  // Make the chain thenable (for queries that don't end with .single())
  chain.then = (resolve: (v: unknown) => void) => {
    resolve(resolveValue);
    return Promise.resolve(resolveValue);
  };

  return chain;
}

/**
 * Creates a mock supabase client where `from()` returns a sequence of chains.
 * Call `addChain(result)` to add what the next `from()` call should return.
 */
export function createMockSupabase() {
  const chains: Record<string, unknown>[] = [];
  let callIdx = 0;

  function addChain(resolveValue: {
    data: unknown;
    error: unknown;
  }) {
    chains.push(mockChain(resolveValue));
  }

  const client = {
    from: vi.fn(() => {
      const chain = chains[callIdx] || mockChain({ data: null, error: null });
      callIdx++;
      return chain;
    }),
  };

  function reset() {
    chains.length = 0;
    callIdx = 0;
    client.from.mockClear();
  }

  return { client, addChain, reset };
}

// --- Shared mock instance ---
export const mockSupabase = createMockSupabase();

// --- Module mocks ---
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => mockSupabase.client,
}));

vi.mock("@/lib/supabase/broadcast", () => ({
  broadcastBoardEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth-helpers", () => ({
  verifyFirebaseToken: vi.fn(async () => {
    if (shouldRejectAuth) throw new Error("Unauthorized");
    return { uid: mockUid, email: mockEmail, name: mockName };
  }),
  assertBoardAccess: vi.fn(async () => {
    // Default: allow. Tests override with vi.mocked() if needed
  }),
}));

// --- Request helper ---
export function makeRequest(
  method: string,
  body?: Record<string, unknown>
): Request {
  const init: RequestInit = {
    method,
    headers: { Authorization: "Bearer fake-token" },
  };
  if (body) {
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:3000/test", init);
}
