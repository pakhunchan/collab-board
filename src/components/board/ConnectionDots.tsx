import { Circle } from "react-konva";
import { BoardObject } from "@/types/board";
import { SELECTION_COLOR, rotatePoint, getPortPosition, type Side } from "./shapeUtils";

export type { Side };
export { getPortPosition };

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const OFFSET = 22;

export function getDotPosition(obj: BoardObject, side: Side) {
  let pos;
  switch (side) {
    case "top":    pos = { x: obj.x + obj.width / 2, y: obj.y - OFFSET }; break;
    case "right":  pos = { x: obj.x + obj.width + OFFSET, y: obj.y + obj.height / 2 }; break;
    case "bottom": pos = { x: obj.x + obj.width / 2, y: obj.y + obj.height + OFFSET }; break;
    case "left":   pos = { x: obj.x - OFFSET, y: obj.y + obj.height / 2 }; break;
  }
  return rotatePoint(pos.x, pos.y, obj.x, obj.y, obj.rotation);
}

interface ConnectionDotsProps {
  obj: BoardObject;
  scale: number;
  variant: "selected" | "target";
  highlightedPort?: Side | null;
  onDotMouseDown?: (port: Side) => void;
}

export default function ConnectionDots({
  obj,
  scale,
  variant,
  highlightedPort,
  onDotMouseDown,
}: ConnectionDotsProps) {
  const invScale = 1 / scale;

  return (
    <>
      {SIDES.map((side) => {
        const pos = getDotPosition(obj, side);
        const isHighlighted = variant === "target" && highlightedPort === side;

        if (variant === "selected") {
          return (
            <Circle
              key={side}
              x={pos.x}
              y={pos.y}
              radius={5 * invScale}
              fill={SELECTION_COLOR}
              stroke={SELECTION_COLOR}
              strokeWidth={1 * invScale}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                onDotMouseDown?.(side);
              }}
              onMouseEnter={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "crosshair";
              }}
              onMouseLeave={(e) => {
                const container = e.target.getStage()?.container();
                if (container) container.style.cursor = "";
              }}
            />
          );
        }

        // variant === "target"
        return (
          <Circle
            key={side}
            x={pos.x}
            y={pos.y}
            radius={(isHighlighted ? 8 : 6) * invScale}
            fill={isHighlighted ? SELECTION_COLOR : "white"}
            stroke={SELECTION_COLOR}
            strokeWidth={(isHighlighted ? 2 : 1.5) * invScale}
            listening={false}
          />
        );
      })}
    </>
  );
}
