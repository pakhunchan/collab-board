import { Group, Rect, Text } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";

interface StickyNoteProps {
  obj: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
  onDblClick: () => void;
}

const PADDING = 12;
const CORNER_RADIUS = 4;

export default function StickyNote({
  obj,
  isSelected,
  isEditing,
  onSelect,
  onChange,
  onDblClick,
}: StickyNoteProps) {
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
          width: Math.max(50, node.width() * scaleX),
          height: Math.max(50, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
    >
      <Rect
        width={obj.width}
        height={obj.height}
        fill={obj.color}
        cornerRadius={CORNER_RADIUS}
        shadowColor="rgba(0,0,0,0.15)"
        shadowBlur={8}
        shadowOffsetY={2}
        stroke={isSelected ? "#1a73e8" : "transparent"}
        strokeWidth={isSelected ? 2 : 0}
      />
      <Text
        x={PADDING}
        y={PADDING}
        width={obj.width - PADDING * 2}
        height={obj.height - PADDING * 2}
        text={obj.text || ""}
        fontSize={16}
        fontFamily="sans-serif"
        fill="#333"
        wrap="word"
        listening={false}
        visible={!isEditing}
      />
    </Group>
  );
}
