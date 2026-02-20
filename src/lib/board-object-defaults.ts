import { BoardObject, BoardObjectType } from "@/types/board";

export const DEFAULT_COLORS: Record<BoardObjectType, string> = {
  sticky: "#FFEB3B",
  rectangle: "#90CAF9",
  circle: "#CE93D8",
  line: "#666666",
  text: "#333333",
  connector: "#666666",
  frame: "#4A90D9",
};

export const DEFAULT_SIZES: Record<BoardObjectType, { width: number; height: number }> = {
  sticky: { width: 200, height: 200 },
  rectangle: { width: 240, height: 160 },
  circle: { width: 160, height: 160 },
  line: { width: 200, height: 0 },
  text: { width: 200, height: 40 },
  connector: { width: 0, height: 0 },
  frame: { width: 400, height: 300 },
};

export function buildBoardObject(
  type: BoardObjectType,
  x: number,
  y: number,
  overrides?: Partial<BoardObject>
): BoardObject {
  const size = DEFAULT_SIZES[type];
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    boardId: "",
    type,
    x: x - size.width / 2,
    y: y - size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
    ...(type === "text" ? { text: "" } : type === "frame" ? { text: "Frame" } : {}),
    color: DEFAULT_COLORS[type],
    zIndex: 0,
    properties: {},
    createdBy: "",
    updatedAt: now,
    createdAt: now,
    ...overrides,
  };
}
