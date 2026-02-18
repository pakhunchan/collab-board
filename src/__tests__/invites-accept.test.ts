import { describe, it, expect, beforeEach } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { POST } from "@/app/api/invites/[token]/route";

const TOKEN = "valid-invite-token";
const BOARD_ID = "board-uuid-1";
const params = { params: { token: TOKEN } };

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
  setMockUser({ uid: "invitee-uid-456", email: "invitee@test.com", name: "Invitee" });
});

describe("POST /api/invites/[token] — Accept invite", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await POST(makeRequest("POST"), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 for invalid token", async () => {
    mockSupabase.addChain({ data: null, error: null }); // invite lookup
    const res = await POST(makeRequest("POST"), params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Invalid invite link");
  });

  it("returns 410 for expired invite", async () => {
    mockSupabase.addChain({
      data: {
        board_id: BOARD_ID,
        expires_at: "2020-01-01T00:00:00Z", // in the past
      },
      error: null,
    });

    const res = await POST(makeRequest("POST"), params);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("Invite has expired");
  });

  it("adds user as editor for valid invite", async () => {
    mockSupabase.addChain({
      data: {
        board_id: BOARD_ID,
        expires_at: "2030-01-01T00:00:00Z", // future
      },
      error: null,
    }); // invite lookup

    mockSupabase.addChain({ data: null, error: null }); // existing member check (not found)
    mockSupabase.addChain({ data: null, error: null }); // insert member

    const res = await POST(makeRequest("POST"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boardId).toBe(BOARD_ID);
  });

  it("is idempotent — returns success if already a member", async () => {
    mockSupabase.addChain({
      data: {
        board_id: BOARD_ID,
        expires_at: "2030-01-01T00:00:00Z",
      },
      error: null,
    }); // invite lookup

    mockSupabase.addChain({
      data: { user_id: "invitee-uid-456" },
      error: null,
    }); // existing member found

    const res = await POST(makeRequest("POST"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boardId).toBe(BOARD_ID);
    // Should not have called insert (only 2 from() calls, not 3)
    expect(mockSupabase.client.from).toHaveBeenCalledTimes(2);
  });

  it("returns 500 on member insert error", async () => {
    mockSupabase.addChain({
      data: {
        board_id: BOARD_ID,
        expires_at: "2030-01-01T00:00:00Z",
      },
      error: null,
    }); // invite lookup

    mockSupabase.addChain({ data: null, error: null }); // not already member
    mockSupabase.addChain({
      data: null,
      error: { message: "Insert failed" },
    }); // insert fails

    const res = await POST(makeRequest("POST"), params);
    expect(res.status).toBe(500);
  });
});
