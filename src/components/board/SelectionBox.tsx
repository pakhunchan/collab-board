import { Rect } from "react-konva";
import { SELECTION_COLOR } from "./shapeUtils";

interface SelectionBoxProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export default function SelectionBox({ startX, startY, endX, endY }: SelectionBoxProps) {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="rgba(26, 115, 232, 0.08)"
      stroke={SELECTION_COLOR}
      strokeWidth={1}
      dash={[6, 4]}
      listening={false}
    />
  );
}
