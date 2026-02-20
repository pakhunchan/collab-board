import { BoardObject } from "@/types/board";

export const SELECTION_COLOR = "#1a73e8";

export const PLACEHOLDER_TEXT: Record<string, string> = {
  text: "Type something...",
  sticky: "Type something...",
};

const TEXT_STYLE: Record<string, { fontSize: number; padding: number }> = {
  text: { fontSize: 18, padding: 0 },
  sticky: { fontSize: 16, padding: 12 },
};

export function isTextEditable(type: string): boolean {
  return type in TEXT_STYLE;
}

export function getTextDisplayProps(obj: BoardObject, isEditing: boolean) {
  const style = TEXT_STYLE[obj.type];
  if (!style) return null;
  const { display, isPlaceholder } = getTextWithPlaceholder(obj.type, obj.text);
  const p = style.padding;
  return {
    x: p,
    y: p,
    width: obj.width - p * 2,
    ...(p > 0 ? { height: obj.height - p * 2 } : {}),
    text: display,
    fontSize: style.fontSize,
    fontFamily: "sans-serif",
    fill: obj.type === "text" ? (obj.color || "#333") : "#333",
    opacity: isPlaceholder ? 0.3 : 1,
    wrap: "word" as const,
    listening: false,
    visible: !isEditing,
  };
}

export function getTextEditStyle(
  type: string,
  scale: number,
  color?: string,
): { padding: string; fontSize: string; color: string } {
  const style = TEXT_STYLE[type];
  const s = style ?? { fontSize: 16, padding: 0 };
  return {
    padding: `${s.padding * scale}px`,
    fontSize: `${s.fontSize * scale}px`,
    color: type === "text" ? (color || "#333") : "#333",
  };
}

export function getTextWithPlaceholder(type: string, text: string | undefined) {
  const display = text || PLACEHOLDER_TEXT[type] || "";
  const isPlaceholder = !text && !!PLACEHOLDER_TEXT[type];
  return { display, isPlaceholder };
}

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
