import { describe, it, expect, beforeEach } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { DELETE } from "@/app/api/boards/[id]/route";

const BOARD_ID = "board-uuid-1";
const params = { params: { id: BOARD_ID } };

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
});

describe("DELETE /api/boards/[id] — board deletion", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when board does not exist", async () => {
    mockSupabase.addChain({ data: null, error: { message: "Not found" } });
    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-owner tries to delete", async () => {
    setMockUser({ uid: "not-the-owner" });
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    });
    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(403);
  });

  it("deletes successfully when owner requests deletion", async () => {
    mockSupabase.addChain({
      data: { created_by: "owner-uid-123" },
      error: null,
    }); // select
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
    }); // select
    mockSupabase.addChain({
      data: null,
      error: { message: "DB error" },
    }); // delete fails

    const res = await DELETE(makeRequest("DELETE"), params);
    expect(res.status).toBe(500);
  });
});
