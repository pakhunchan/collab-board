import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
