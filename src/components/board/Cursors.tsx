"use client";

import { Group, Path, Rect, Text } from "react-konva";
import { CursorPosition } from "@/hooks/useCursors";

// Classic pointer arrow SVG path (16x16 viewbox)
const CURSOR_PATH =
  "M0,0 L0,14 L4,10 L7.5,16 L9.5,15 L6,9 L11,9 Z";

interface CursorsProps {
  remoteCursors: Map<string, CursorPosition>;
  scale: number;
}

export default function Cursors({ remoteCursors, scale }: CursorsProps) {
  const inv = 1 / scale;

  return (
    <>
      {Array.from(remoteCursors.values()).map((cursor) => (
        <Group
          key={cursor.uid}
          x={cursor.x}
          y={cursor.y}
          scaleX={inv}
          scaleY={inv}
          listening={false}
        >
          {/* Pointer arrow */}
          <Path
            data={CURSOR_PATH}
            fill={cursor.color}
            stroke="#ffffff"
            strokeWidth={1}
            listening={false}
          />
          {/* Name label pill */}
          <Group x={12} y={16} listening={false}>
            <Rect
              width={Math.max(cursor.name.length * 7 + 12, 40)}
              height={20}
              fill={cursor.color}
              cornerRadius={4}
              listening={false}
            />
            <Text
              text={cursor.name}
              fontSize={11}
              fontFamily="sans-serif"
              fill="#ffffff"
              x={6}
              y={4}
              listening={false}
            />
          </Group>
        </Group>
      ))}
    </>
  );
}
