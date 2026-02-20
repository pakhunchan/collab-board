import { Group, Rect, Text } from "react-konva";
import { BoardObject } from "@/types/board";
import Konva from "konva";
import { useRef } from "react";
import { SELECTION_COLOR, getTextDisplayProps } from "./shapeUtils";
import { useTransformEnd } from "./useTransformEnd";

interface StickyNoteProps {
  obj: BoardObject;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onChange: (changes: Partial<BoardObject>) => void;
  onDblClick: () => void;
}

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
  const handleTransformEnd = useTransformEnd(groupRef, onChange, { minWidth: 50, minHeight: 50 });

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
      <Rect
        width={obj.width}
        height={obj.height}
        fill={obj.color}
        cornerRadius={CORNER_RADIUS}
        shadowColor="rgba(0,0,0,0.15)"
        shadowBlur={8}
        shadowOffsetY={2}
        stroke={isSelected ? SELECTION_COLOR : "transparent"}
        strokeWidth={isSelected ? 2 : 0}
        hitStrokeWidth={12}
      />
      {(() => {
        const tp = getTextDisplayProps(obj, isEditing);
        return tp && <Text {...tp} />;
      })()}
    </Group>
  );
}
