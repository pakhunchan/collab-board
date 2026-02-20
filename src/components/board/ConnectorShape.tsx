import { Arrow } from "react-konva";
import { BoardObject } from "@/types/board";
import { useBoardStore } from "@/stores/boardStore";
import { SELECTION_COLOR, getPortPosition, type Side } from "./shapeUtils";

interface ConnectorShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
  onReconnect?: (connectorId: string, fromId: string, fromPort: Side) => void;
}

function getOrthogonalPath(
  fromPort: { x: number; y: number },
  fromSide: Side,
  toPort: { x: number; y: number },
  toSide: Side,
  fromObj?: BoardObject,
  toObj?: BoardObject,
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
    let midX = (fx + tx) / 2;
    if (fromObj && toObj) {
      if (fromSide === toSide) {
        if (fromSide === "right") {
          midX = Math.max(fromObj.x + fromObj.width, toObj.x + toObj.width) + PAD;
        } else {
          midX = Math.min(fromObj.x, toObj.x) - PAD;
        }
      } else {
        const candidates = [
          (fx + tx) / 2,
          Math.min(fromObj.x, toObj.x) - PAD,
          Math.max(fromObj.x + fromObj.width, toObj.x + toObj.width) + PAD,
        ];
        let bestScore = Infinity;
        for (const c of candidates) {
          const s = scoreMidPath([fx, fy, c, fy, c, ty, tx, ty], fromObj, toObj);
          if (s < bestScore) { bestScore = s; midX = c; }
        }
      }
    }
    points.push(midX, fy);
    points.push(midX, ty);
  } else if (!fromH && !toH) {
    let midY = (fy + ty) / 2;
    if (fromObj && toObj) {
      if (fromSide === toSide) {
        if (fromSide === "bottom") {
          midY = Math.max(fromObj.y + fromObj.height, toObj.y + toObj.height) + PAD;
        } else {
          midY = Math.min(fromObj.y, toObj.y) - PAD;
        }
      } else {
        const candidates = [
          (fy + ty) / 2,
          Math.min(fromObj.y, toObj.y) - PAD,
          Math.max(fromObj.y + fromObj.height, toObj.y + toObj.height) + PAD,
        ];
        let bestScore = Infinity;
        for (const c of candidates) {
          const s = scoreMidPath([fx, fy, fx, c, tx, c, tx, ty], fromObj, toObj);
          if (s < bestScore) { bestScore = s; midY = c; }
        }
      }
    }
    points.push(fx, midY);
    points.push(tx, midY);
  } else if (fromH) {
    // L-bend: horizontal exit → vertical entry
    // Simple corner at (tx, fy) — check if it overlaps either object
    if (fromObj && toObj &&
        (segmentOverlapsObject(fx, fy, tx, fy, fromObj) || segmentOverlapsObject(fx, fy, tx, fy, toObj) ||
         segmentOverlapsObject(tx, fy, tx, ty, fromObj) || segmentOverlapsObject(tx, fy, tx, ty, toObj))) {
      // Convert to 3-segment route with best midY
      const candidates = [
        (fy + ty) / 2,
        Math.min(fromObj.y, toObj.y) - PAD,
        Math.max(fromObj.y + fromObj.height, toObj.y + toObj.height) + PAD,
      ];
      let bestMidY = candidates[0], bestScore = Infinity;
      for (const c of candidates) {
        const s = scoreMidPath([fx, fy, fx, c, tx, c, tx, ty], fromObj, toObj);
        if (s < bestScore) { bestScore = s; bestMidY = c; }
      }
      points.push(fx, bestMidY);
      points.push(tx, bestMidY);
    } else {
      points.push(tx, fy);
    }
  } else {
    // L-bend: vertical exit → horizontal entry
    // Simple corner at (fx, ty) — check if it overlaps either object
    if (fromObj && toObj &&
        (segmentOverlapsObject(fx, fy, fx, ty, fromObj) || segmentOverlapsObject(fx, fy, fx, ty, toObj) ||
         segmentOverlapsObject(fx, ty, tx, ty, fromObj) || segmentOverlapsObject(fx, ty, tx, ty, toObj))) {
      // Convert to 3-segment route with best midX
      const candidates = [
        (fx + tx) / 2,
        Math.min(fromObj.x, toObj.x) - PAD,
        Math.max(fromObj.x + fromObj.width, toObj.x + toObj.width) + PAD,
      ];
      let bestMidX = candidates[0], bestScore = Infinity;
      for (const c of candidates) {
        const s = scoreMidPath([fx, fy, c, fy, c, ty, tx, ty], fromObj, toObj);
        if (s < bestScore) { bestScore = s; bestMidX = c; }
      }
      points.push(bestMidX, fy);
      points.push(bestMidX, ty);
    } else {
      points.push(fx, ty);
    }
  }

  points.push(tx, ty);
  points.push(toPort.x, toPort.y);

  return points;
}

function segmentOverlapsObject(
  x1: number, y1: number, x2: number, y2: number, obj: BoardObject,
): boolean {
  if (y1 === y2) {
    // Horizontal segment
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    return y1 > obj.y && y1 < obj.y + obj.height && maxX > obj.x && minX < obj.x + obj.width;
  }
  if (x1 === x2) {
    // Vertical segment
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return x1 > obj.x && x1 < obj.x + obj.width && maxY > obj.y && minY < obj.y + obj.height;
  }
  return false;
}

function scoreMidPath(midPoints: number[], fromObj: BoardObject, toObj: BoardObject): number {
  let score = 0;
  for (let i = 2; i < midPoints.length; i += 2) {
    score += Math.abs(midPoints[i] - midPoints[i - 2]) + Math.abs(midPoints[i + 1] - midPoints[i - 1]);
  }
  for (let i = 0; i < midPoints.length - 2; i += 2) {
    if (segmentOverlapsObject(midPoints[i], midPoints[i + 1], midPoints[i + 2], midPoints[i + 3], fromObj)) score += 10000;
    if (segmentOverlapsObject(midPoints[i], midPoints[i + 1], midPoints[i + 2], midPoints[i + 3], toObj)) score += 10000;
  }
  return score;
}

function getBestPortPair(from: BoardObject, to: BoardObject): { fromSide: Side; toSide: Side } {
  const sides: Side[] = ["top", "right", "bottom", "left"];
  let best = { fromSide: "right" as Side, toSide: "left" as Side };
  let bestLen = Infinity;
  for (const fs of sides) {
    const fp = getPortPosition(from, fs);
    for (const ts of sides) {
      const tp = getPortPosition(to, ts);
      const path = getOrthogonalPath(fp, fs, tp, ts, from, to);
      let len = 0;
      for (let i = 2; i < path.length; i += 2) {
        len += Math.abs(path[i] - path[i - 2]) + Math.abs(path[i + 1] - path[i - 1]);
      }
      // Penalize paths whose segments cross through either object
      for (let i = 0; i < path.length - 2; i += 2) {
        if (segmentOverlapsObject(path[i], path[i + 1], path[i + 2], path[i + 3], from)) len += 10000;
        if (segmentOverlapsObject(path[i], path[i + 1], path[i + 2], path[i + 3], to)) len += 10000;
      }
      if (len < bestLen) { bestLen = len; best = { fromSide: fs, toSide: ts }; }
    }
  }
  return best;
}

function getBestSideFor(fixedSide: Side, fixedObj: BoardObject, otherObj: BoardObject, fixedIsFrom: boolean): Side {
  const sides: Side[] = ["top", "right", "bottom", "left"];
  let best: Side = "top";
  let bestLen = Infinity;
  for (const s of sides) {
    const [fp, fs, tp, ts, fo, too] = fixedIsFrom
      ? [getPortPosition(fixedObj, fixedSide), fixedSide, getPortPosition(otherObj, s), s, fixedObj, otherObj]
      : [getPortPosition(otherObj, s), s, getPortPosition(fixedObj, fixedSide), fixedSide, otherObj, fixedObj];
    const path = getOrthogonalPath(fp, fs, tp, ts, fo, too);
    let len = 0;
    for (let i = 2; i < path.length; i += 2) {
      len += Math.abs(path[i] - path[i - 2]) + Math.abs(path[i + 1] - path[i - 1]);
    }
    for (let i = 0; i < path.length - 2; i += 2) {
      if (segmentOverlapsObject(path[i], path[i + 1], path[i + 2], path[i + 3], fo)) len += 10000;
      if (segmentOverlapsObject(path[i], path[i + 1], path[i + 2], path[i + 3], too)) len += 10000;
    }
    if (len < bestLen) { bestLen = len; best = s; }
  }
  return best;
}

export default function ConnectorShape({
  obj,
  isSelected,
  onSelect,
  onReconnect,
}: ConnectorShapeProps) {
  const objects = useBoardStore((s) => s.objects);

  const fromId = obj.properties.fromId as string | undefined;
  const toId = obj.properties.toId as string | undefined;
  const toX = obj.properties.toX as number | undefined;
  const toY = obj.properties.toY as number | undefined;

  if (!fromId) return null;

  const fromObj = objects[fromId];
  if (!fromObj) return null;

  const color = isSelected ? SELECTION_COLOR : obj.color;

  // Dangling arrow: no toId, just toX/toY
  if (!toId && toX != null && toY != null) {
    const fromSide = (obj.properties.fromPort as Side) || "right";
    const fromPortPos = getPortPosition(fromObj, fromSide);
    return (
      <Arrow
        id={obj.id}
        points={[fromPortPos.x, fromPortPos.y, toX, toY]}
        stroke={color}
        strokeWidth={2}
        pointerLength={10}
        pointerWidth={8}
        fill={color}
        draggable={false}
        hitStrokeWidth={20}
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return;
          e.cancelBubble = true;
          const stage = e.target.getStage();
          if (!stage) return;
          const pointer = stage.getPointerPosition();
          if (!pointer) return;
          const transform = e.target.getAbsoluteTransform().copy().invert();
          const local = transform.point(pointer);
          const dist = Math.hypot(local.x - toX, local.y - toY);
          if (dist <= 20) {
            onReconnect?.(obj.id, fromId, fromSide);
          }
          // else: don't call onReconnect — onClick will fire and select
        }}
        onClick={onSelect}
        onTap={onSelect}
      />
    );
  }

  if (!toId) return null;

  const toObj = objects[toId];
  if (!toObj) return null;

  let fromSide: Side, toSide: Side;
  const storedFrom = obj.properties.fromPort as Side | undefined;
  const storedTo = obj.properties.toPort as Side | undefined;
  if (storedFrom && storedTo) {
    fromSide = storedFrom;
    toSide = storedTo;
  } else if (storedFrom) {
    fromSide = storedFrom;
    toSide = getBestSideFor(storedFrom, fromObj, toObj, true);
  } else if (storedTo) {
    toSide = storedTo;
    fromSide = getBestSideFor(storedTo, toObj, fromObj, false);
  } else {
    ({ fromSide, toSide } = getBestPortPair(fromObj, toObj));
  }

  const fromPort = getPortPosition(fromObj, fromSide);
  const toPort = getPortPosition(toObj, toSide);
  const points = getOrthogonalPath(fromPort, fromSide, toPort, toSide, fromObj, toObj);

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
