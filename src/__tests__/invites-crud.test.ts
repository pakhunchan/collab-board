import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { POST, GET } from "@/app/api/boards/[id]/invites/route";

const BOARD_ID = "board-uuid-1";
const params = { params: { id: BOARD_ID } };

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
});

describe("POST /api/boards/[id]/invites", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await POST(makeRequest("POST", { expiresIn: "1d" }), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when board not found", async () => {
    mockSupabase.addChain({ data: null, error: null }); // boards lookup
    const res = await POST(makeRequest("POST", { expiresIn: "1d" }), params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Board not found");
  });

  it("returns 403 when user is not the owner", async () => {
    setMockUser({ uid: "other-user" });
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    const res = await POST(makeRequest("POST", { expiresIn: "1d" }), params);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid expiresIn value", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    const res = await POST(
      makeRequest("POST", { expiresIn: "invalid" }),
      params
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid expiresIn");
  });

  it("creates invite with 3h expiry", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    }); // boards lookup
    mockSupabase.addChain({
      data: {
        token: "invite-token-123",
        expires_at: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
      },
      error: null,
    }); // insert invite

    const res = await POST(makeRequest("POST", { expiresIn: "3h" }), params);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.token).toBe("invite-token-123");
    expect(body.expiresAt).toBeDefined();

    vi.restoreAllMocks();
  });

  it("creates invite with 1d expiry", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    mockSupabase.addChain({
      data: { token: "token-1d", expires_at: "2026-02-18T00:00:00Z" },
      error: null,
    });

    const res = await POST(makeRequest("POST", { expiresIn: "1d" }), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("token-1d");
  });

  it("creates invite with 3d expiry", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    mockSupabase.addChain({
      data: { token: "token-3d", expires_at: "2026-02-20T00:00:00Z" },
      error: null,
    });

    const res = await POST(makeRequest("POST", { expiresIn: "3d" }), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("token-3d");
  });

  it("returns 500 on insert error", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    mockSupabase.addChain({
      data: null,
      error: { message: "DB error" },
    });

    const res = await POST(makeRequest("POST", { expiresIn: "1d" }), params);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/boards/[id]/invites", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when board not found", async () => {
    mockSupabase.addChain({ data: null, error: null });
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not the owner", async () => {
    setMockUser({ uid: "other-user" });
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(403);
  });

  it("returns active invites for the owner", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    const invitesList = [
      {
        id: "inv-1",
        token: "t1",
        expires_at: "2026-02-19T00:00:00Z",
        created_at: "2026-02-17T00:00:00Z",
      },
    ];
    mockSupabase.addChain({ data: invitesList, error: null });

    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(invitesList);
  });

  it("returns 500 on query error", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: { message: "DB error" } });

    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(500);
  });
});
