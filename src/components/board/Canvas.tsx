"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Stage, Layer, Circle, Arrow, Line as KonvaLine, Rect as KonvaRect, Ellipse, Transformer } from "react-konva";
import Konva from "konva";
import { useBoardStore } from "@/stores/boardStore";
import { useCursors } from "@/hooks/useCursors";
import { useBoardSync } from "@/hooks/useBoardSync";
import { BoardObject } from "@/types/board";
import StickyNote from "./StickyNote";
import RectShape from "./RectShape";
import CircleShape from "./CircleShape";
import LineShape from "./LineShape";
import TextShape from "./TextShape";
import ConnectorShape from "./ConnectorShape";
import FrameShape from "./FrameShape";
import ConnectionDots, { type Side, getPortPosition, getDotPosition } from "./ConnectionDots";
import Cursors from "./Cursors";

function isInsideFrame(obj: BoardObject, frame: BoardObject): boolean {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  return cx >= frame.x && cx <= frame.x + frame.width &&
         cy >= frame.y && cy <= frame.y + frame.height;
}

function getChildIds(frameId: string, objects: Record<string, BoardObject>): string[] {
  return Object.values(objects)
    .filter((o) => o.properties?.parentFrameId === frameId)
    .map((o) => o.id);
}

function findInnermostFrame(obj: BoardObject, allObjects: Record<string, BoardObject>): string | null {
  if (obj.type === "frame") return null;

  let best: BoardObject | null = null;
  let bestArea = Infinity;
  for (const other of Object.values(allObjects)) {
    if (other.type !== "frame" || other.id === obj.id) continue;
    if (isInsideFrame(obj, other)) {
      const area = other.width * other.height;
      if (area < bestArea) { bestArea = area; best = other; }
    }
  }
  return best?.id ?? null;
}

const SHAPE_TOOLS = ["sticky", "rectangle", "circle", "text", "frame"] as const;
type ShapeTool = (typeof SHAPE_TOOLS)[number];

const SHAPE_PREVIEW_COLORS: Record<ShapeTool, string> = {
  sticky: "#FFEB3B",
  rectangle: "#90CAF9",
  circle: "#CE93D8",
  text: "#333333",
  frame: "rgba(74, 144, 217, 0.15)",
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
  const [connectionDrag, setConnectionDrag] = useState<{ fromId: string; fromPort: Side } | null>(null);
  const [connectionDragPos, setConnectionDragPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [hoverPort, setHoverPort] = useState<Side | null>(null);
  const [nearbyTargetIds, setNearbyTargetIds] = useState<string[]>([]);

  // Real-time cursors
  const { remoteCursors, handleCursorMove } = useCursors(boardId, reconnectKey, onChannelStatus);

  // Real-time object sync
  const { broadcastCreate, broadcastUpdate, broadcastDelete, broadcastLiveMove, broadcastDrawPreview, remoteDrawPreviews, broadcastConnectorPreview, remoteConnectorPreviews, broadcastShapePreview, remoteShapePreviews } = useBoardSync(boardId, reconnectKey, onChannelStatus, onAccessRevoked, onMemberJoined);

  // Inline text editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [textareaPos, setTextareaPos] = useState({ x: 0, y: 0, width: 0, height: 0, rotation: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeTool = useBoardStore((s) => s.activeTool);
  const setActiveTool = useBoardStore((s) => s.setActiveTool);
  const objects = useBoardStore((s) => s.objects);
  const selectedIds = useBoardStore((s) => s.selectedIds);
  const setSelectedIds = useBoardStore((s) => s.setSelectedIds);
  const clearSelection = useBoardStore((s) => s.clearSelection);

  const hasCircle = selectedIds.some((id) => objects[id]?.type === "circle");

  // Keep stable refs so native Konva listeners always call the latest versions
  const broadcastLiveMoveRef = useRef(broadcastLiveMove);
  broadcastLiveMoveRef.current = broadcastLiveMove;
  const broadcastUpdateRef = useRef(broadcastUpdate);
  broadcastUpdateRef.current = broadcastUpdate;

  // Native Konva dragmove + dragend listeners for live position sync and frame containment
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handler = (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      if (node === stage) return;
      const id = node.id();
      if (!id) return;

      const objs = useBoardStore.getState().objects;
      const obj = objs[id];
      const changes = { x: node.x(), y: node.y() };
      useBoardStore.getState().applyRemoteUpdate(id, changes);
      broadcastLiveMoveRef.current(id, changes);

      // If dragging a frame, move all descendants
      if (obj?.type === "frame") {
        const dx = node.x() - obj.x;
        const dy = node.y() - obj.y;
        const selected = useBoardStore.getState().selectedIds;
        // Only skip children that are being independently dragged in a multi-select
        const isMultiSelectDrag = selected.includes(id) && selected.length > 1;
        const children = getChildIds(id, objs);
        for (const childId of children) {
          if (isMultiSelectDrag && selected.includes(childId)) continue;
          const child = objs[childId];
          if (!child) continue;
          const childNode = stage.findOne("#" + childId);
          if (childNode) {
            childNode.x(child.x + dx);
            childNode.y(child.y + dy);
          }
          const childChanges = { x: child.x + dx, y: child.y + dy };
          useBoardStore.getState().applyRemoteUpdate(childId, childChanges);
          broadcastLiveMoveRef.current(childId, childChanges);
        }
      }
    };

    const dragEndHandler = (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      if (node === stage) return;
      const id = node.id();
      if (!id) return;

      const objs = useBoardStore.getState().objects;
      const obj = objs[id];
      if (!obj) return;

      // If a frame was dragged, persist children and adopt/unadopt objects
      if (obj.type === "frame") {
        const childIds = getChildIds(id, objs);
        for (const childId of childIds) {
          const child = useBoardStore.getState().objects[childId];
          if (child) {
            broadcastUpdateRef.current(childId, { x: child.x, y: child.y });
          }
        }

        // Drop-to-adopt: scan non-connector, non-frame objects
        const latestObjs = useBoardStore.getState().objects;
        const frame = latestObjs[id];
        if (frame) {
          for (const other of Object.values(latestObjs)) {
            if (other.id === id || other.type === "connector" || other.type === "frame") continue;
            const currentParent = (other.properties?.parentFrameId as string) || null;
            if (isInsideFrame(other, frame)) {
              // Adopt if not already parented to another frame
              if (!currentParent) {
                broadcastUpdateRef.current(other.id, {
                  properties: { ...other.properties, parentFrameId: id },
                });
              }
            } else if (currentParent === id) {
              // Unadopt if center moved outside
              const newProps = { ...other.properties };
              delete newProps.parentFrameId;
              broadcastUpdateRef.current(other.id, { properties: newProps });
            }
          }
        }
      }

      // For non-connector objects: detect frame containment changes
      if (obj.type !== "connector") {
        const updatedObj = useBoardStore.getState().objects[id];
        if (!updatedObj) return;
        const currentParent = (updatedObj.properties?.parentFrameId as string) || null;
        const newParent = findInnermostFrame(updatedObj, useBoardStore.getState().objects);
        if (newParent !== currentParent) {
          const newProps = { ...updatedObj.properties };
          if (newParent) {
            newProps.parentFrameId = newParent;
          } else {
            delete newProps.parentFrameId;
          }
          broadcastUpdateRef.current(id, { properties: newProps });
        }
      }
    };

    stage.on("dragmove", handler);
    stage.on("dragend", dragEndHandler);
    return () => {
      stage.off("dragmove", handler);
      stage.off("dragend", dragEndHandler);
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
        setConnectionDrag(null);
        setConnectionDragPos(null);
        setHoverTargetId(null);
        setHoverPort(null);
        setNearbyTargetIds([]);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if an input/textarea is focused
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const ids = useBoardStore.getState().selectedIds;
        // Unparent children of frames being deleted
        for (const id of ids) {
          const obj = useBoardStore.getState().objects[id];
          if (obj?.type === "frame") {
            const children = useBoardStore.getState().getFrameChildren(id);
            for (const child of children) {
              const newProps = { ...child.properties };
              delete newProps.parentFrameId;
              broadcastUpdate(child.id, { properties: newProps });
            }
          }
        }
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
  }, [editingId, broadcastDelete, broadcastUpdate, broadcastConnectorPreview, broadcastShapePreview]);

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

  // Find the nearest connection dot across ALL objects (excluding a given id)
  const findNearestDotGlobal = useCallback(
    (x: number, y: number, s: number, excludeId: string):
      { nearest: { objectId: string; port: Side } | null; nearbyIds: string[] } => {
      const objs = useBoardStore.getState().objects;
      const snapThreshold = 30 / s;
      const showThreshold = 100 / s;
      let best: { objectId: string; port: Side } | null = null;
      let bestDist = Infinity;
      const nearby: string[] = [];
      const sides: Side[] = ["top", "right", "bottom", "left"];
      for (const obj of Object.values(objs)) {
        if (obj.id === excludeId || obj.type === "connector") continue;
        let minDist = Infinity;
        for (const side of sides) {
          const p = getDotPosition(obj, side);
          const dist = Math.hypot(p.x - x, p.y - y);
          if (dist < minDist) { minDist = dist; }
          if (dist < bestDist) { bestDist = dist; best = { objectId: obj.id, port: side }; }
        }
        if (minDist <= showThreshold) nearby.push(obj.id);
      }
      return {
        nearest: bestDist <= snapThreshold ? best : null,
        nearbyIds: nearby,
      };
    },
    []
  );

  // Reconnect handler: delete old connector and start a new connection drag from same source
  const handleReconnect = useCallback(
    (connectorId: string, fromId: string, fromPort: Side) => {
      broadcastDelete(connectorId);
      clearSelection();
      setConnectionDrag({ fromId, fromPort });
    },
    [broadcastDelete, clearSelection]
  );

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

      // Connection drag: finish
      if (e.evt.button === 0 && connectionDrag) {
        const stage = stageRef.current;
        if (stage) {
          const pointer = stage.getPointerPosition();
          if (pointer) {
            const worldX = (pointer.x - stagePos.x) / scale;
            const worldY = (pointer.y - stagePos.y) / scale;
            if (hoverTargetId && hoverTargetId !== connectionDrag.fromId) {
              // Create connector to target object
              const c = broadcastCreate("connector", 0, 0);
              const props: Record<string, unknown> = {
                fromId: connectionDrag.fromId,
                toId: hoverTargetId,
                fromPort: connectionDrag.fromPort,
              };
              if (hoverPort) props.toPort = hoverPort;
              broadcastUpdate(c.id, { properties: props });
            } else {
              // Dangling arrow to canvas point
              const c = broadcastCreate("connector", 0, 0);
              broadcastUpdate(c.id, {
                properties: {
                  fromId: connectionDrag.fromId,
                  fromPort: connectionDrag.fromPort,
                  toX: worldX,
                  toY: worldY,
                },
              });
            }
          }
        }
        setConnectionDrag(null);
        setConnectionDragPos(null);
        setHoverTargetId(null);
        setHoverPort(null);
        setNearbyTargetIds([]);
        broadcastConnectorPreview(null);
        isDraggingObject.current = true;
        return;
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
        const obj = broadcastCreate("line", drawingLine.startX, drawingLine.startY, {
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
          obj = broadcastCreate(drawingShape.tool, cx, cy, { x: bx, y: by, width: bw, height: bh });
        }

        // Auto-adopt: if a frame was just created, adopt objects whose center falls inside it
        if (drawingShape.tool === "frame") {
          const allObjs = useBoardStore.getState().objects;
          const frame = allObjs[obj.id];
          if (frame) {
            const insideObjs = Object.values(allObjs).filter(
              (o) => o.id !== obj.id && o.type !== "connector" && o.type !== "frame" && isInsideFrame(o, frame)
            );
            for (const child of insideObjs) {
              broadcastUpdate(child.id, {
                properties: { ...child.properties, parentFrameId: obj.id },
              });
            }
          }
        }

        isDraggingObject.current = true;
        setSelectedIds([obj.id]);
        setActiveTool("select");
        setDrawingShape(null);
        setDrawingShapeEnd(null);
        broadcastShapePreview(null);
      }
    },
    [drawingLine, drawingShape, connectionDrag, hoverTargetId, hoverPort, stagePos, scale, broadcastCreate, broadcastUpdate, broadcastDrawPreview, broadcastShapePreview, broadcastConnectorPreview, setSelectedIds, setActiveTool]
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
  const FRAME_TITLE_HEIGHT = 24;
  const handleStickyDblClick = useCallback(
    (objId: string) => {
      const obj = useBoardStore.getState().objects[objId];
      if (!obj) return;
      const stage = stageRef.current;
      if (!stage) return;

      // Use Konva's absolute transform to get exact screen position
      const node = stage.findOne("#" + objId);
      if (!node) return;
      const absTransform = node.getAbsoluteTransform();
      const rotation = obj.rotation || 0;

      let localY = 0;
      let h = obj.height;
      if (obj.type === "frame") {
        localY = -FRAME_TITLE_HEIGHT;
        h = FRAME_TITLE_HEIGHT;
      }

      // Transform local top-left point to screen coordinates
      const screenPos = absTransform.point({ x: 0, y: localY });

      setEditingId(objId);
      setTextareaPos({
        x: screenPos.x,
        y: screenPos.y,
        width: obj.width * scale,
        height: h * scale,
        rotation,
      });

      // Focus textarea after render
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [scale]
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
    if (connectionDrag) {
      setConnectionDragPos({ x: worldX, y: worldY });
      // Hit-test for nearest dot across all objects
      const { nearest, nearbyIds } = findNearestDotGlobal(worldX, worldY, scale, connectionDrag.fromId);
      setNearbyTargetIds(nearbyIds);
      if (nearest) {
        setHoverTargetId(nearest.objectId);
        setHoverPort(nearest.port);
      } else {
        setHoverTargetId(null);
        setHoverPort(null);
      }
      // Broadcast preview for remote users
      broadcastConnectorPreview({ fromId: connectionDrag.fromId, toX: worldX, toY: worldY });
      return;
    }
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
  }, [stagePos, scale, handleCursorMove, connectionDrag, findNearestDotGlobal, broadcastConnectorPreview, drawingLine, broadcastDrawPreview, drawingShape, connectingFrom, broadcastShapePreview]);

  const cursorForTool = () => {
    if (isPanning) return "grab";
    if (connectionDrag) return "crosshair";
    if (activeTool === "sticky" || activeTool === "rectangle" || activeTool === "circle" || activeTool === "line" || activeTool === "text" || activeTool === "connector" || activeTool === "frame") return "crosshair";
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
                isEditing={editingId === obj.id}
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
                onReconnect={handleReconnect}
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
            ) : obj.type === "frame" ? (
              <FrameShape
                key={obj.id}
                obj={obj}
                isSelected={selectedIds.includes(obj.id)}
                isEditing={editingId === obj.id}
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
                const w = Math.max(5, node.width() * Math.abs(node.scaleX()));
                const h = Math.max(5, node.height() * Math.abs(node.scaleY()));
                broadcastLiveMoveRef.current(id, {
                  x: node.x(),
                  y: node.y(),
                  width: w,
                  height: h,
                  rotation: node.rotation(),
                });
                // Reset node scale and apply real dimensions to avoid double-scale
                node.scaleX(node.scaleX() > 0 ? 1 : -1);
                node.scaleY(node.scaleY() > 0 ? 1 : -1);
                node.width(w);
                node.height(h);
                useBoardStore.getState().applyRemoteUpdate(id, {
                  x: node.x(),
                  y: node.y(),
                  width: w,
                  height: h,
                  rotation: node.rotation(),
                });
              }
            }}
          />
          {/* Connection dots for selected non-connector objects */}
          {!connectionDrag && selectedIds
            .filter((id) => objects[id] && objects[id].type !== "connector" && objects[id].type !== "frame")
            .map((id) => (
              <ConnectionDots
                key={`dots-${id}`}
                obj={objects[id]}
                scale={scale}
                variant="selected"
                onDotMouseDown={(port) => {
                  setConnectionDrag({ fromId: id, fromPort: port });
                }}
              />
            ))}
          {/* Connection dots on nearby potential targets during drag */}
          {connectionDrag &&
            Object.values(objects)
              .filter((o) => o.type !== "connector" && o.type !== "frame" && o.id !== connectionDrag.fromId && nearbyTargetIds.includes(o.id))
              .map((o) => (
                <ConnectionDots
                  key={`target-dots-${o.id}`}
                  obj={o}
                  scale={scale}
                  variant="target"
                  highlightedPort={hoverTargetId === o.id ? hoverPort : null}
                />
              ))}
          {/* Preview arrow during connection drag */}
          {connectionDrag && connectionDragPos && objects[connectionDrag.fromId] && (() => {
            const fromPortPos = getPortPosition(objects[connectionDrag.fromId], connectionDrag.fromPort);
            return (
              <Arrow
                points={[fromPortPos.x, fromPortPos.y, connectionDragPos.x, connectionDragPos.y]}
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
      {editingId && (() => {
        const isFrame = objects[editingId]?.type === "frame";
        return (
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
              padding: isFrame ? `${4 * scale}px` : `${12 * scale}px`,
              fontSize: isFrame ? `${14 * scale}px` : `${16 * scale}px`,
              fontFamily: "sans-serif",
              color: isFrame ? "#666666" : "#333",
              background: "transparent",
              border: "none",
              margin: 0,
              borderRadius: isFrame ? "0" : `${4 * scale}px`,
              outline: isFrame ? "none" : "2px solid #1a73e8",
              lineHeight: "1",
              resize: "none",
              overflow: "hidden",
              zIndex: 10,
              boxSizing: "border-box",
              transform: `rotate(${textareaPos.rotation}deg)`,
              transformOrigin: "0 0",
            }}
          />
        );
      })()}
    </div>
  );
}
