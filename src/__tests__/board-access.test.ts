import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockSupabase,
  setMockUser,
  setAuthShouldReject,
  resetMockUser,
  makeRequest,
} from "./setup";
import { GET } from "@/app/api/boards/[id]/route";
import { assertBoardAccess } from "@/lib/auth-helpers";

const BOARD_ID = "board-uuid-1";
const params = { params: { id: BOARD_ID } };

beforeEach(() => {
  mockSupabase.reset();
  resetMockUser();
  vi.mocked(assertBoardAccess).mockResolvedValue(undefined);
});

describe("GET /api/boards/[id] — board access gate", () => {
  // --- Authentication ---

  it("returns 401 when unauthenticated", async () => {
    setAuthShouldReject(true);
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  // --- Authorization (private board, non-member) ---

  it("returns 403 when user has no access to the board", async () => {
    vi.mocked(assertBoardAccess).mockRejectedValue(
      new Error("Access denied")
    );
    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  // --- Authorization (private board, member) ---

  it("returns 200 with board data for authorized member", async () => {
    const boardData = {
      id: BOARD_ID,
      name: "My Private Board",
      visibility: "private",
      created_by: "owner-uid-123",
    };
    mockSupabase.addChain({ data: boardData, error: null });

    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(BOARD_ID);
    expect(body.name).toBe("My Private Board");
  });

  // --- Authorization (public board, any user) ---

  it("returns 200 for any authenticated user on a public board", async () => {
    setMockUser({ uid: "random-user-456" });
    const boardData = {
      id: BOARD_ID,
      name: "Public Board",
      visibility: "public",
      created_by: "owner-uid-123",
    };
    mockSupabase.addChain({ data: boardData, error: null });

    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.visibility).toBe("public");
  });

  // --- Board not found ---

  it("returns 404 when the board does not exist", async () => {
    mockSupabase.addChain({ data: null, error: { message: "Not found" } });

    const res = await GET(makeRequest("GET"), params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Board not found");
  });

  // --- assertBoardAccess is called with correct args ---

  it("calls assertBoardAccess with the user uid and board id", async () => {
    mockSupabase.addChain({ data: { id: BOARD_ID }, error: null });

    await GET(makeRequest("GET"), params);
    expect(assertBoardAccess).toHaveBeenCalledWith("owner-uid-123", BOARD_ID);
  });

  it("calls assertBoardAccess with a different user's uid", async () => {
    setMockUser({ uid: "another-user-789" });
    mockSupabase.addChain({ data: { id: BOARD_ID }, error: null });

    await GET(makeRequest("GET"), params);
    expect(assertBoardAccess).toHaveBeenCalledWith(
      "another-user-789",
      BOARD_ID
    );
  });
});
