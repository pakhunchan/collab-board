import { describe, it, expect, beforeEach } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { DELETE } from "@/app/api/boards/[id]/members/[userId]/route";

const BOARD_ID = "board-uuid-1";
const OWNER_UID = "owner-uid-123";
const EDITOR_UID = "editor-uid-456";

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
});

describe("DELETE /api/boards/[id]/members/[userId]", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when board not found", async () => {
    mockSupabase.addChain({ data: null, error: null });
    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not the owner", async () => {
    setMockUser({ uid: "non-owner" });
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when trying to remove the owner", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: OWNER_UID },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cannot remove the board owner");
  });

  it("successfully removes a member", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null }); // delete

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 on delete error", async () => {
    mockSupabase.addChain({
      data: { created_by: OWNER_UID },
      error: null,
    });
    mockSupabase.addChain({
      data: null,
      error: { message: "Delete failed" },
    });

    const res = await DELETE(makeRequest("DELETE"), {
      params: { id: BOARD_ID, userId: EDITOR_UID },
    });
    expect(res.status).toBe(500);
  });
});
