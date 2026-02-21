import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { traceable } from "langsmith/traceable";
import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { BoardObject, BoardObjectType } from "@/types/board";
import { buildBoardObject } from "@/lib/board-object-defaults";
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

  return `You manage objects on a collaborative whiteboard. Execute requests immediately using tool defaults — never ask clarifying questions.

Place shapes within:
x-min: ${bounds.minX}
x-max: ${bounds.maxX}
y-min: ${bounds.minY}
y-max: ${bounds.maxY}

Arrange multiple shapes towards the center, in a grid, with spacing. Avoid overlapping existing objects.`;
}

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "apply_board_actions",
      description: "Apply one or more actions to the board. Batch multiple actions into a single call.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["create", "update", "delete", "get"], description: "Action type" },
                type: { type: "string", enum: SHAPE_TYPES, description: "Shape type (create only)" },
                id: { type: "string", description: "Object ID (update/delete only)" },
                x: { type: "number", description: "X position" },
                y: { type: "number", description: "Y position" },
                text: { type: "string", description: "Text content" },
                color: { type: "string", description: "Hex color", default: "type-dependent: sticky=#FFEB3B, rectangle=#90CAF9, circle=#CE93D8, text=#333333, frame=#4A90D9" },
                width: { type: "number", description: "Width", default: "type-dependent: sticky=200, rectangle=240, circle=160, text=200, frame=400" },
                height: { type: "number", description: "Height", default: "type-dependent: sticky=200, rectangle=160, circle=160, text=40, frame=300" },
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
    channel: PersistentChannel
  ): Promise<{ ids: string[]; objects: BoardObject[] }> => {
    const objects = actions.map((a) =>
      buildBoardObject(a.type, a.x, a.y, {
        boardId,
        createdBy: userId,
        ...(a.text != null ? { text: a.text } : {}),
        ...(a.color ? { color: a.color } : {}),
        ...(a.width ? { width: a.width } : {}),
        ...(a.height ? { height: a.height } : {}),
      })
    );

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
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
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

    const toolCall = assistantMessage.tool_calls.find((tc) => tc.type === "function");
    if (!toolCall) continue;
    const args = JSON.parse(toolCall.function.arguments) as { actions: Array<Record<string, unknown>> };
    const actions = args.actions;

    // Group actions by type
    const gets = actions.filter((a) => a.action === "get");
    const deletes = actions.filter((a) => a.action === "delete");
    const creates = actions.filter((a) => a.action === "create");
    const updates = actions.filter((a) => a.action === "update");

    const results: Array<{ action: string; ok?: boolean; id?: string; error?: string; data?: unknown }> = [];

    try {
      // Execute in order: get → delete → create → update
      if (gets.length > 0) {
        const data = await executeGetBoardObjects(boardId);
        results.push({ action: "get", ok: true, data });
      }

      if (deletes.length > 0) {
        const ids = deletes.map((a) => a.id as string);
        await executeBatchDelete(ids, boardId, channel);
        for (const id of ids) {
          results.push({ action: "delete", ok: true, id });
        }
      }

      if (creates.length > 0) {
        const createActions = creates.map((a) => ({
          type: a.type as BoardObjectType,
          x: a.x as number,
          y: a.y as number,
          text: a.text as string | undefined,
          color: a.color as string | undefined,
          width: a.width as number | undefined,
          height: a.height as number | undefined,
        }));
        const { ids, objects } = await executeBatchCreate(createActions, boardId, userId, channel);
        createdObjects.push(...objects);
        for (const id of ids) {
          results.push({ action: "create", ok: true, id });
        }
      }

      if (updates.length > 0) {
        await Promise.all(
          updates.map(async (a) => {
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
