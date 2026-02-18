import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { DELETE } from "@/app/api/boards/[id]/route";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

const BOARD_ID = "board-uuid-1";
const OWNER_UID = "owner-uid-123";

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
  vi.mocked(broadcastBoardEvent).mockClear();
});

describe("DELETE /api/boards/[id] — broadcast behavior", () => {
  // --- Success path: broadcast IS called ---

  it("broadcasts board:deleted with empty payload on successful deletion", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    }); // select
    mockSupabase.addChain({ data: null, error: null }); // delete

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).toHaveBeenCalledTimes(1);
    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      BOARD_ID,
      "board:deleted",
      {}
    );
  });

  it("broadcasts with the correct boardId for different boards", async () => {
    const otherBoard = "board-uuid-other";
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });

    await DELETE(makeRequest("DELETE"), {
      params: { id: otherBoard },
    });

    expect(broadcastBoardEvent).toHaveBeenCalledWith(
      otherBoard,
      "board:deleted",
      {}
    );
  });

  it("broadcasts BEFORE the DB delete (so channel still exists)", async () => {
    const callOrder: string[] = [];

    vi.mocked(broadcastBoardEvent).mockImplementation(async () => {
      callOrder.push("broadcast");
    });

    // Track when the delete chain is consumed
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    }); // select

    // For the delete chain, we use the standard mock but track ordering
    // via the from() call sequence — broadcast should be called before
    // the second from() call
    const originalFrom = mockSupabase.client.from;
    let fromCallCount = 0;
    mockSupabase.client.from = vi.fn((...args) => {
      fromCallCount++;
      if (fromCallCount === 2) {
        callOrder.push("db-delete");
      }
      return originalFrom(...args);
    }) as typeof originalFrom;

    mockSupabase.addChain({ data: null, error: null }); // delete

    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    expect(callOrder).toEqual(["broadcast", "db-delete"]);

    // Restore
    mockSupabase.client.from = originalFrom;
  });

  // --- Failure paths: broadcast is NOT called ---

  it("does NOT broadcast when unauthenticated (401)", async () => {
    setAuthShouldReject(true);
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when board not found (404)", async () => {
    mockSupabase.addChain({
      data: null,
      error: { message: "Not found" },
    });
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when non-owner tries to delete (403)", async () => {
    setMockUser({ uid: "not-the-owner" });
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    expect(broadcastBoardEvent).not.toHaveBeenCalled();
  });

  // --- Fire-and-forget behavior ---

  it("returns 200 without waiting for broadcast to complete", async () => {
    vi.mocked(broadcastBoardEvent).mockReturnValue(new Promise(() => {}));

    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null });

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    expect(res.status).toBe(200);
    expect(broadcastBoardEvent).toHaveBeenCalled();
  });

  // --- DB delete failure after broadcast ---

  it("still returns 500 if DB delete fails (broadcast already fired)", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    }); // select
    mockSupabase.addChain({
      data: null,
      error: { message: "DB error" },
    }); // delete fails

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID },
    });

    // Broadcast was called (it fires before delete)
    expect(broadcastBoardEvent).toHaveBeenCalledTimes(1);
    // But the response is still 500
    expect(res.status).toBe(500);
  });
});
