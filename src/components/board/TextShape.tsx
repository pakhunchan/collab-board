import { Group, Rect, Text } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";

interface TextShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
  onDblClick: () => void;
}

export default function TextShape({
  obj,
  isSelected,
  onSelect,
  onChange,
  onDblClick,
}: TextShapeProps) {
  const groupRef = useRef<Konva.Group>(null);

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
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={() => {
        const node = groupRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          width: Math.max(30, node.width() * scaleX),
          height: Math.max(20, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
    >
      {isSelected && (
        <Rect
          width={obj.width}
          height={obj.height}
          stroke="#1a73e8"
          strokeWidth={1}
          dash={[4, 4]}
          fill="transparent"
        />
      )}
      <Text
        width={obj.width}
        text={obj.text || ""}
        fontSize={18}
        fontFamily="sans-serif"
        fill={obj.color}
        wrap="word"
      />
    </Group>
  );
}
