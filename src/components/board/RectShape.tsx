import { Rect } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";

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
      stroke={isSelected ? "#1a73e8" : "#666"}
      strokeWidth={isSelected ? 2 : 1}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={() => {
        const node = rectRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          width: Math.max(30, node.width() * scaleX),
          height: Math.max(30, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
    />
  );
}
