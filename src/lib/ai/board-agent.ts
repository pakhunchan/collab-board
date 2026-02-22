import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { traceable } from "langsmith/traceable";
import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { BoardObject, BoardObjectType } from "@/types/board";
import { buildBoardObject, DEFAULT_SIZES } from "@/lib/board-object-defaults";
import { boardObjectToRow, partialBoardObjectToRow, rowToBoardObject } from "@/lib/board-object-mapper";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createPersistentChannel, PersistentChannel } from "@/lib/supabase/broadcast";

const openai = wrapOpenAI(new OpenAI());

const SHAPE_TYPES: BoardObjectType[] = ["sticky", "rectangle", "circle", "text", "frame"];

function buildSystemPrompt(viewport?: { centerX: number; centerY: number; width: number; height: number }): string {
  const bounds = viewport
    ? {
        minX: Math.round(viewport.centerX - viewport.width / 2),
        maxX: Math.round(viewport.centerX + viewport.width / 2),
        minY: Math.round(viewport.centerY - viewport.height / 2),
        maxY: Math.round(viewport.centerY + viewport.height / 2),
      }
    : { minX: 100, maxX: 700, minY: 100, maxY: 500 };

  return `Quickly. Review the user's request and generate the tool calling instructions as a JSON response.

x and y are TOP-LEFT corner coordinates. Default sizes (width x height):
sticky: 200x200, rectangle: 240x160, circle: 160x160, text: 200x40, frame: 400x300

Place shapes within:
x-min: ${bounds.minX}
x-max: ${bounds.maxX}
y-min: ${bounds.minY}
y-max: ${bounds.maxY}

When placing multiple objects, ensure at least 20px gap between all edges. An object at (x, y) with size (w, h) occupies from (x, y) to (x+w, y+h). Two objects overlap if their rectangles intersect.
Arrange multiple shapes towards the center, in a grid, with spacing. Do NOT create objects that touch or overlap with other objects.`;
}

const SUMMARY_SYSTEM_PROMPT = "Briefly describe what you did on the whiteboard. One short sentence.";

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "apply_board_actions",
      description: "Apply actions to the board. Use ONE batch_create with ALL items in its array (not separate actions per item).",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["get", "batch_create", "batch_delete", "batch_update"], description: "Action type" },
                ids: { type: "array", items: { type: "string" }, description: "Object IDs (batch_delete)" },
                items: {
                  type: "array",
                  description: "batch_create: [{type, x, y, text?, color?, width?, height?}], batch_update: [{id, ...changes}]",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: SHAPE_TYPES, description: "Shape type (batch_create)" },
                      id: { type: "string", description: "Object ID (batch_update)" },
                      x: { type: "number", description: "X position (top-left corner)" },
                      y: { type: "number", description: "Y position (top-left corner)" },
                      text: { type: "string", description: "Text content" },
                      color: { type: "string", description: "Hex color" },
                      width: { type: "number", description: "Width" },
                      height: { type: "number", description: "Height" },
                    },
                    required: ["type", "x", "y"],
                  },
                },
              },
              required: ["action"],
            },
          },
        },
        required: ["actions"],
      },
    },
  },
];

// --- Tool execution functions (wrapped with traceable for LangSmith) ---

const executeGetBoardObjects = traceable(
  async (boardId: string) => {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("board_objects")
      .select("*")
      .eq("board_id", boardId)
      .order("z_index");

    if (error) throw new Error(`Failed to get board objects: ${error.message}`);

    return data.map((row) => ({
      id: row.id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      color: row.color,
      text: row.text,
    }));
  },
  { name: "get_board_objects", run_type: "tool" }
);

// --- Spacing enforcement to prevent overlapping objects ---

const MIN_GAP = 20;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function hasAnyOverlap(newObjects: Rect[], existingObjects: Rect[], gap: number): boolean {
  for (let i = 0; i < newObjects.length; i++) {
    for (let j = i + 1; j < newObjects.length; j++) {
      if (rectsOverlap(newObjects[i], newObjects[j], gap)) return true;
    }
    for (const ex of existingObjects) {
      if (rectsOverlap(newObjects[i], ex, gap)) return true;
    }
  }
  return false;
}

function computeMTV(a: Rect, b: Rect, gap: number): { dx: number; dy: number } {
  const overlapX = Math.min(a.x + a.width + gap, b.x + b.width + gap) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height + gap, b.y + b.height + gap) - Math.max(a.y, b.y);

  if (overlapX <= 0 || overlapY <= 0) return { dx: 0, dy: 0 };

  if (overlapX < overlapY) {
    const centerA = a.x + a.width / 2;
    const centerB = b.x + b.width / 2;
    return { dx: centerA < centerB ? -overlapX : overlapX, dy: 0 };
  } else {
    const centerA = a.y + a.height / 2;
    const centerB = b.y + b.height / 2;
    return { dx: 0, dy: centerA < centerB ? -overlapY : overlapY };
  }
}

function enforceSpacing(newObjects: BoardObject[], existingObjects: Rect[]): void {
  if (newObjects.length === 0) return;

  // Phase 1: Early exit if no overlaps
  const newRects: Rect[] = newObjects.map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height }));
  if (!hasAnyOverlap(newRects, existingObjects, MIN_GAP)) return;

  // Phase 2: Grid layout for new objects
  const n = newObjects.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  let maxW = 0;
  let maxH = 0;
  for (const obj of newObjects) {
    if (obj.width > maxW) maxW = obj.width;
    if (obj.height > maxH) maxH = obj.height;
  }

  const cellW = maxW + MIN_GAP;
  const cellH = maxH + MIN_GAP;

  // Centroid of LLM's intended positions
  let cx = 0;
  let cy = 0;
  for (const obj of newObjects) {
    cx += obj.x + obj.width / 2;
    cy += obj.y + obj.height / 2;
  }
  cx /= n;
  cy /= n;

  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const originX = cx - gridW / 2;
  const originY = cy - gridH / 2;

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const obj = newObjects[i];
    // Center each object within its cell
    obj.x = Math.round(originX + col * cellW + (cellW - obj.width) / 2);
    obj.y = Math.round(originY + row * cellH + (cellH - obj.height) / 2);
  }

  // Phase 3: Resolve overlaps with existing objects using MTV
  const placed: Rect[] = [...existingObjects];
  for (const obj of newObjects) {
    let maxAttempts = 20;
    while (maxAttempts-- > 0) {
      let worst: { dx: number; dy: number } | null = null;
      let worstMag = 0;
      for (const p of placed) {
        if (!rectsOverlap(obj, p, MIN_GAP)) continue;
        const mtv = computeMTV(obj, p, MIN_GAP);
        const mag = Math.abs(mtv.dx) + Math.abs(mtv.dy);
        if (mag > worstMag) {
          worst = mtv;
          worstMag = mag;
        }
      }
      if (!worst) break;
      obj.x = Math.round(obj.x + worst.dx);
      obj.y = Math.round(obj.y + worst.dy);
    }
    placed.push({ x: obj.x, y: obj.y, width: obj.width, height: obj.height });
  }
}

interface CreateAction {
  type: BoardObjectType;
  x: number;
  y: number;
  text?: string;
  color?: string;
  width?: number;
  height?: number;
}

const executeBatchCreate = traceable(
  async (
    actions: CreateAction[],
    boardId: string,
    userId: string,
    channel: PersistentChannel,
    existingObjects: Rect[]
  ): Promise<{ ids: string[]; objects: BoardObject[] }> => {
    const objects = actions.map((a) => {
      const size = DEFAULT_SIZES[a.type];
      const w = a.width ?? size.width;
      const h = a.height ?? size.height;
      return buildBoardObject(a.type, 0, 0, {
        boardId,
        createdBy: userId,
        x: a.x,
        y: a.y,
        width: w,
        height: h,
        ...(a.text != null ? { text: a.text } : {}),
        ...(a.color ? { color: a.color } : {}),
      });
    });

    enforceSpacing(objects, existingObjects);

    const rows = objects.map((obj) => ({
      ...boardObjectToRow(obj),
      board_id: boardId,
      created_by: userId,
    }));

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("board_objects")
      .insert(rows)
      .select();

    if (error) throw new Error(`Failed to batch create shapes: ${error.message}`);

    const created = data.map((row) => rowToBoardObject(row));
    for (const obj of created) {
      channel.send("object:create", { object: obj });
    }

    return { ids: created.map((o) => o.id), objects: created };
  },
  { name: "batch_create_shapes", run_type: "tool" }
);

const executeBatchDelete = traceable(
  async (
    ids: string[],
    boardId: string,
    channel: PersistentChannel
  ): Promise<void> => {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("board_objects")
      .delete()
      .eq("board_id", boardId)
      .in("id", ids);

    if (error) throw new Error(`Failed to batch delete objects: ${error.message}`);

    for (const id of ids) {
      channel.send("object:delete", { objectId: id });
    }
  },
  { name: "batch_delete_objects", run_type: "tool" }
);

const executeUpdateObject = traceable(
  async (
    args: { id: string; color?: string; x?: number; y?: number; text?: string; width?: number; height?: number },
    boardId: string,
    channel: PersistentChannel
  ) => {
    const { id, ...changes } = args;
    const row = partialBoardObjectToRow({
      ...changes,
      updatedAt: new Date().toISOString(),
    });

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("board_objects")
      .update(row)
      .eq("id", id)
      .eq("board_id", boardId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update object: ${error.message}`);

    const updated = rowToBoardObject(data);
    channel.send("object:update", { objectId: id, changes });
    return updated;
  },
  { name: "update_object", run_type: "tool" }
);

// --- Main agent entry point ---

const MAX_TURNS = 10;

export interface AgentResult {
  message: string;
  createdObjects: BoardObject[];
}

export const runBoardAgent = traceable(
  async function runBoardAgent(
    prompt: string,
    boardId: string,
    userId: string,
    viewport?: { centerX: number; centerY: number; width: number; height: number }
  ): Promise<AgentResult> {
  // Pre-fetch existing objects so the LLM can avoid overlapping placements
  const existingObjects = await executeGetBoardObjects(boardId);
  const boardSnapshot =
    existingObjects.length > 0
      ? `Current objects on the board:\n${JSON.stringify(existingObjects)}`
      : "The board is empty.";

  const systemContent = `${buildSystemPrompt(viewport)}\n\n${boardSnapshot}`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: prompt },
  ];

  const createdObjects: BoardObject[] = [];
  const channel = createPersistentChannel(boardId);

  try {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (turn > 0) {
      messages[0] = { role: "system", content: SUMMARY_SYSTEM_PROMPT };
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages,
      tools: turn === 0 ? tools : undefined,
      tool_choice: turn === 0 ? "required" : undefined,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    // If no tool calls, the LLM is done — return its text response
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return {
        message: assistantMessage.content ?? "Done.",
        createdObjects,
      };
    }

    // Process ALL tool calls — OpenAI requires a tool response for each tool_call_id
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;

      const args = JSON.parse(toolCall.function.arguments) as { actions: Array<Record<string, unknown>> };
      const actions = args.actions;

      const gets = actions.filter((a) => a.action === "get");
      const deleteIds = actions
        .filter((a) => a.action === "batch_delete")
        .flatMap((a) => a.ids as string[]);
      const createItems = actions
        .filter((a) => a.action === "batch_create")
        .flatMap((a) => a.items as CreateAction[]);
      const updateItems = actions
        .filter((a) => a.action === "batch_update")
        .flatMap((a) => a.items as Array<Record<string, unknown>>);

      const results: Array<{ action: string; ok?: boolean; id?: string; error?: string; data?: unknown }> = [];

      try {
        // Execute in order: get → delete → create → update
        if (gets.length > 0) {
          const data = await executeGetBoardObjects(boardId);
          results.push({ action: "get", ok: true, data });
        }

        if (deleteIds.length > 0) {
          await executeBatchDelete(deleteIds, boardId, channel);
          for (const id of deleteIds) {
            results.push({ action: "delete", ok: true, id });
          }
        }

        if (createItems.length > 0) {
          const { ids, objects } = await executeBatchCreate(createItems, boardId, userId, channel, existingObjects);
          createdObjects.push(...objects);
          for (const id of ids) {
            results.push({ action: "create", ok: true, id });
          }
        }

        if (updateItems.length > 0) {
          await Promise.all(
            updateItems.map(async (a) => {
              try {
                await executeUpdateObject(
                  a as unknown as { id: string; color?: string; x?: number; y?: number; text?: string; width?: number; height?: number },
                  boardId,
                  channel
                );
                results.push({ action: "update", ok: true, id: a.id as string });
              } catch (err) {
                results.push({ action: "update", id: a.id as string, error: err instanceof Error ? err.message : "Unknown error" });
              }
            })
          );
        }
      } catch (err) {
        results.push({ action: "error", error: err instanceof Error ? err.message : "Unknown error" });
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(results),
      });
    }
  }

  return {
    message: "Reached maximum number of turns. Some actions may not have completed.",
    createdObjects,
  };
  } finally {
    channel.close();
  }
  },
  { name: "run_board_agent", run_type: "chain" }
);
