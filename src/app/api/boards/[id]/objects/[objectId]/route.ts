import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { partialBoardObjectToRow } from "@/lib/board-object-mapper";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; objectId: string } }
) {
  try {
    await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const row = partialBoardObjectToRow(body);

  // Strip fields that shouldn't be updated via PATCH
  delete row.board_id;
  delete row.id;

  // Server-side timestamp
  row.updated_at = new Date().toISOString();

  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("board_objects")
    .update(row)
    .eq("id", params.objectId)
    .eq("board_id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; objectId: string } }
) {
  try {
    await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("board_objects")
    .delete()
    .eq("id", params.objectId)
    .eq("board_id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
