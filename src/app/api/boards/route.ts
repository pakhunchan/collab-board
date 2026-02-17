import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = body.name || "Untitled Board";
  const supabase = getSupabaseServerClient();

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .insert({ name, created_by: decoded.uid })
    .select()
    .single();

  if (boardError) {
    return NextResponse.json({ error: boardError.message }, { status: 500 });
  }

  const { error: memberError } = await supabase.from("board_members").insert({
    board_id: board.id,
    user_id: decoded.uid,
    display_name: decoded.name || decoded.email || null,
    role: "owner",
  });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json(board, { status: 201 });
}
