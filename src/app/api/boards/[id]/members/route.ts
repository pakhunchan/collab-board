import { NextResponse } from "next/server";
import { verifyFirebaseToken, assertBoardAccess } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

  const { data: members, error } = await supabase
    .from("board_members")
    .select("user_id, display_name, role, joined_at")
    .eq("board_id", params.id)
    .order("joined_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(members);
}
