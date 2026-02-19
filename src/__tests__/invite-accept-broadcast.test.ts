import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { POST } from "@/app/api/invites/[token]/route";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

const BOARD_ID = "board-uuid-1";
const USER_UID = "owner-uid-123";
const USER_NAME = "Test Owner";
const INVITE_TOKEN = "valid-token-abc";

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
  vi.mocked(broadcastBoardEvent).mockClear();
});

describe("POST /api/invites/[token] — broadcast behavior", () => {
  // --- Success path: broadcast IS called ---

  it("broadcasts member:joined with correct payload after successful invite acceptance", async () => {
    // Chain 1: select invite
    mockSupabase.addChain({
      data: { board_id: BOARD_ID, expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    // Chain 2: check existing member — not found
    mockSupabase.addChain({ data: null, error: null });
    // Chain 3: insert member
    mockSupabase.addChain({ data: null, error: null });

    const res = await POST(makeRequest("POST"), {
      params: { token: INVITE_TOKEN },
    });

    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).toHaveBeenCalledTimes(1);
    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      BOARD_ID,
      "member:joined",
      expect.objectContaining({
        user_id: USER_UID,
        display_name: USER_NAME,
        role: "editor",
        joined_at: expect.any(String),
      })
    );
  });

  it("includes display_name from email when name is not available", async () => {
    setMockUser({ name: "", email: "user@example.com" });

    mockSupabase.addChain({
      data: { board_id: BOARD_ID, expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });
    mockSupabase.addChain({ data: null, error: null });

    await POST(makeRequest("POST"), { params: { token: INVITE_TOKEN } });

    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      BOARD_ID,
      "member:joined",
      expect.objectContaining({ display_name: "user@example.com" })
    );
  });

  // --- Idempotent path: broadcast is NOT called ---

  it("does NOT broadcast when user is already a member", async () => {
    // Chain 1: select invite
    mockSupabase.addChain({
      data: { board_id: BOARD_ID, expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    // Chain 2: check existing member — found
    mockSupabase.addChain({ data: { user_id: USER_UID }, error: null });

    const res = await POST(makeRequest("POST"), {
      params: { token: INVITE_TOKEN },
    });

    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  // --- Error paths: broadcast is NOT called ---

  it("does NOT broadcast when unauthenticated (401)", async () => {
    setAuthShouldReject(true);

    await POST(makeRequest("POST"), { params: { token: INVITE_TOKEN } });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when invite not found (404)", async () => {
    mockSupabase.addChain({ data: null, error: null });

    const res = await POST(makeRequest("POST"), {
      params: { token: INVITE_TOKEN },
    });

    expect(res.status).toBe(404);
    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when invite has expired (410)", async () => {
    mockSupabase.addChain({
      data: { board_id: BOARD_ID, expires_at: new Date(Date.now() - 60000).toISOString() },
      error: null,
    });

    const res = await POST(makeRequest("POST"), {
      params: { token: INVITE_TOKEN },
    });

    expect(res.status).toBe(410);
    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when DB insert fails (500)", async () => {
    mockSupabase.addChain({
      data: { board_id: BOARD_ID, expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });
    mockSupabase.addChain({ data: null, error: { message: "Insert failed" } });

    const res = await POST(makeRequest("POST"), {
      params: { token: INVITE_TOKEN },
    });

    expect(res.status).toBe(500);
    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  // --- Fire-and-forget behavior ---

  it("returns 200 without waiting for broadcast to complete", async () => {
    vi.mocked(broadcastBoardEvent).mockReturnValue(new Promise(() => {}));

    mockSupabase.addChain({
      data: { board_id: BOARD_ID, expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });
    mockSupabase.addChain({ data: null, error: null });

    const res = await POST(makeRequest("POST"), {
      params: { token: INVITE_TOKEN },
    });

    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).toHaveBeenCalled();
  });
});
