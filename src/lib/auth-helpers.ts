import { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "./firebase-admin";
import { getSupabaseServerClient } from "./supabase/server";

export async function verifyFirebaseToken(
  request: Request
): Promise<DecodedIdToken> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const token = header.slice(7);
  return adminAuth.verifyIdToken(token);
}

/**
 * Check that a user can access a board.
 * Public boards are open to any authenticated user.
 * Private boards require membership in board_members.
 * Throws with a message suitable for a 403 response if access is denied.
 */
export async function assertBoardAccess(
  uid: string,
  boardId: string
): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { data: board, error } = await supabase
    .from("boards")
    .select("visibility")
    .eq("id", boardId)
    .single();

  if (error || !board) {
    throw new Error("Board not found");
  }

  if (board.visibility === "public") return;

  const { data: member } = await supabase
    .from("board_members")
    .select("user_id")
    .eq("board_id", boardId)
    .eq("user_id", uid)
    .single();

  if (!member) {
    throw new Error("Access denied");
  }
}
