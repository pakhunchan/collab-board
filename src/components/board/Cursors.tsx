"use client";

import { useEffect, useRef, useCallback } from "react";
import { Group, Path, Rect, Text } from "react-konva";
import Konva from "konva";
import { CursorMeta, CursorTarget } from "@/hooks/useCursors";

// Classic pointer arrow SVG path (16x16 viewbox)
const CURSOR_PATH =
  "M0,0 L0,14 L4,10 L7.5,16 L9.5,15 L6,9 L11,9 Z";

const LERP_SPEED = 10;
const SNAP_THRESHOLD = 0.5;

interface CursorsProps {
  cursorMeta: Map<string, CursorMeta>;
  cursorTargetsRef: React.RefObject<Map<string, CursorTarget>>;
  scale: number;
}

export default function Cursors({ cursorMeta, cursorTargetsRef, scale }: CursorsProps) {
  const inv = 1 / scale;

  // Konva node references keyed by uid
  const nodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  // Current interpolated positions keyed by uid
  const currentPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // rAF handle
  const animFrameRef = useRef<number | null>(null);
  // Last frame timestamp for delta-time lerp
  const lastFrameRef = useRef(performance.now());

  // Callback ref factory: registers/unregisters Konva nodes
  const getCallbackRef = useCallback(
    (uid: string) => (node: Konva.Group | null) => {
      if (node) {
        nodeRefs.current.set(uid, node);
        // Snap to target immediately on mount (no lerp from origin)
        const target = cursorTargetsRef.current?.get(uid);
        if (target) {
          currentPosRef.current.set(uid, { x: target.x, y: target.y });
          node.x(target.x);
          node.y(target.y);
        }
      } else {
        nodeRefs.current.delete(uid);
        currentPosRef.current.delete(uid);
      }
    },
    [cursorTargetsRef]
  );

  // rAF lerp loop
  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      const factor = 1 - Math.exp(-LERP_SPEED * dt);

      const targets = cursorTargetsRef.current;
      let anyMoved = false;
      let layer: Konva.Layer | undefined;

      targets?.forEach((target, uid) => {
        const node = nodeRefs.current.get(uid);
        if (!node) return;

        let pos = currentPosRef.current.get(uid);
        if (!pos) {
          // First time seeing this uid in the loop — snap to target
          pos = { x: target.x, y: target.y };
          currentPosRef.current.set(uid, pos);
          node.x(pos.x);
          node.y(pos.y);
          anyMoved = true;
          if (!layer) layer = node.getLayer() ?? undefined;
          return;
        }

        const dx = target.x - pos.x;
        const dy = target.y - pos.y;

        if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
          // Close enough — snap exactly and stop updating
          if (pos.x !== target.x || pos.y !== target.y) {
            pos.x = target.x;
            pos.y = target.y;
            node.x(pos.x);
            node.y(pos.y);
            anyMoved = true;
            if (!layer) layer = node.getLayer() ?? undefined;
          }
          return;
        }

        pos.x += dx * factor;
        pos.y += dy * factor;
        node.x(pos.x);
        node.y(pos.y);
        anyMoved = true;
        if (!layer) layer = node.getLayer() ?? undefined;
      });

      if (anyMoved && layer) {
        layer.batchDraw();
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [cursorTargetsRef]);

  return (
    <>
      {Array.from(cursorMeta.values()).map((cursor) => (
        <Group
          key={cursor.uid}
          ref={getCallbackRef(cursor.uid)}
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
