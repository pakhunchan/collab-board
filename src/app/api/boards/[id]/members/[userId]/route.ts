import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; userId: string } }
) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  // Only board owner can remove members
  const { data: board } = await supabase
    .from("boards")
    .select("created_by")
    .eq("id", params.id)
    .single();

  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  if (board.created_by !== decoded.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Cannot remove the owner
  if (params.userId === board.created_by) {
    return NextResponse.json(
      { error: "Cannot remove the board owner" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("board_members")
    .delete()
    .eq("board_id", params.id)
    .eq("user_id", params.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fire-and-forget: notify the removed user's client immediately
  broadcastBoardEvent(params.id, "access:revoked", { userId: params.userId });

  return NextResponse.json({ ok: true });
}
