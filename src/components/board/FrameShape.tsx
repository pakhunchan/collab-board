import { Group, Rect, Text } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";
import { SELECTION_COLOR } from "./shapeUtils";
import { useTransformEnd } from "./useTransformEnd";

interface FrameShapeProps {
  obj: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
  onDblClick: () => void;
}

const TITLE_HEIGHT = 24;
const TITLE_PADDING = 4;

export default function FrameShape({
  obj,
  isSelected,
  isEditing,
  onSelect,
  onChange,
  onDblClick,
}: FrameShapeProps) {
  const groupRef = useRef<Konva.Group>(null);
  const handleTransformEnd = useTransformEnd(groupRef, onChange, { minWidth: 100, minHeight: 60 });

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
        visible={!isEditing}
      />
      {/* Frame body — white background with subtle border */}
      <Rect
        width={obj.width}
        height={obj.height}
        fill="#ffffff"
        stroke={isSelected ? SELECTION_COLOR : "#d0d0d0"}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
      />
    </Group>
  );
}
