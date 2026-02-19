import { Arrow } from "react-konva";
import { BoardObject } from "@/types/board";
import { useBoardStore } from "@/stores/boardStore";

interface ConnectorShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
}

type Side = "top" | "right" | "bottom" | "left";

function getBestSide(from: BoardObject, to: BoardObject): Side {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "bottom" : "top";
}

function getPortPosition(obj: BoardObject, side: Side) {
  switch (side) {
    case "top":    return { x: obj.x + obj.width / 2, y: obj.y };
    case "right":  return { x: obj.x + obj.width, y: obj.y + obj.height / 2 };
    case "bottom": return { x: obj.x + obj.width / 2, y: obj.y + obj.height };
    case "left":   return { x: obj.x, y: obj.y + obj.height / 2 };
  }
}

function getOrthogonalPath(
  fromPort: { x: number; y: number },
  fromSide: Side,
  toPort: { x: number; y: number },
  toSide: Side,
): number[] {
  const PAD = 20;
  const points: number[] = [fromPort.x, fromPort.y];

  let fx = fromPort.x;
  let fy = fromPort.y;
  if (fromSide === "right") fx += PAD;
  else if (fromSide === "left") fx -= PAD;
  else if (fromSide === "bottom") fy += PAD;
  else fy -= PAD;
  points.push(fx, fy);

  let tx = toPort.x;
  let ty = toPort.y;
  if (toSide === "right") tx += PAD;
  else if (toSide === "left") tx -= PAD;
  else if (toSide === "bottom") ty += PAD;
  else ty -= PAD;

  const fromH = fromSide === "left" || fromSide === "right";
  const toH = toSide === "left" || toSide === "right";

  if (fromH && toH) {
    const midX = (fx + tx) / 2;
    points.push(midX, fy);
    points.push(midX, ty);
  } else if (!fromH && !toH) {
    const midY = (fy + ty) / 2;
    points.push(fx, midY);
    points.push(tx, midY);
  } else if (fromH) {
    points.push(tx, fy);
  } else {
    points.push(fx, ty);
  }

  points.push(tx, ty);
  points.push(toPort.x, toPort.y);

  return points;
}

export default function ConnectorShape({
  obj,
  isSelected,
  onSelect,
}: ConnectorShapeProps) {
  const objects = useBoardStore((s) => s.objects);

  const fromId = obj.properties.fromId as string | undefined;
  const toId = obj.properties.toId as string | undefined;

  if (!fromId || !toId) return null;

  const fromObj = objects[fromId];
  const toObj = objects[toId];

  if (!fromObj || !toObj) return null;

  const fromSide = getBestSide(fromObj, toObj);
  const toSide = getBestSide(toObj, fromObj);

  const fromPort = getPortPosition(fromObj, fromSide);
  const toPort = getPortPosition(toObj, toSide);

  const points = getOrthogonalPath(fromPort, fromSide, toPort, toSide);
  const color = isSelected ? "#1a73e8" : obj.color;

  return (
    <Arrow
      id={obj.id}
      points={points}
      stroke={color}
      strokeWidth={2}
      pointerLength={10}
      pointerWidth={8}
      fill={color}
      draggable={false}
      hitStrokeWidth={20}
      onClick={onSelect}
      onTap={onSelect}
    />
  );
}
