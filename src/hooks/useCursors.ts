"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { uidToColor } from "@/lib/presence-colors";
import { usePresenceStore } from "@/stores/presenceStore";

export interface CursorMeta {
  uid: string;
  name: string;
  color: string;
}

export interface CursorTarget {
  x: number;
  y: number;
  lastSeen: number;
}

const THROTTLE_MS = 50;
const STALE_MS = 3000;

export function useCursors(
  boardId: string | undefined,
  channelNonce: string | undefined,
  reconnectKey = 0,
  onChannelStatus?: (channelId: string, status: string) => void
) {
  const { user } = useAuth();
  const [cursorMeta, setCursorMeta] = useState<Map<string, CursorMeta>>(new Map());
  const cursorTargetsRef = useRef<Map<string, CursorTarget>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const connectedRef = useRef(false);

  // Throttle state for broadcasting
  const lastSendRef = useRef(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Single atomic effect: create channel, register listeners, subscribe, cleanup
  useEffect(() => {
    if (!boardId || !user || !channelNonce) {
      channelRef.current = null;
      connectedRef.current = false;
      return;
    }

    const targets = cursorTargetsRef.current;
    const supabase = getSupabaseBrowserClient();
    const myUid = user.uid;
    const myName = user.displayName || user.email || "Anonymous";

    const channel = supabase.channel(`board:${boardId}:${channelNonce}`, {
      config: { private: true, broadcast: { self: false } },
    });

    channelRef.current = channel;

    // 1. Register broadcast listener
    channel.on(
      "broadcast",
      { event: "cursor" },
      (payload: { payload: { uid: string; name: string; x: number; y: number } }) => {
        const { uid, name, x, y } = payload.payload;
        if (uid === myUid) return;

        // Always update target ref (no re-render)
        cursorTargetsRef.current.set(uid, { x, y, lastSeen: Date.now() });

        // Only update state when a NEW cursor appears
        setCursorMeta((prev) => {
          if (prev.has(uid)) return prev; // same ref = no re-render
          const next = new Map(prev);
          next.set(uid, { uid, name, color: uidToColor(uid) });
          return next;
        });
      }
    );

    // 2. Register presence listener
    channel.on(
      "presence",
      { event: "leave" },
      (payload: { leftPresences: Array<{ uid: string }> }) => {
        const left = payload.leftPresences;
        if (!left?.length) return;

        setCursorMeta((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const p of left) {
            if (p.uid && next.has(p.uid)) {
              next.delete(p.uid);
              cursorTargetsRef.current.delete(p.uid);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    );

    // 3. Register presence sync listener for online users
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const uniqueUsers = new Map<string, { uid: string; name: string; color: string }>();
      for (const presences of Object.values(state)) {
        for (const p of presences as unknown as Array<{ uid: string; name: string }>) {
          if (p.uid && !uniqueUsers.has(p.uid)) {
            uniqueUsers.set(p.uid, { uid: p.uid, name: p.name || "Anonymous", color: uidToColor(p.uid) });
          }
        }
      }
      usePresenceStore.getState().setOnlineUsers(Array.from(uniqueUsers.values()));
    });

    // 4. Subscribe AFTER listeners
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        connectedRef.current = true;
        channel.track({ uid: myUid, name: myName });
      } else if (
        status === "CLOSED" ||
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        connectedRef.current = false;
      }
      onChannelStatus?.("cursors", status);
    });

    return () => {
      connectedRef.current = false;
      channelRef.current = null;
      // Use unsubscribe (not removeChannel) to avoid killing the shared WebSocket
      // during React strict mode's unmount-remount cycle
      channel.unsubscribe();
      setCursorMeta(new Map());
      targets.clear();
      usePresenceStore.getState().setOnlineUsers([]);
    };
  }, [boardId, user, channelNonce, reconnectKey, onChannelStatus]);

  // Stale cursor cleanup every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const targets = cursorTargetsRef.current;
      const staleUids: string[] = [];

      targets.forEach((target, uid) => {
        if (now - target.lastSeen > STALE_MS) {
          staleUids.push(uid);
        }
      });

      if (staleUids.length === 0) return;

      for (const uid of staleUids) {
        targets.delete(uid);
      }

      setCursorMeta((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const uid of staleUids) {
          if (next.has(uid)) {
            next.delete(uid);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, STALE_MS);

    return () => clearInterval(interval);
  }, []);

  // Throttled broadcast via rAF + minimum interval
  const handleCursorMove = useCallback(
    (worldX: number, worldY: number) => {
      const channel = channelRef.current;
      if (!channel || !connectedRef.current || !user) return;

      pendingRef.current = { x: worldX, y: worldY };

      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const now = Date.now();
        const pos = pendingRef.current;
        const ch = channelRef.current;
        if (!pos || !ch) return;

        if (now - lastSendRef.current < THROTTLE_MS) {
          const remaining = THROTTLE_MS - (now - lastSendRef.current);
          setTimeout(() => {
            const latestPos = pendingRef.current;
            const latestCh = channelRef.current;
            if (!latestPos || !latestCh) return;
            lastSendRef.current = Date.now();
            pendingRef.current = null;
            latestCh.send({
              type: "broadcast",
              event: "cursor",
              payload: {
                uid: user.uid,
                name: user.displayName || user.email || "Anonymous",
                x: latestPos.x,
                y: latestPos.y,
              },
            });
          }, remaining);
          return;
        }

        lastSendRef.current = now;
        pendingRef.current = null;
        ch.send({
          type: "broadcast",
          event: "cursor",
          payload: {
            uid: user.uid,
            name: user.displayName || user.email || "Anonymous",
            x: pos.x,
            y: pos.y,
          },
        });
      });
    },
    [user]
  );

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return { cursorMeta, cursorTargetsRef, handleCursorMove };
}
