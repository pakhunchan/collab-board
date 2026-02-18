import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; inviteId: string } }
) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  // Only board owner can revoke invites
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

  const { error } = await supabase
    .from("board_invites")
    .delete()
    .eq("id", params.inviteId)
    .eq("board_id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
