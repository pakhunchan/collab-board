import { describe, it, expect, beforeEach } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { DELETE } from "@/app/api/boards/[id]/invites/[inviteId]/route";

const BOARD_ID = "board-uuid-1";
const INVITE_ID = "invite-uuid-1";
const params = { params: { id: BOARD_ID, inviteId: INVITE_ID } };

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
});

describe("DELETE /api/boards/[id]/invites/[inviteId]", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when board not found", async () => {
    mockSupabase.addChain({ data: null, error: null });
    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not the owner", async () => {
    setMockUser({ uid: "other-user" });
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(403);
  });

  it("successfully revokes an invite", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    mockSupabase.addChain({ data: null, error: null }); // delete

    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 500 on delete error", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    mockSupabase.addChain({
      data: null,
      error: { message: "Delete failed" },
    });

    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(500);
  });
});
