import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("boards").select("id").limit(1);

    if (error) throw error;

    return NextResponse.json({ status: "ok", supabase: "connected" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 }
    );
  }
}
