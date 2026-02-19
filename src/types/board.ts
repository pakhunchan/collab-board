export interface Board {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export type BoardObjectType = "sticky" | "rectangle" | "circle" | "line" | "text" | "connector";

export interface BoardObject {
  id: string;
  boardId: string;
  type: BoardObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text?: string;
  color: string;
  zIndex: number;
  properties: Record<string, unknown>;
  createdBy: string;
  updatedAt: string;
  createdAt: string;
}
