import { Rect } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";
import { SELECTION_COLOR } from "./shapeUtils";
import { useTransformEnd } from "./useTransformEnd";

interface RectShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
}

export default function RectShape({
  obj,
  isSelected,
  onSelect,
  onChange,
}: RectShapeProps) {
  const rectRef = useRef<Konva.Rect>(null);
  const handleTransformEnd = useTransformEnd(rectRef, onChange, { minWidth: 30, minHeight: 30 });

  return (
    <Rect
      ref={rectRef}
      id={obj.id}
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation}
      fill={obj.color}
      stroke={isSelected ? SELECTION_COLOR : "#666"}
      strokeWidth={isSelected ? 2 : 1}
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
