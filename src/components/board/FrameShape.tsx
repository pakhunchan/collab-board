import { Group, Rect, Text } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";

interface FrameShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
  onDblClick: () => void;
}

const TITLE_HEIGHT = 24;
const TITLE_PADDING = 4;

export default function FrameShape({
  obj,
  isSelected,
  onSelect,
  onChange,
  onDblClick,
}: FrameShapeProps) {
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
          width: Math.max(100, node.width() * scaleX),
          height: Math.max(60, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
    >
      {/* Title text — positioned above the frame body */}
      <Text
        x={0}
        y={-TITLE_HEIGHT}
        width={obj.width}
        height={TITLE_HEIGHT}
        padding={TITLE_PADDING}
        text={obj.text || "Frame"}
        fontSize={14}
        fontFamily="sans-serif"
        fill="#666666"
      />
      {/* Frame body — white background with subtle border */}
      <Rect
        width={obj.width}
        height={obj.height}
        fill="#ffffff"
        stroke={isSelected ? "#1a73e8" : "#d0d0d0"}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
      />
    </Group>
  );
}
