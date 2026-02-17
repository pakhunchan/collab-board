import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  rowToBoardObject,
  boardObjectToRow,
} from "@/lib/board-object-mapper";

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

  const { data, error } = await supabase
    .from("board_objects")
    .select("*")
    .eq("board_id", params.id)
    .order("z_index");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data.map(rowToBoardObject));
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const row = {
    ...boardObjectToRow(body),
    board_id: params.id,
    created_by: decoded.uid,
  };

  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("board_objects")
    .insert(row)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(rowToBoardObject(data), { status: 201 });
}
