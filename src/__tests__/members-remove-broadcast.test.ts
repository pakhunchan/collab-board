import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { DELETE } from "@/app/api/boards/[id]/members/[userId]/route";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

const BOARD_ID = "board-uuid-1";
const OWNER_UID = "owner-uid-123";
const EDITOR_UID = "editor-uid-456";

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
  vi.mocked(broadcastBoardEvent).mockClear();
});

describe("DELETE /api/boards/[id]/members/[userId] — broadcast behavior", () => {
  // --- Success path: broadcast IS called ---

  it("broadcasts access:revoked with the removed user's ID on success", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    }); // select board
    mockSupabase.addChain({ data: null, error: null }); // delete member

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });

    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).toHaveBeenCalledTimes(1);
    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      BOARD_ID,
      "access:revoked",
      { userId: EDITOR_UID }
    );
  });

  it("broadcasts with the correct userId when removing different users", async () => {
    const otherUser = "viewer-uid-789";
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });

    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: otherUser },
    });

    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      BOARD_ID,
      "access:revoked",
      { userId: otherUser }
    );
  });

  it("broadcasts with the correct boardId", async () => {
    const differentBoard = "board-uuid-99";
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });

    await DELETE(makeRequest("DELETE"), {
      params: { id: differentBoard, userId: EDITOR_UID },
    });

    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      differentBoard,
      "access:revoked",
      { userId: EDITOR_UID }
    );
  });

  // --- Failure paths: broadcast is NOT called ---

  it("does NOT broadcast when unauthenticated (401)", async () => {
    setAuthShouldReject(true);
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when board not found (404)", async () => {
    mockSupabase.addChain({ data: null, error: null });
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when user is not the owner (403)", async () => {
    setMockUser({ uid: "non-owner" });
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when trying to remove the owner (400)", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: OWNER_UID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when DB delete fails (500)", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({
      data: null,
      error: { message: "Delete failed" },
    });

    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  // --- Fire-and-forget behavior ---

  it("returns 200 without waiting for broadcast to complete", async () => {
    // Make broadcastBoardEvent return a never-resolving promise
    vi.mocked(broadcastBoardEvent).mockReturnValue(new Promise(() => {}));

    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });

    // Should still return 200 even though broadcast never resolves
    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).toHaveBeenCalled();
  });
});
