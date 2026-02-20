import { RefObject } from "react";
import { useCallback } from "react";
import Konva from "konva";
import { BoardObject } from "@/types/board";

interface TransformConfig {
  minWidth?: number;
  minHeight?: number;
  keepSquare?: boolean;
}

export function useTransformEnd(
  ref: RefObject<Konva.Node | null>,
  onChange: (changes: Partial<BoardObject>) => void,
  config: TransformConfig = {},
) {
  const { minWidth = 0, minHeight = 0, keepSquare = false } = config;

  return useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);

    let newWidth = Math.max(minWidth, node.width() * scaleX);
    let newHeight = Math.max(minHeight, node.height() * scaleY);

    if (keepSquare) {
      const size = Math.max(newWidth, newHeight);
      newWidth = size;
      newHeight = size;
    }

    onChange({
      x: node.x(),
      y: node.y(),
      width: newWidth,
      height: newHeight,
      rotation: node.rotation(),
    });
  }, [ref, onChange, minWidth, minHeight, keepSquare]);
}
