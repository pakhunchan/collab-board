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

const TITLE_BAR_HEIGHT = 32;
const TITLE_PADDING = 10;

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
      {/* Frame body */}
      <Rect
        width={obj.width}
        height={obj.height}
        fill="rgba(74, 144, 217, 0.08)"
        stroke={isSelected ? "#1a73e8" : obj.color}
        strokeWidth={2}
        dash={isSelected ? undefined : [8, 4]}
      />
      {/* Title bar */}
      <Rect
        width={obj.width}
        height={TITLE_BAR_HEIGHT}
        fill={obj.color}
        cornerRadius={[0, 0, 0, 0]}
      />
      {/* Title text */}
      <Text
        x={TITLE_PADDING}
        y={0}
        width={obj.width - TITLE_PADDING * 2}
        height={TITLE_BAR_HEIGHT}
        text={obj.text || "Frame"}
        fontSize={14}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill="#ffffff"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  );
}
