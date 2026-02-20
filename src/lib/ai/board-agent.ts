import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { traceable } from "langsmith/traceable";
import { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { BoardObject, BoardObjectType } from "@/types/board";
import { buildBoardObject, DEFAULT_COLORS, DEFAULT_SIZES } from "@/lib/board-object-defaults";
import { boardObjectToRow, partialBoardObjectToRow, rowToBoardObject } from "@/lib/board-object-mapper";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

const openai = wrapOpenAI(new OpenAI());

const SHAPE_TYPES: BoardObjectType[] = ["sticky", "rectangle", "circle", "text", "frame"];

const SYSTEM_PROMPT = `You are an action-oriented assistant that manages objects on a collaborative whiteboard. Your job is to execute requests immediately using sensible defaults — NEVER ask clarifying questions. If the user doesn't specify a position, color, or size, use the defaults below.

Available shape types: ${SHAPE_TYPES.join(", ")}

Default sizes (width x height):
${SHAPE_TYPES.map((t) => `- ${t}: ${DEFAULT_SIZES[t].width}x${DEFAULT_SIZES[t].height}`).join("\n")}

Default colors:
${SHAPE_TYPES.map((t) => `- ${t}: ${DEFAULT_COLORS[t]}`).join("\n")}

The board coordinate system has (0, 0) at the top-left. X increases to the right, Y increases downward.
Start placing shapes around (400, 300) and offset from any existing objects so nothing overlaps.

When creating multiple shapes, arrange them in a visually pleasing layout (e.g., in a grid or row with spacing).

Always call tools immediately to perform actions. Never respond with a question instead of acting. After performing actions, provide a brief summary of what you did.`;

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

const executeCreateShape = traceable(
  async (
    args: { type: BoardObjectType; x: number; y: number; text?: string; color?: string; width?: number; height?: number },
    boardId: string,
    userId: string
  ): Promise<BoardObject> => {
    const obj = buildBoardObject(args.type, args.x, args.y, {
      boardId,
      createdBy: userId,
      ...(args.text != null ? { text: args.text } : {}),
      ...(args.color ? { color: args.color } : {}),
      ...(args.width ? { width: args.width } : {}),
      ...(args.height ? { height: args.height } : {}),
    });

    const supabase = getSupabaseServerClient();
    const row = boardObjectToRow(obj);
    const { data, error } = await supabase
      .from("board_objects")
      .insert({ ...row, board_id: boardId, created_by: userId })
      .select()
      .single();

    if (error) throw new Error(`Failed to create shape: ${error.message}`);

    const created = rowToBoardObject(data);
    await broadcastBoardEvent(boardId, "object:create", { object: created });
    return created;
  },
  { name: "create_shape", run_type: "tool" }
);

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

const executeUpdateObject = traceable(
  async (
    args: { id: string; color?: string; x?: number; y?: number; text?: string; width?: number; height?: number },
    boardId: string
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
    await broadcastBoardEvent(boardId, "object:update", { objectId: id, changes });
    return updated;
  },
  { name: "update_object", run_type: "tool" }
);

const executeDeleteObject = traceable(
  async (args: { id: string }, boardId: string) => {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("board_objects")
      .delete()
      .eq("id", args.id)
      .eq("board_id", boardId);

    if (error) throw new Error(`Failed to delete object: ${error.message}`);

    await broadcastBoardEvent(boardId, "object:delete", { objectId: args.id });
    return { deleted: args.id };
  },
  { name: "delete_object", run_type: "tool" }
);

// --- Main agent entry point ---

const MAX_TURNS = 10;

export interface AgentResult {
  message: string;
  createdObjects: BoardObject[];
}

export async function runBoardAgent(
  prompt: string,
  boardId: string,
  userId: string
): Promise<AgentResult> {
  // Pre-fetch existing objects so the LLM can avoid overlapping placements
  const existingObjects = await executeGetBoardObjects(boardId);
  const boardSnapshot =
    existingObjects.length > 0
      ? `Current objects on the board:\n${JSON.stringify(existingObjects)}`
      : "The board is empty.";

  const systemContent = `${SYSTEM_PROMPT}\n\n${boardSnapshot}\n\nWhen placing new shapes, choose positions that don't overlap with existing objects.`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    { role: "user", content: prompt },
  ];

  const createdObjects: BoardObject[] = [];

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

    // Execute tool calls in parallel, grouped by operation type for correct ordering
    const toolCalls = assistantMessage.tool_calls.filter((tc) => tc.type === "function");

    const executionOrder = ["get_board_objects", "delete_object", "create_shape", "update_object"];
    const grouped = new Map<string, typeof toolCalls>();
    for (const tc of toolCalls) {
      const name = tc.function.name;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name)!.push(tc);
    }

    const toolResults: ChatCompletionMessageParam[] = [];

    for (const opName of executionOrder) {
      const group = grouped.get(opName);
      if (!group) continue;

      const results = await Promise.all(
        group.map(async (toolCall) => {
          const args = JSON.parse(toolCall.function.arguments);
          let result: unknown;

          try {
            switch (opName) {
              case "create_shape": {
                const obj = await executeCreateShape(args, boardId, userId);
                createdObjects.push(obj);
                result = { success: true, id: obj.id, type: obj.type };
                break;
              }
              case "get_board_objects":
                result = await executeGetBoardObjects(boardId);
                break;
              case "update_object":
                result = await executeUpdateObject(args, boardId);
                result = { success: true, id: args.id };
                break;
              case "delete_object":
                result = await executeDeleteObject(args, boardId);
                result = { success: true, deleted: args.id };
                break;
              default:
                result = { error: `Unknown tool: ${opName}` };
            }
          } catch (err) {
            result = { error: err instanceof Error ? err.message : "Unknown error" };
          }

          return {
            role: "tool" as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
        })
      );

      toolResults.push(...results);
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
}
