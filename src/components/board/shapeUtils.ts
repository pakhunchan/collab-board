import { BoardObject } from "@/types/board";

export const SELECTION_COLOR = "#1a73e8";

export type Side = "top" | "right" | "bottom" | "left";

export function rotatePoint(px: number, py: number, ox: number, oy: number, deg: number) {
  if (deg === 0) return { x: px, y: py };
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - ox;
  const dy = py - oy;
  return { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos };
}

export function getPortPosition(obj: BoardObject, side: Side) {
  let pos;
  switch (side) {
    case "top":    pos = { x: obj.x + obj.width / 2, y: obj.y }; break;
    case "right":  pos = { x: obj.x + obj.width, y: obj.y + obj.height / 2 }; break;
    case "bottom": pos = { x: obj.x + obj.width / 2, y: obj.y + obj.height }; break;
    case "left":   pos = { x: obj.x, y: obj.y + obj.height / 2 }; break;
  }
  return rotatePoint(pos.x, pos.y, obj.x, obj.y, obj.rotation);
}
