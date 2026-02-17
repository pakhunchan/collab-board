"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Stage, Layer, Circle, Transformer } from "react-konva";
import Konva from "konva";
import { useBoardStore } from "@/stores/boardStore";
import { useCursors } from "@/hooks/useCursors";
import { useBoardSync } from "@/hooks/useBoardSync";
import StickyNote from "./StickyNote";
import RectShape from "./RectShape";
import Cursors from "./Cursors";

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

  const startX = -stagePos.x / scale;
  const startY = -stagePos.y / scale;
  const endX = startX + width / scale;
  const endY = startY + height / scale;

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
  const params = useParams();
  const boardId = params?.id as string | undefined;

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeld = useRef(false);
  const isDraggingObject = useRef(false);

  // Real-time cursors
  const { remoteCursors, handleCursorMove } = useCursors(boardId);

  // Real-time object sync
  const { broadcastCreate, broadcastUpdate, broadcastDelete, broadcastLiveMove } = useBoardSync(boardId);

  // Inline text editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [textareaPos, setTextareaPos] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTool = useBoardStore((s) => s.activeTool);
  const setActiveTool = useBoardStore((s) => s.setActiveTool);
  const objects = useBoardStore((s) => s.objects);
  const selectedIds = useBoardStore((s) => s.selectedIds);
  const setSelectedIds = useBoardStore((s) => s.setSelectedIds);
  const clearSelection = useBoardStore((s) => s.clearSelection);

  // Keep a stable ref to broadcastLiveMove so the native listener always calls the latest version
  const broadcastLiveMoveRef = useRef(broadcastLiveMove);
  broadcastLiveMoveRef.current = broadcastLiveMove;

  // Native Konva dragmove listener for live position sync
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handler = (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      if (node === stage) return;
      const id = node.id();
      if (id) {
        broadcastLiveMoveRef.current(id, node.x(), node.y());
      }
    };

    stage.on("dragmove", handler);
    return () => {
      stage.off("dragmove", handler);
    };
  }, []);

  // Resize observer
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

  // Keyboard: space for pan, delete for removing objects
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when editing text
      if (editingId) return;

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceHeld.current = true;
        setIsPanning(true);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if an input/textarea is focused
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const ids = useBoardStore.getState().selectedIds;
        ids.forEach((id) => broadcastDelete(id));
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
  }, [editingId, broadcastDelete]);

  // Attach transformer to selected nodes
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    const nodes = selectedIds
      .map((id) => stage.findOne("#" + id))
      .filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, objects]);

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

  // Click on stage: create objects or clear selection
  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Only handle left clicks
      if (e.evt.button !== 0) return;

      // If we just finished dragging an object, don't create/deselect
      if (isDraggingObject.current) {
        isDraggingObject.current = false;
        return;
      }

      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // Convert to world coordinates
      const worldX = (pointer.x - stagePos.x) / scale;
      const worldY = (pointer.y - stagePos.y) / scale;

      const tool = useBoardStore.getState().activeTool;

      if (tool === "sticky" || tool === "rectangle") {
        // Clicked on empty area → create object
        if (e.target === stage) {
          const obj = broadcastCreate(tool, worldX, worldY);
          setSelectedIds([obj.id]);
          setActiveTool("select");
        }
        return;
      }

      if (tool === "select") {
        // Clicked on empty canvas → deselect
        if (e.target === stage) {
          clearSelection();
        }
      }
    },
    [stagePos, scale, broadcastCreate, setSelectedIds, setActiveTool, clearSelection]
  );

  // Handle double-click on sticky note for inline text editing
  const handleStickyDblClick = useCallback(
    (objId: string) => {
      const obj = useBoardStore.getState().objects[objId];
      if (!obj) return;
      const stage = stageRef.current;
      if (!stage) return;

      // Calculate screen position of the object
      const screenX = obj.x * scale + stagePos.x;
      const screenY = obj.y * scale + stagePos.y;
      const screenW = obj.width * scale;
      const screenH = obj.height * scale;

      setEditingId(objId);
      setTextareaPos({ x: screenX, y: screenY, width: screenW, height: screenH });

      // Focus textarea after render
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [scale, stagePos]
  );

  const handleTextareaBlur = useCallback(() => {
    if (!editingId || !textareaRef.current) return;
    broadcastUpdate(editingId, { text: textareaRef.current.value });
    setEditingId(null);
  }, [editingId, broadcastUpdate]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        handleTextareaBlur();
      }
    },
    [handleTextareaBlur]
  );

  const sortedObjects = Object.values(objects).sort((a, b) => a.zIndex - b.zIndex);

  const handleMouseMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const worldX = (pointer.x - stagePos.x) / scale;
    const worldY = (pointer.y - stagePos.y) / scale;
    handleCursorMove(worldX, worldY);
  }, [stagePos, scale, handleCursorMove]);

  const cursorForTool = () => {
    if (isPanning) return "grab";
    if (activeTool === "sticky" || activeTool === "rectangle") return "crosshair";
    return "default";
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: cursorForTool(),
        background: "#f8f8f8",
        position: "relative",
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
        draggable={isPanning || activeTool === "pan"}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleStageClick}
        onMouseMove={handleMouseMove}
      >
        <Layer listening={false}>
          <DotGrid
            stagePos={stagePos}
            scale={scale}
            width={dimensions.width}
            height={dimensions.height}
          />
        </Layer>
        <Layer>
          {sortedObjects.map((obj) =>
            obj.type === "sticky" ? (
              <StickyNote
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={() => setSelectedIds([obj.id])}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
                onDblClick={() => handleStickyDblClick(obj.id)}
              />
            ) : (
              <RectShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={() => setSelectedIds([obj.id])}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
              />
            )
          )}
          <Transformer
            ref={transformerRef}
            rotateEnabled={true}
            boundBoxFunc={(_oldBox, newBox) => {
              if (newBox.width < 30 || newBox.height < 30) return _oldBox;
              return newBox;
            }}
          />
        </Layer>
        <Layer listening={false}>
          <Cursors remoteCursors={remoteCursors} scale={scale} />
        </Layer>
      </Stage>

      {/* Inline text editing overlay */}
      {editingId && (
        <textarea
          ref={textareaRef}
          defaultValue={objects[editingId]?.text || ""}
          onBlur={handleTextareaBlur}
          onKeyDown={handleTextareaKeyDown}
          style={{
            position: "absolute",
            top: textareaPos.y,
            left: textareaPos.x,
            width: textareaPos.width,
            height: textareaPos.height,
            padding: `${12 * scale}px`,
            fontSize: `${16 * scale}px`,
            fontFamily: "sans-serif",
            color: "#333",
            background: "transparent",
            border: "2px solid #1a73e8",
            borderRadius: `${4 * scale}px`,
            outline: "none",
            resize: "none",
            overflow: "hidden",
            zIndex: 10,
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
}
