import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { traceable } from "langsmith/traceable";
import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { BoardObject, BoardObjectType } from "@/types/board";
import { buildBoardObject, DEFAULT_COLORS, DEFAULT_SIZES } from "@/lib/board-object-defaults";
import { boardObjectToRow, partialBoardObjectToRow, rowToBoardObject } from "@/lib/board-object-mapper";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createPersistentChannel, PersistentChannel } from "@/lib/supabase/broadcast";

const openai = wrapOpenAI(new OpenAI());

const SHAPE_TYPES: BoardObjectType[] = ["sticky", "rectangle", "circle", "text", "frame"];

function buildSystemPrompt(viewport?: { centerX: number; centerY: number; width: number; height: number }): string {
  const placementInstruction = viewport
    ? `The user is currently viewing the area centered at (${Math.round(viewport.centerX)}, ${Math.round(viewport.centerY)}) with visible size ${Math.round(viewport.width)}x${Math.round(viewport.height)}. Place new shapes within this visible area.`
    : `Start placing shapes around (400, 300) and offset from any existing objects so nothing overlaps.`;

  return `You are an action-oriented assistant that manages objects on a collaborative whiteboard. Your job is to execute requests immediately using sensible defaults — NEVER ask clarifying questions. If the user doesn't specify a position, color, or size, use the defaults below.

Available shape types: ${SHAPE_TYPES.join(", ")}

Default sizes (width x height):
${SHAPE_TYPES.map((t) => `- ${t}: ${DEFAULT_SIZES[t].width}x${DEFAULT_SIZES[t].height}`).join("\n")}

Default colors:
${SHAPE_TYPES.map((t) => `- ${t}: ${DEFAULT_COLORS[t]}`).join("\n")}

The board coordinate system has (0, 0) at the top-left. X increases to the right, Y increases downward.
${placementInstruction}

When creating multiple shapes, arrange them in a visually pleasing layout (e.g., in a grid or row with spacing).

Always call tools immediately to perform actions. Never respond with a question instead of acting. After performing actions, provide a brief summary of what you did.`;
}

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_shape",
      description: "Create a new shape on the board",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: SHAPE_TYPES,
            description: "The type of shape to create",
          },
          x: { type: "number", description: "X position (center of shape)" },
          y: { type: "number", description: "Y position (center of shape)" },
          text: { type: "string", description: "Text content (for sticky notes, text, and frames)" },
          color: { type: "string", description: "Color as hex string (e.g. #FF0000)" },
          width: { type: "number", description: "Width override (optional)" },
          height: { type: "number", description: "Height override (optional)" },
        },
        required: ["type", "x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_objects",
      description: "Get all objects currently on the board",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_object",
      description: "Update an existing object on the board",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The ID of the object to update" },
          color: { type: "string", description: "New color as hex string" },
          x: { type: "number", description: "New X position" },
          y: { type: "number", description: "New Y position" },
          text: { type: "string", description: "New text content" },
          width: { type: "number", description: "New width" },
          height: { type: "number", description: "New height" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_object",
      description: "Delete an object from the board",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The ID of the object to delete" },
        },
        required: ["id"],
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

interface ToolCallEntry {
  toolCallId: string;
  args: Record<string, unknown>;
}

const executeBatchCreate = traceable(
  async (
    items: ToolCallEntry[],
    boardId: string,
    userId: string,
    channel: PersistentChannel
  ): Promise<{ results: Array<{ toolCallId: string; content: string }>; objects: BoardObject[] }> => {
    const objects = items.map((item) => {
      const a = item.args as { type: BoardObjectType; x: number; y: number; text?: string; color?: string; width?: number; height?: number };
      return buildBoardObject(a.type, a.x, a.y, {
        boardId,
        createdBy: userId,
        ...(a.text != null ? { text: a.text } : {}),
        ...(a.color ? { color: a.color } : {}),
        ...(a.width ? { width: a.width } : {}),
        ...(a.height ? { height: a.height } : {}),
      });
    });

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

    return {
      results: items.map((item, i) => ({
        toolCallId: item.toolCallId,
        content: JSON.stringify({ ok: true, id: created[i].id }),
      })),
      objects: created,
    };
  },
  { name: "batch_create_shapes", run_type: "tool" }
);

const executeBatchDelete = traceable(
  async (
    items: ToolCallEntry[],
    boardId: string,
    channel: PersistentChannel
  ): Promise<Array<{ toolCallId: string; content: string }>> => {
    const ids = items.map((item) => item.args.id as string);

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

    return items.map((item) => ({
      toolCallId: item.toolCallId,
      content: JSON.stringify({ ok: true }),
    }));
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

  const systemContent = `${buildSystemPrompt(viewport)}\n\n${boardSnapshot}\n\nWhen placing new shapes, choose positions that don't overlap with existing objects.`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: prompt },
  ];

  const createdObjects: BoardObject[] = [];
  const channel = createPersistentChannel(boardId);

  try {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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

    // Group tool calls by operation type
    const toolCalls = assistantMessage.tool_calls.filter((tc) => tc.type === "function");

    const grouped = new Map<string, Array<{ toolCallId: string; args: Record<string, unknown> }>>();
    for (const tc of toolCalls) {
      const name = tc.function.name;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name)!.push({
        toolCallId: tc.id,
        args: JSON.parse(tc.function.arguments),
      });
    }

    const toolResults: ChatCompletionMessageParam[] = [];

    // Execute in order: reads → deletes → creates → updates
    const executionOrder = ["get_board_objects", "delete_object", "create_shape", "update_object"];

    for (const opName of executionOrder) {
      const group = grouped.get(opName);
      if (!group) continue;

      try {
        switch (opName) {
          case "get_board_objects": {
            // Execute reads in parallel (typically just one)
            const results = await Promise.all(
              group.map(async (entry) => {
                const result = await executeGetBoardObjects(boardId);
                return {
                  role: "tool" as const,
                  tool_call_id: entry.toolCallId,
                  content: JSON.stringify(result),
                };
              })
            );
            toolResults.push(...results);
            break;
          }

          case "delete_object": {
            const batchResults = await executeBatchDelete(group, boardId, channel);
            for (const r of batchResults) {
              toolResults.push({ role: "tool" as const, tool_call_id: r.toolCallId, content: r.content });
            }
            break;
          }

          case "create_shape": {
            const { results, objects } = await executeBatchCreate(group, boardId, userId, channel);
            createdObjects.push(...objects);
            for (const r of results) {
              toolResults.push({ role: "tool" as const, tool_call_id: r.toolCallId, content: r.content });
            }
            break;
          }

          case "update_object": {
            // Updates remain individual (different columns per row) but share the persistent channel
            const results = await Promise.all(
              group.map(async (entry) => {
                try {
                  await executeUpdateObject(
                    entry.args as { id: string; color?: string; x?: number; y?: number; text?: string; width?: number; height?: number },
                    boardId,
                    channel
                  );
                  return {
                    role: "tool" as const,
                    tool_call_id: entry.toolCallId,
                    content: JSON.stringify({ ok: true, id: entry.args.id }),
                  };
                } catch (err) {
                  return {
                    role: "tool" as const,
                    tool_call_id: entry.toolCallId,
                    content: JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
                  };
                }
              })
            );
            toolResults.push(...results);
            break;
          }
        }
      } catch (err) {
        // If a batch operation fails, report the error for all tool calls in that group
        const errorMsg = JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" });
        for (const entry of group) {
          toolResults.push({ role: "tool" as const, tool_call_id: entry.toolCallId, content: errorMsg });
        }
      }
    }

    // Handle any unknown tool types not in executionOrder
    for (const tc of toolCalls) {
      if (!executionOrder.includes(tc.function.name)) {
        toolResults.push({
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }),
        });
      }
    }

    messages.push(...toolResults);
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
