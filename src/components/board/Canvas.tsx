"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Circle } from "react-konva";
import Konva from "konva";

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const DOT_SPACING = 40;
const DOT_RADIUS = 1.5;
const DOT_COLOR = "#d0d0d0";

function DotGrid({
  stagePos,
  scale,
  width,
  height,
}: {
  stagePos: { x: number; y: number };
  scale: number;
  width: number;
  height: number;
}) {
  const dots: { x: number; y: number }[] = [];

  const spacing = DOT_SPACING;

  // Calculate visible area in world coordinates
  const startX = -stagePos.x / scale;
  const startY = -stagePos.y / scale;
  const endX = startX + width / scale;
  const endY = startY + height / scale;

  // Snap to grid
  const gridStartX = Math.floor(startX / spacing) * spacing;
  const gridStartY = Math.floor(startY / spacing) * spacing;

  for (let x = gridStartX; x <= endX; x += spacing) {
    for (let y = gridStartY; y <= endY; y += spacing) {
      dots.push({ x, y });
    }
  }

  return (
    <>
      {dots.map((dot, i) => (
        <Circle
          key={i}
          x={dot.x}
          y={dot.y}
          radius={DOT_RADIUS / scale}
          fill={DOT_COLOR}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </>
  );
}

export default function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeld = useRef(false);

  useEffect(() => {
    const updateSize = () => {
      const container = stageRef.current?.container()?.parentElement;
      if (container) {
        setDimensions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceHeld.current = true;
        setIsPanning(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const oldScale = scale;
      const scaleBy = 1.08;
      const direction = e.evt.deltaY < 0 ? 1 : -1;
      let newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
      newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

      const mousePointTo = {
        x: (pointer.x - stagePos.x) / oldScale,
        y: (pointer.y - stagePos.y) / oldScale,
      };

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      setScale(newScale);
      setStagePos(newPos);
    },
    [scale, stagePos]
  );

  const handleDragEnd = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStagePos({ x: stage.x(), y: stage.y() });
  }, []);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle mouse button
      if (e.evt.button === 1) {
        setIsPanning(true);
      }
    },
    []
  );

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1 && !spaceHeld.current) {
        setIsPanning(false);
      }
    },
    []
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: isPanning ? "grab" : "default",
        background: "#f8f8f8",
      }}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={scale}
        scaleY={scale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={isPanning}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <Layer listening={false}>
          <DotGrid
            stagePos={stagePos}
            scale={scale}
            width={dimensions.width}
            height={dimensions.height}
          />
        </Layer>
        <Layer>{/* Content layer — shapes, sticky notes, etc. */}</Layer>
      </Stage>
    </div>
  );
}
