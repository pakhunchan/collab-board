import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  // Look up invite by token
  const { data: invite } = await supabase
    .from("board_invites")
    .select("board_id, expires_at")
    .eq("token", params.token)
    .single();

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  // Check expiration
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  // Check if already a member (idempotent)
  const { data: existing } = await supabase
    .from("board_members")
    .select("user_id")
    .eq("board_id", invite.board_id)
    .eq("user_id", decoded.uid)
    .single();

  if (!existing) {
    const displayName = decoded.name || decoded.email || null;
    const { error } = await supabase.from("board_members").insert({
      board_id: invite.board_id,
      user_id: decoded.uid,
      display_name: displayName,
      role: "editor",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fire-and-forget: notify SharePanel listeners about the new member
    broadcastBoardEvent(invite.board_id, "member:joined", {
      user_id: decoded.uid,
      display_name: displayName,
      role: "editor",
      joined_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ boardId: invite.board_id });
}
