import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const uid = decoded.uid;

  // Get board IDs and roles the user is a member of
  const { data: memberships, error: memberError } = await supabase
    .from("board_members")
    .select("board_id, role")
    .eq("user_id", uid);

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const memberBoardIds = (memberships || []).map((m) => m.board_id);
  const roleMap = new Map(
    (memberships || []).map((m) => [m.board_id, m.role])
  );

  // Fetch boards: ones the user is a member of OR public ones
  let query = supabase.from("boards").select("*");

  if (memberBoardIds.length > 0) {
    query = query.or(
      `visibility.eq.public,id.in.(${memberBoardIds.join(",")})`
    );
  } else {
    query = query.eq("visibility", "public");
  }

  const { data: boards, error: boardsError } = await query.order("created_at", { ascending: false });

  if (boardsError) {
    return NextResponse.json({ error: boardsError.message }, { status: 500 });
  }

  const results = (boards || []).map((b) => ({
    ...b,
    role: roleMap.get(b.id) || null,
  }));

  return NextResponse.json(results);
}

export async function POST(request: Request) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = body.name || "Untitled Board";
  const visibility =
    body.visibility === "private" ? "private" : "public";
  const supabase = getSupabaseServerClient();

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .insert({ name, visibility, created_by: decoded.uid })
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
