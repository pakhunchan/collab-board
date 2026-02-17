"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { uidToColor } from "@/lib/presence-colors";
import { usePresenceStore } from "@/stores/presenceStore";

export interface CursorPosition {
  uid: string;
  name: string;
  x: number;
  y: number;
  color: string;
  lastSeen: number;
}

const THROTTLE_MS = 50;
const STALE_MS = 3000;

export function useCursors(
  boardId: string | undefined,
  reconnectKey = 0,
  onChannelStatus?: (channelId: string, status: string) => void
) {
  const { user } = useAuth();
  const [remoteCursors, setRemoteCursors] = useState<Map<string, CursorPosition>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const connectedRef = useRef(false);

  // Throttle state for broadcasting
  const lastSendRef = useRef(0);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Single atomic effect: create channel, register listeners, subscribe, cleanup
  useEffect(() => {
    if (!boardId || !user) {
      channelRef.current = null;
      connectedRef.current = false;
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const myUid = user.uid;
    const myName = user.displayName || user.email || "Anonymous";


    const channel = supabase.channel(`board:${boardId}`, {
      config: { broadcast: { self: false } },
    });

    channelRef.current = channel;

    // 1. Register broadcast listener
    channel.on(
      "broadcast",
      { event: "cursor" },
      (payload: { payload: { uid: string; name: string; x: number; y: number } }) => {
        const { uid, name, x, y } = payload.payload;
        if (uid === myUid) return;

        setRemoteCursors((prev) => {
          const next = new Map(prev);
          next.set(uid, {
            uid,
            name,
            x,
            y,
            color: uidToColor(uid),
            lastSeen: Date.now(),
          });
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

        setRemoteCursors((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const p of left) {
            if (p.uid && next.has(p.uid)) {
              next.delete(p.uid);
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
    const channelName = `board:${boardId}`;
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
      onChannelStatus?.(channelName, status);
    });

    return () => {
      connectedRef.current = false;
      channelRef.current = null;
      // Use unsubscribe (not removeChannel) to avoid killing the shared WebSocket
      // during React strict mode's unmount-remount cycle
      channel.unsubscribe();
      setRemoteCursors(new Map());
      usePresenceStore.getState().setOnlineUsers([]);
    };
  }, [boardId, user, reconnectKey, onChannelStatus]);

  // Stale cursor cleanup every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setRemoteCursors((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        next.forEach((cursor, uid) => {
          if (now - cursor.lastSeen > STALE_MS) {
            next.delete(uid);
            changed = true;
          }
        });
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

  return { remoteCursors, handleCursorMove };
}
