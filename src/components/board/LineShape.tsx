import { Line } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";
import { useTransformEnd } from "./useTransformEnd";

interface LineShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
}

export default function LineShape({
  obj,
  onSelect,
  onChange,
}: LineShapeProps) {
  const lineRef = useRef<Konva.Line>(null);
  const handleTransformEnd = useTransformEnd(lineRef, onChange);

  return (
    <Line
      ref={lineRef}
      id={obj.id}
      x={obj.x}
      y={obj.y}
      points={[0, 0, obj.width, obj.height]}
      stroke={obj.color}
      strokeWidth={3}
      hitStrokeWidth={20}
      rotation={obj.rotation}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={handleTransformEnd}
    />
  );
}
