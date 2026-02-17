import { BoardObject } from "@/types/board";

// Database row shape (snake_case)
interface BoardObjectRow {
  id: string;
  board_id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text: string | null;
  color: string;
  z_index: number;
  properties: Record<string, unknown>;
  created_by: string;
  updated_at: string;
  created_at: string;
}

/** Convert a full DB row to a BoardObject (camelCase). */
export function rowToBoardObject(row: BoardObjectRow): BoardObject {
  return {
    id: row.id,
    boardId: row.board_id,
    type: row.type as BoardObject["type"],
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    ...(row.text != null ? { text: row.text } : {}),
    color: row.color,
    zIndex: row.z_index,
    properties: row.properties,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/** Convert a full BoardObject to a DB row for INSERT. */
export function boardObjectToRow(
  obj: BoardObject
): Omit<BoardObjectRow, "created_at"> {
  return {
    id: obj.id,
    board_id: obj.boardId,
    type: obj.type,
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
    rotation: obj.rotation,
    text: obj.text ?? null,
    color: obj.color,
    z_index: obj.zIndex,
    properties: obj.properties,
    created_by: obj.createdBy,
    updated_at: obj.updatedAt,
  };
}

/** Convert a partial BoardObject to a partial DB row for PATCH. */
export function partialBoardObjectToRow(
  changes: Partial<BoardObject>
): Record<string, unknown> {
  const map: Record<string, string> = {
    boardId: "board_id",
    type: "type",
    x: "x",
    y: "y",
    width: "width",
    height: "height",
    rotation: "rotation",
    text: "text",
    color: "color",
    zIndex: "z_index",
    properties: "properties",
    createdBy: "created_by",
    updatedAt: "updated_at",
    createdAt: "created_at",
  };

  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    const col = map[key];
    if (col) {
      row[col] = key === "text" ? (value ?? null) : value;
    }
  }
  return row;
}
