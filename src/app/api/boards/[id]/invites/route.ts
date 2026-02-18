import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/auth-helpers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const EXPIRY_OPTIONS: Record<string, number> = {
  "3h": 3 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
};

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

  const supabase = getSupabaseServerClient();

  // Only board owner can create invites
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

  const body = await request.json();
  const expiresIn = body.expiresIn as string;
  const durationMs = EXPIRY_OPTIONS[expiresIn];

  if (!durationMs) {
    return NextResponse.json(
      { error: "Invalid expiresIn. Use 3h, 1d, or 3d" },
      { status: 400 }
    );
  }

  const expiresAt = new Date(Date.now() + durationMs).toISOString();

  const { data: invite, error } = await supabase
    .from("board_invites")
    .insert({
      board_id: params.id,
      created_by: decoded.uid,
      expires_at: expiresAt,
    })
    .select("token, expires_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { token: invite.token, expiresAt: invite.expires_at },
    { status: 201 }
  );
}

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

  const supabase = getSupabaseServerClient();

  // Only board owner can list invites
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

  const { data: invites, error } = await supabase
    .from("board_invites")
    .select("id, token, expires_at, created_at")
    .eq("board_id", params.id)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(invites);
}
