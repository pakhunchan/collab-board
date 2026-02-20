import { NextResponse } from "next/server";
import { verifyFirebaseToken, assertBoardAccess } from "@/lib/auth-helpers";
import { runBoardAgent } from "@/lib/ai/board-agent";

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

  try {
    await assertBoardAccess(decoded.uid, params.id);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const prompt = body.prompt;

  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  try {
    const viewport = body.viewport;
    const result = await runBoardAgent(prompt, params.id, decoded.uid, viewport);
    return NextResponse.json(result);
  } catch (err) {
    console.error("AI agent error:", err);
    return NextResponse.json(
      { error: "AI agent failed" },
      { status: 500 }
    );
  }
}
