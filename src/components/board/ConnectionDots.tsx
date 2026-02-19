import { Circle } from "react-konva";
import { BoardObject } from "@/types/board";

export type Side = "top" | "right" | "bottom" | "left";

const SIDES: Side[] = ["top", "right", "bottom", "left"];
const OFFSET = 12;

export function getPortPosition(obj: BoardObject, side: Side) {
  switch (side) {
    case "top":    return { x: obj.x + obj.width / 2, y: obj.y };
    case "right":  return { x: obj.x + obj.width, y: obj.y + obj.height / 2 };
    case "bottom": return { x: obj.x + obj.width / 2, y: obj.y + obj.height };
    case "left":   return { x: obj.x, y: obj.y + obj.height / 2 };
  }
}

function getDotPosition(obj: BoardObject, side: Side) {
  switch (side) {
    case "top":    return { x: obj.x + obj.width / 2, y: obj.y - OFFSET };
    case "right":  return { x: obj.x + obj.width + OFFSET, y: obj.y + obj.height / 2 };
    case "bottom": return { x: obj.x + obj.width / 2, y: obj.y + obj.height + OFFSET };
    case "left":   return { x: obj.x - OFFSET, y: obj.y + obj.height / 2 };
  }
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
              fill="#1a73e8"
              stroke="#1a73e8"
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
            fill={isHighlighted ? "#1a73e8" : "white"}
            stroke="#1a73e8"
            strokeWidth={(isHighlighted ? 2 : 1.5) * invScale}
            listening={false}
          />
        );
      })}
    </>
  );
}
