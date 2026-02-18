import { NextResponse } from "next/server";
import { verifyFirebaseToken, assertBoardAccess } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertBoardAccess(decoded.uid, params.id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();

  const { data: board, error } = await supabase
    .from("boards")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json(board);
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  // Only the board creator can delete it
  const { data: board, error: fetchError } = await supabase
    .from("boards")
    .select("created_by")
    .eq("id", params.id)
    .single();

  if (fetchError || !board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  if (board.created_by !== decoded.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Broadcast before deleting so channel still exists for connected users
  broadcastBoardEvent(params.id, "board:deleted", {});

  const { error } = await supabase
    .from("boards")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
