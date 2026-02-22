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
    .select("created_by, channel_nonce")
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

  // Rotate channel nonce: generate new UUID, update board
  const oldNonce = board.channel_nonce;
  const newNonce = crypto.randomUUID();

  await supabase
    .from("boards")
    .update({ channel_nonce: newNonce })
    .eq("id", params.id);

  // Fire-and-forget: tell the revoked user why they're being disconnected
  broadcastBoardEvent(params.id, "access:revoked", {
    userId: params.userId,
  }, oldNonce);

  // Fire-and-forget: broadcast channel:rotated on the OLD channel
  // so connected clients learn the new nonce (revoked user gets evicted)
  broadcastBoardEvent(params.id, "channel:rotated", {
    channelNonce: newNonce,
  }, oldNonce);

  return NextResponse.json({ ok: true });
}
