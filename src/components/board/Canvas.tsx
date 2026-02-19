"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Circle, Arrow, Line as KonvaLine, Rect as KonvaRect, Ellipse, Transformer } from "react-konva";
import Konva from "konva";
import { useBoardStore } from "@/stores/boardStore";
import { useCursors } from "@/hooks/useCursors";
import { useBoardSync } from "@/hooks/useBoardSync";
import StickyNote from "./StickyNote";
import RectShape from "./RectShape";
import CircleShape from "./CircleShape";
import LineShape from "./LineShape";
import TextShape from "./TextShape";
import ConnectorShape from "./ConnectorShape";
import Cursors from "./Cursors";

const SHAPE_TOOLS = ["sticky", "rectangle", "circle", "text"] as const;
type ShapeTool = (typeof SHAPE_TOOLS)[number];

const SHAPE_PREVIEW_COLORS: Record<ShapeTool, string> = {
  sticky: "#FFEB3B",
  rectangle: "#90CAF9",
  circle: "#CE93D8",
  text: "#333333",
};

function isShapeTool(tool: string): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly string[]).includes(tool);
}

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

interface CanvasProps {
  boardId: string;
  reconnectKey?: number;
  onChannelStatus?: (channelId: string, status: string) => void;
  onAccessRevoked?: () => void;
  onMemberJoined?: (member: { user_id: string; display_name: string | null; role: string; joined_at: string }) => void;
}

export default function Canvas({
  boardId,
  reconnectKey = 0,
  onChannelStatus,
  onAccessRevoked,
  onMemberJoined,
}: CanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const spaceHeld = useRef(false);
  const isDraggingObject = useRef(false);
  const [drawingLine, setDrawingLine] = useState<{ startX: number; startY: number } | null>(null);
  const [drawingLineEnd, setDrawingLineEnd] = useState<{ x: number; y: number } | null>(null);
  const [drawingShape, setDrawingShape] = useState<{ tool: ShapeTool; startX: number; startY: number } | null>(null);
  const [drawingShapeEnd, setDrawingShapeEnd] = useState<{ x: number; y: number } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectorPreview, setConnectorPreview] = useState<{ x: number; y: number } | null>(null);

  // Real-time cursors
  const { remoteCursors, handleCursorMove } = useCursors(boardId, reconnectKey, onChannelStatus);

  // Real-time object sync
  const { broadcastCreate, broadcastUpdate, broadcastDelete, broadcastLiveMove, broadcastDrawPreview, remoteDrawPreviews, broadcastConnectorPreview, remoteConnectorPreviews, broadcastShapePreview, remoteShapePreviews } = useBoardSync(boardId, reconnectKey, onChannelStatus, onAccessRevoked, onMemberJoined);

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

  const hasCircle = selectedIds.some((id) => objects[id]?.type === "circle");

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
        const changes = { x: node.x(), y: node.y() };
        useBoardStore.getState().applyRemoteUpdate(id, changes);
        broadcastLiveMoveRef.current(id, changes);
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
      if (e.key === "Escape") {
        setConnectingFrom(null);
        setConnectorPreview(null);
        broadcastConnectorPreview(null);
        setDrawingShape(null);
        setDrawingShapeEnd(null);
        broadcastShapePreview(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if an input/textarea is focused
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const ids = useBoardStore.getState().selectedIds;
        const connectorIds = new Set<string>();
        for (const id of ids) {
          for (const cid of useBoardStore.getState().getConnectorsForObject(id)) {
            connectorIds.add(cid);
          }
        }
        [...ids, ...Array.from(connectorIds)].forEach((id) => broadcastDelete(id));
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
  }, [editingId, broadcastDelete, broadcastConnectorPreview, broadcastShapePreview]);

  // Attach transformer to selected nodes
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    const nodes = selectedIds
      .filter((id) => objects[id]?.type !== "connector")
      .map((id) => stage.findOne("#" + id))
      .filter(Boolean) as Konva.Node[];

    // Enable aspect ratio lock if any selected object is a circle
    const hasCircle = selectedIds.some((id) => objects[id]?.type === "circle");
    tr.keepRatio(hasCircle);
    tr.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);

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

      // Line tool: start drawing on left click on empty canvas
      if (e.evt.button === 0) {
        const tool = useBoardStore.getState().activeTool;
        if (tool === "line") {
          const stage = stageRef.current;
          if (!stage) return;
          const target = e.target;
          if (target !== stage) return;
          const pointer = stage.getPointerPosition();
          if (!pointer) return;
          const worldX = (pointer.x - stagePos.x) / scale;
          const worldY = (pointer.y - stagePos.y) / scale;
          setDrawingLine({ startX: worldX, startY: worldY });
        }
        if (isShapeTool(tool)) {
          const stage = stageRef.current;
          if (!stage) return;
          const target = e.target;
          if (target !== stage) return;
          const pointer = stage.getPointerPosition();
          if (!pointer) return;
          const worldX = (pointer.x - stagePos.x) / scale;
          const worldY = (pointer.y - stagePos.y) / scale;
          setDrawingShape({ tool, startX: worldX, startY: worldY });
        }
      }
    },
    [stagePos, scale]
  );

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1 && !spaceHeld.current) {
        setIsPanning(false);
      }

      // Line tool: finish drawing
      if (e.evt.button === 0 && drawingLine) {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const worldX = (pointer.x - stagePos.x) / scale;
        const worldY = (pointer.y - stagePos.y) / scale;
        let dx = worldX - drawingLine.startX;
        let dy = worldY - drawingLine.startY;
        // If drag was tiny, create a default horizontal line
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          dx = 200;
          dy = 0;
        }
        const obj = broadcastCreate("line", drawingLine.startX, drawingLine.startY);
        broadcastUpdate(obj.id, {
          x: drawingLine.startX,
          y: drawingLine.startY,
          width: dx,
          height: dy,
        });
        setSelectedIds([obj.id]);
        setActiveTool("select");
        setDrawingLine(null);
        setDrawingLineEnd(null);
        broadcastDrawPreview(null);
      }

      // Shape tool: finish drawing
      if (e.evt.button === 0 && drawingShape) {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const worldX = (pointer.x - stagePos.x) / scale;
        const worldY = (pointer.y - stagePos.y) / scale;
        const dx = Math.abs(worldX - drawingShape.startX);
        const dy = Math.abs(worldY - drawingShape.startY);

        let obj;
        if (dx < 10 && dy < 10) {
          // Tiny drag — create default-sized shape at click point
          obj = broadcastCreate(drawingShape.tool, drawingShape.startX, drawingShape.startY);
        } else {
          // Real drag — compute bounding box
          const bx = Math.min(drawingShape.startX, worldX);
          const by = Math.min(drawingShape.startY, worldY);
          let bw = Math.abs(worldX - drawingShape.startX);
          let bh = Math.abs(worldY - drawingShape.startY);
          if (drawingShape.tool === "circle") {
            const size = Math.max(bw, bh);
            bw = size;
            bh = size;
          }
          const cx = bx + bw / 2;
          const cy = by + bh / 2;
          obj = broadcastCreate(drawingShape.tool, cx, cy);
          broadcastUpdate(obj.id, { x: bx, y: by, width: bw, height: bh });
        }

        isDraggingObject.current = true;
        setSelectedIds([obj.id]);
        setActiveTool("select");
        setDrawingShape(null);
        setDrawingShapeEnd(null);
        broadcastShapePreview(null);
      }
    },
    [drawingLine, drawingShape, stagePos, scale, broadcastCreate, broadcastUpdate, broadcastDrawPreview, broadcastShapePreview, setSelectedIds, setActiveTool]
  );

  // Handle object click when connector tool is active
  const handleConnectorClick = useCallback(
    (objId: string): boolean => {
      if (useBoardStore.getState().activeTool !== "connector") return false;
      const obj = useBoardStore.getState().objects[objId];
      if (!obj || obj.type === "connector") return false;

      if (connectingFrom === null) {
        setConnectingFrom(objId);
        return true;
      }
      if (connectingFrom === objId) return true;

      const c = broadcastCreate("connector", 0, 0);
      broadcastUpdate(c.id, { properties: { fromId: connectingFrom, toId: objId } });
      setConnectingFrom(null);
      setConnectorPreview(null);
      broadcastConnectorPreview(null);
      setActiveTool("select");
      return true;
    },
    [connectingFrom, broadcastCreate, broadcastUpdate, broadcastConnectorPreview, setActiveTool]
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

      const tool = useBoardStore.getState().activeTool;

      if (tool === "connector") {
        // Click on empty canvas cancels connector creation
        if (e.target === stage) {
          setConnectingFrom(null);
          setConnectorPreview(null);
          broadcastConnectorPreview(null);
        }
        return;
      }

      if (isShapeTool(tool)) {
        // Shape creation is handled in handleMouseUp
        return;
      }

      if (tool === "select") {
        // Clicked on empty canvas → deselect
        if (e.target === stage) {
          clearSelection();
        }
      }
    },
    [broadcastConnectorPreview, clearSelection]
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
    if (drawingLine) {
      setDrawingLineEnd({ x: worldX, y: worldY });
      broadcastDrawPreview({ startX: drawingLine.startX, startY: drawingLine.startY, endX: worldX, endY: worldY });
    }
    if (drawingShape) {
      setDrawingShapeEnd({ x: worldX, y: worldY });
      broadcastShapePreview({ tool: drawingShape.tool, startX: drawingShape.startX, startY: drawingShape.startY, endX: worldX, endY: worldY });
    }
    if (connectingFrom) {
      setConnectorPreview({ x: worldX, y: worldY });
      broadcastConnectorPreview({ fromId: connectingFrom, toX: worldX, toY: worldY });
    }
  }, [stagePos, scale, handleCursorMove, drawingLine, broadcastDrawPreview, drawingShape, connectingFrom, broadcastConnectorPreview, broadcastShapePreview]);

  const cursorForTool = () => {
    if (isPanning) return "grab";
    if (activeTool === "sticky" || activeTool === "rectangle" || activeTool === "circle" || activeTool === "line" || activeTool === "text" || activeTool === "connector") return "crosshair";
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
          {sortedObjects.map((obj) => {
            const onSelect = () => {
              if (!handleConnectorClick(obj.id)) setSelectedIds([obj.id]);
            };
            return obj.type === "sticky" ? (
              <StickyNote
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={onSelect}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
                onDblClick={() => handleStickyDblClick(obj.id)}
              />
            ) : obj.type === "connector" ? (
              <ConnectorShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={() => setSelectedIds([obj.id])}
              />
            ) : obj.type === "circle" ? (
              <CircleShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={onSelect}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
              />
            ) : obj.type === "line" ? (
              <LineShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={onSelect}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
              />
            ) : obj.type === "text" ? (
              <TextShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={onSelect}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
                onDblClick={() => handleStickyDblClick(obj.id)}
              />
            ) : (
              <RectShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                onSelect={onSelect}
                onChange={(changes) => broadcastUpdate(obj.id, changes)}
              />
            );
          })}
          {/* Preview line while drawing (local) */}
          {drawingLine && drawingLineEnd && (
            <KonvaLine
              points={[drawingLine.startX, drawingLine.startY, drawingLineEnd.x, drawingLineEnd.y]}
              stroke="#666666"
              strokeWidth={2}
              listening={false}
            />
          )}
          {/* Preview shape while drawing */}
          {drawingShape && drawingShapeEnd && (() => {
            const bx = Math.min(drawingShape.startX, drawingShapeEnd.x);
            const by = Math.min(drawingShape.startY, drawingShapeEnd.y);
            const bw = Math.abs(drawingShapeEnd.x - drawingShape.startX);
            const bh = Math.abs(drawingShapeEnd.y - drawingShape.startY);
            const color = SHAPE_PREVIEW_COLORS[drawingShape.tool];
            if (drawingShape.tool === "circle") {
              const size = Math.max(bw, bh);
              return (
                <Ellipse
                  x={bx + size / 2}
                  y={by + size / 2}
                  radiusX={size / 2}
                  radiusY={size / 2}
                  fill={color}
                  opacity={0.3}
                  stroke={color}
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
              );
            }
            return (
              <KonvaRect
                x={bx}
                y={by}
                width={bw}
                height={bh}
                fill={color}
                opacity={0.3}
                stroke={color}
                strokeWidth={2}
                dash={[6, 4]}
                cornerRadius={drawingShape.tool === "sticky" ? 4 : 0}
                listening={false}
              />
            );
          })()}
          {/* Preview lines from remote users */}
          {Object.entries(remoteDrawPreviews).map(([uid, p]) => (
            <KonvaLine
              key={`draw-preview-${uid}`}
              points={[p.startX, p.startY, p.endX, p.endY]}
              stroke="#666666"
              strokeWidth={2}
              dash={[6, 4]}
              opacity={0.5}
              listening={false}
            />
          ))}
          {/* Preview shapes from remote users */}
          {Object.entries(remoteShapePreviews).map(([uid, p]) => {
            const bx = Math.min(p.startX, p.endX);
            const by = Math.min(p.startY, p.endY);
            const bw = Math.abs(p.endX - p.startX);
            const bh = Math.abs(p.endY - p.startY);
            const color = SHAPE_PREVIEW_COLORS[p.tool as ShapeTool] || "#999999";
            if (p.tool === "circle") {
              const size = Math.max(bw, bh);
              return (
                <Ellipse
                  key={`shape-preview-${uid}`}
                  x={bx + size / 2}
                  y={by + size / 2}
                  radiusX={size / 2}
                  radiusY={size / 2}
                  fill={color}
                  opacity={0.2}
                  stroke={color}
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
              );
            }
            return (
              <KonvaRect
                key={`shape-preview-${uid}`}
                x={bx}
                y={by}
                width={bw}
                height={bh}
                fill={color}
                opacity={0.2}
                stroke={color}
                strokeWidth={2}
                dash={[6, 4]}
                cornerRadius={p.tool === "sticky" ? 4 : 0}
                listening={false}
              />
            );
          })}
          {/* Preview arrow while connecting */}
          {connectingFrom && connectorPreview && objects[connectingFrom] && (() => {
            const src = objects[connectingFrom];
            const fromX = src.x + src.width / 2;
            const fromY = src.y + src.height / 2;
            return (
              <Arrow
                points={[fromX, fromY, connectorPreview.x, connectorPreview.y]}
                stroke="#1a73e8"
                strokeWidth={2}
                pointerLength={10}
                pointerWidth={8}
                fill="#1a73e8"
                dash={[8, 4]}
                listening={false}
                opacity={0.6}
              />
            );
          })()}
          {/* Preview connector arrows from remote users */}
          {Object.entries(remoteConnectorPreviews).map(([uid, p]) => {
            const src = objects[p.fromId];
            if (!src) return null;
            return (
              <Arrow
                key={`connector-preview-${uid}`}
                points={[src.x + src.width / 2, src.y + src.height / 2, p.toX, p.toY]}
                stroke="#1a73e8"
                strokeWidth={2}
                pointerLength={10}
                pointerWidth={8}
                fill="#1a73e8"
                dash={[8, 4]}
                opacity={0.4}
                listening={false}
              />
            );
          })}
          <Transformer
            ref={transformerRef}
            rotateEnabled={true}
            boundBoxFunc={(_oldBox, newBox) => {
              if (newBox.width < 5 || newBox.height < 5) return _oldBox;
              if (!hasCircle) return newBox;

              const absW = Math.abs(newBox.width);
              const absH = Math.abs(newBox.height);
              if (Math.abs(absW - absH) < 0.5) return newBox;

              const oldAbsW = Math.abs(_oldBox.width);
              const oldAbsH = Math.abs(_oldBox.height);
              const wChanged = Math.abs(absW - oldAbsW) > 0.5;
              const hChanged = Math.abs(absH - oldAbsH) > 0.5;

              // Use the actively-dragged dimension as the leader;
              // fall back to max for corner handles where both change.
              const size =
                wChanged && !hChanged
                  ? absW
                  : hChanged && !wChanged
                    ? absH
                    : Math.max(absW, absH);
              const signW = Math.sign(newBox.width) || 1;
              const signH = Math.sign(newBox.height) || 1;
              const wGrow = size - absW;
              const hGrow = size - absH;

              return {
                x: newBox.x - (wGrow / 2) * signW,
                y: newBox.y - (hGrow / 2) * signH,
                width: size * signW,
                height: size * signH,
                rotation: newBox.rotation,
              };
            }}
          onTransform={() => {
              const tr = transformerRef.current;
              if (!tr) return;
              for (const node of tr.nodes()) {
                const id = node.id();
                if (!id) continue;
                broadcastLiveMoveRef.current(id, {
                  x: node.x(),
                  y: node.y(),
                  width: Math.max(5, node.width() * Math.abs(node.scaleX())),
                  height: Math.max(5, node.height() * Math.abs(node.scaleY())),
                  rotation: node.rotation(),
                });
                // Update local store with x/y/rotation only (skip width/height to avoid double-scale)
                useBoardStore.getState().applyRemoteUpdate(id, {
                  x: node.x(),
                  y: node.y(),
                  rotation: node.rotation(),
                });
              }
            }}
          />
        </Layer>
        <Layer listening={false}>
          <Cursors remoteCursors={remoteCursors} scale={scale} />
        </Layer>
      </Stage>

      {/* Connector hint */}
      {activeTool === "connector" && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 16px",
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            borderRadius: 6,
            fontSize: 13,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          {connectingFrom
            ? "Click a second object to connect — Esc to cancel"
            : "Click an object to start a connection"}
        </div>
      )}

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
