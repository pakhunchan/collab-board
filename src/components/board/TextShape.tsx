import { Group, Rect, Text } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";
import { SELECTION_COLOR } from "./shapeUtils";
import { useTransformEnd } from "./useTransformEnd";

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
  const handleTransformEnd = useTransformEnd(groupRef, onChange, { minWidth: 30, minHeight: 20 });

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
      onTransformEnd={handleTransformEnd}
    >
      {isSelected && (
        <Rect
          width={obj.width}
          height={obj.height}
          stroke={SELECTION_COLOR}
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
