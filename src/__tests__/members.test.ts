import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockSupabase,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { GET } from "@/app/api/boards/[id]/members/route";
import { assertBoardAccess } from "@/lib/auth-helpers";

const BOARD_ID = "board-uuid-1";
const params = { params: { id: BOARD_ID } };

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
  vi.mocked(assertBoardAccess).mockResolvedValue(undefined);
});

describe("GET /api/boards/[id]/members", () => {
  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user has no board access", async () => {
    vi.mocked(assertBoardAccess).mockRejectedValue(
      new Error("Access denied")
    );
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(403);
  });

  it("returns member list", async () => {
    const membersList = [
      {
        user_id: "owner-uid-123",
        display_name: "Owner",
        role: "owner",
        joined_at: "2026-02-17T00:00:00Z",
      },
      {
        user_id: "editor-uid-456",
        display_name: "Editor",
        role: "editor",
        joined_at: "2026-02-17T01:00:00Z",
      },
    ];
    mockSupabase.addChain({ data: membersList, error: null });

    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].role).toBe("owner");
    expect(body[1].role).toBe("editor");
  });

  it("returns 500 on query error", async () => {
    mockSupabase.addChain({ data: null, error: { message: "DB error" } });
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(500);
  });
});
