import { Group, Ellipse } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";
import { SELECTION_COLOR } from "./shapeUtils";
import { useTransformEnd } from "./useTransformEnd";

interface CircleShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
}

export default function CircleShape({
  obj,
  isSelected,
  onSelect,
  onChange,
}: CircleShapeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const handleTransformEnd = useTransformEnd(groupRef, onChange, { minWidth: 30, minHeight: 30, keepSquare: true });

  return (
    <Group
      ref={groupRef}
      id={obj.id}
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={handleTransformEnd}
    >
      <Ellipse
        x={obj.width / 2}
        y={obj.height / 2}
        radiusX={obj.width / 2}
        radiusY={obj.height / 2}
        fill={obj.color}
        stroke={isSelected ? SELECTION_COLOR : "#666"}
        strokeWidth={isSelected ? 2 : 1}
      />
    </Group>
  );
}
