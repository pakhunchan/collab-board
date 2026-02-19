"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { User } from "firebase/auth";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBoardStore } from "@/stores/boardStore";
import { BoardObject, BoardObjectType } from "@/types/board";
import {
  addPendingWrite,
  getPendingWrites,
  clearPendingWrites,
} from "@/lib/pendingWrites";

async function getAuthHeaders(user: User) {
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function useBoardSync(
  boardId: string | undefined,
  reconnectKey = 0,
  onChannelStatus?: (channelId: string, status: string) => void,
  onAccessRevoked?: () => void,
  onMemberJoined?: (member: { user_id: string; display_name: string | null; role: string; joined_at: string }) => void
) {
  const { user } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const connectedRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const lastLiveMoveRef = useRef<number>(0);
  const liveMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDrawPreviewRef = useRef<number>(0);
  const drawPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [remoteDrawPreviews, setRemoteDrawPreviews] = useState<
    Record<string, { startX: number; startY: number; endX: number; endY: number }>
  >({});
  const lastConnectorPreviewRef = useRef<number>(0);
  const connectorPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [remoteConnectorPreviews, setRemoteConnectorPreviews] = useState<
    Record<string, { fromId: string; toX: number; toY: number }>
  >({});
  const lastShapePreviewRef = useRef<number>(0);
  const shapePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [remoteShapePreviews, setRemoteShapePreviews] = useState<
    Record<string, { tool: string; startX: number; startY: number; endX: number; endY: number }>
  >({});
  const pendingBroadcasts = useRef<
    Array<{ event: string; payload: Record<string, unknown> }>
  >([]);

  // Drain any queued broadcasts once the channel is ready
  const drainPendingBroadcasts = useCallback(() => {
    if (!channelRef.current || !connectedRef.current) return;
    const queued = pendingBroadcasts.current;
    pendingBroadcasts.current = [];
    for (const msg of queued) {
      channelRef.current.send({
        type: "broadcast",
        event: msg.event,
        payload: msg.payload,
      });
    }
  }, []);

  // DB write helpers (fire-and-forget)
  const persistCreate = useCallback(
    async (obj: BoardObject) => {
      if (!boardId || !user) return;
      try {
        const headers = await getAuthHeaders(user);
        await fetch(`/api/boards/${boardId}/objects`, {
          method: "POST",
          headers,
          body: JSON.stringify(obj),
        });
      } catch (err) {
        console.error("Failed to persist create:", err);
        if (boardId) addPendingWrite(boardId, { type: "create", object: obj });
      }
    },
    [boardId, user]
  );

  // Fetch objects on mount and on reconnect
  useEffect(() => {
    if (!boardId || !user) return;

    let cancelled = false;

    async function flushPendingWrites(headers: Record<string, string>) {
      const pending = getPendingWrites(boardId!);
      if (pending.length === 0) return;

      for (const write of pending) {
        try {
          if (write.type === "create") {
            await fetch(`/api/boards/${boardId}/objects`, {
              method: "POST",
              headers,
              body: JSON.stringify(write.object),
            });
            useBoardStore.getState().applyRemoteCreate(write.object);
            pendingBroadcasts.current.push({
              event: "object:create",
              payload: { senderId: user!.uid, object: write.object },
            });
          } else if (write.type === "update") {
            await fetch(`/api/boards/${boardId}/objects/${write.objectId}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify(write.changes),
            });
            pendingBroadcasts.current.push({
              event: "object:update",
              payload: { senderId: user!.uid, objectId: write.objectId, changes: write.changes },
            });
          } else if (write.type === "delete") {
            await fetch(`/api/boards/${boardId}/objects/${write.objectId}`, {
              method: "DELETE",
              headers,
            });
            pendingBroadcasts.current.push({
              event: "object:delete",
              payload: { senderId: user!.uid, objectId: write.objectId },
            });
          }
        } catch (err) {
          console.error("Failed to flush pending write:", err);
          return;
        }
      }
      clearPendingWrites(boardId!);
      drainPendingBroadcasts();
    }

    async function fetchObjects() {
      try {
        const headers = await getAuthHeaders(user!);
        const res = await fetch(`/api/boards/${boardId}/objects`, { headers });
        if (!res.ok) return;
        const data: BoardObject[] = await res.json();
        if (cancelled) return;

        if (reconnectKey > 0) {
          // Reconnection: reconcile remote with local state.
          // The store already has the correct final state in memory,
          // so reconcile handles merging + we persist/broadcast local-only objects.
          const localOnly = useBoardStore.getState().reconcileObjects(data);
          for (const obj of localOnly) {
            persistCreate(obj);
            pendingBroadcasts.current.push({
              event: "object:create",
              payload: { senderId: user!.uid, object: obj },
            });
          }
          drainPendingBroadcasts();
          // Reconciliation handled everything — clear stale pending writes
          // so they don't replay with outdated snapshots.
          clearPendingWrites(boardId!);
        } else {
          // Initial load (fresh page)
          useBoardStore.getState().loadObjects(data);
          // Flush any pending writes from a previous offline session
          await flushPendingWrites(await getAuthHeaders(user!));
        }
      } catch (err) {
        console.error("Failed to load board objects:", err);
      }
    }

    fetchObjects();

    return () => {
      cancelled = true;
    };
  }, [boardId, user, reconnectKey, persistCreate, drainPendingBroadcasts]);

  const persistUpdate = useCallback(
    async (objectId: string, changes: Partial<BoardObject>) => {
      if (!boardId || !user) return;
      try {
        const headers = await getAuthHeaders(user);
        await fetch(`/api/boards/${boardId}/objects/${objectId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(changes),
        });
      } catch (err) {
        console.error("Failed to persist update:", err);
        if (boardId)
          addPendingWrite(boardId, { type: "update", objectId, changes });
      }
    },
    [boardId, user]
  );

  const persistDelete = useCallback(
    async (objectId: string) => {
      if (!boardId || !user) return;
      try {
        const headers = await getAuthHeaders(user);
        await fetch(`/api/boards/${boardId}/objects/${objectId}`, {
          method: "DELETE",
          headers,
        });
      } catch (err) {
        console.error("Failed to persist delete:", err);
        if (boardId)
          addPendingWrite(boardId, { type: "delete", objectId });
      }
    },
    [boardId, user]
  );

  // Channel lifecycle
  useEffect(() => {
    if (!boardId || !user) {
      channelRef.current = null;
      connectedRef.current = false;
      return;
    }

    const supabase = getSupabaseBrowserClient();

    const channel = supabase.channel(`board:${boardId}:objects`, {
      config: { broadcast: { self: false } },
    });

    channelRef.current = channel;

    // Incoming: object:create
    channel.on(
      "broadcast",
      { event: "object:create" },
      (payload: { payload: { object: BoardObject } }) => {
        useBoardStore.getState().applyRemoteCreate(payload.payload.object);
      }
    );

    // Incoming: object:update
    channel.on(
      "broadcast",
      { event: "object:update" },
      (payload: {
        payload: { objectId: string; changes: Partial<BoardObject> };
      }) => {
        const { objectId, changes } = payload.payload;
        useBoardStore.getState().applyRemoteUpdate(objectId, changes);
      }
    );

    // Incoming: object:delete
    channel.on(
      "broadcast",
      { event: "object:delete" },
      (payload: { payload: { objectId: string } }) => {
        useBoardStore.getState().applyRemoteDelete(payload.payload.objectId);
      }
    );

    // Incoming: access:revoked — server evicts a specific user
    channel.on(
      "broadcast",
      { event: "access:revoked" },
      (payload: { payload: { userId: string } }) => {
        if (payload.payload.userId === user.uid) {
          onAccessRevoked?.();
        }
      }
    );

    // Incoming: board:deleted — board was deleted, evict everyone
    channel.on(
      "broadcast",
      { event: "board:deleted" },
      () => {
        onAccessRevoked?.();
      }
    );

    // Incoming: draw:preview — ephemeral line drawing preview from another user
    channel.on(
      "broadcast",
      { event: "draw:preview" },
      (payload: {
        payload: {
          senderId: string;
          preview: { startX: number; startY: number; endX: number; endY: number } | null;
        };
      }) => {
        const { senderId, preview } = payload.payload;
        setRemoteDrawPreviews((prev) => {
          if (preview) {
            return { ...prev, [senderId]: preview };
          }
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
      }
    );

    // Incoming: connector:preview — ephemeral connector arrow preview from another user
    channel.on(
      "broadcast",
      { event: "connector:preview" },
      (payload: {
        payload: {
          senderId: string;
          preview: { fromId: string; toX: number; toY: number } | null;
        };
      }) => {
        const { senderId, preview } = payload.payload;
        setRemoteConnectorPreviews((prev) => {
          if (preview) {
            return { ...prev, [senderId]: preview };
          }
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
      }
    );

    // Incoming: shape:preview — ephemeral shape drawing preview from another user
    channel.on(
      "broadcast",
      { event: "shape:preview" },
      (payload: {
        payload: {
          senderId: string;
          preview: { tool: string; startX: number; startY: number; endX: number; endY: number } | null;
        };
      }) => {
        const { senderId, preview } = payload.payload;
        setRemoteShapePreviews((prev) => {
          if (preview) {
            return { ...prev, [senderId]: preview };
          }
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
      }
    );

    // Incoming: member:joined — new member accepted an invite
    channel.on(
      "broadcast",
      { event: "member:joined" },
      (payload: { payload: { user_id: string; display_name: string | null; role: string; joined_at: string } }) => {
        onMemberJoined?.(payload.payload);
      }
    );

    // Subscribe AFTER registering listeners
    const channelName = `board:${boardId}:objects`;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        connectedRef.current = true;
        drainPendingBroadcasts();
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
      channel.unsubscribe();
    };
  }, [boardId, user, reconnectKey, onChannelStatus, onAccessRevoked, onMemberJoined, drainPendingBroadcasts]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Outgoing: broadcastCreate
  const broadcastCreate = useCallback(
    (type: BoardObjectType, x: number, y: number) => {
      const store = useBoardStore.getState();
      const obj = store.addObject(type, x, y);

      // Patch with real boardId and createdBy
      const patched: Partial<BoardObject> = {
        boardId: boardId || "",
        createdBy: user?.uid || "",
      };
      store.updateObject(obj.id, patched);

      const fullObj = useBoardStore.getState().objects[obj.id];

      if (channelRef.current && connectedRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "object:create",
          payload: {
            senderId: user?.uid || "",
            object: fullObj,
          },
        });
      }

      persistCreate(fullObj);

      return fullObj;
    },
    [boardId, user, persistCreate]
  );

  // Outgoing: broadcastUpdate
  const broadcastUpdate = useCallback(
    (id: string, changes: Partial<BoardObject>) => {
      const store = useBoardStore.getState();
      store.updateObject(id, changes);

      // Get the updatedAt that was stamped
      const updated = useBoardStore.getState().objects[id];
      const broadcastChanges = { ...changes, updatedAt: updated?.updatedAt };

      if (channelRef.current && connectedRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "object:update",
          payload: {
            senderId: user?.uid || "",
            objectId: id,
            changes: broadcastChanges,
          },
        });
      }

      // Debounced DB write (300ms per object)
      const existing = debounceTimers.current.get(id);
      if (existing) clearTimeout(existing);
      debounceTimers.current.set(
        id,
        setTimeout(() => {
          debounceTimers.current.delete(id);
          persistUpdate(id, broadcastChanges);
        }, 300)
      );
    },
    [user, persistUpdate]
  );

  // Outgoing: broadcastDelete
  const broadcastDelete = useCallback(
    (id: string) => {
      // Cancel any pending debounced update for this object
      const pending = debounceTimers.current.get(id);
      if (pending) {
        clearTimeout(pending);
        debounceTimers.current.delete(id);
      }

      const store = useBoardStore.getState();
      store.deleteObject(id);

      if (channelRef.current && connectedRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "object:delete",
          payload: {
            senderId: user?.uid || "",
            objectId: id,
          },
        });
      }

      persistDelete(id);
    },
    [user, persistDelete]
  );

  // Outgoing: broadcastLiveMove (throttled, broadcast-only — no store update, no DB write)
  const broadcastLiveMove = useCallback(
    (id: string, changes: Partial<BoardObject>) => {
      if (!channelRef.current || !connectedRef.current) return;

      const send = () => {
        lastLiveMoveRef.current = Date.now();
        channelRef.current?.send({
          type: "broadcast",
          event: "object:update",
          payload: {
            senderId: user?.uid || "",
            objectId: id,
            changes,
          },
        });
      };

      const elapsed = Date.now() - lastLiveMoveRef.current;
      if (elapsed >= 50) {
        if (liveMoveTimerRef.current) {
          clearTimeout(liveMoveTimerRef.current);
          liveMoveTimerRef.current = null;
        }
        send();
      } else {
        if (liveMoveTimerRef.current) clearTimeout(liveMoveTimerRef.current);
        liveMoveTimerRef.current = setTimeout(send, 50 - elapsed);
      }
    },
    [user]
  );

  // Outgoing: broadcastDrawPreview (throttled, broadcast-only — ephemeral line preview)
  const broadcastDrawPreview = useCallback(
    (preview: { startX: number; startY: number; endX: number; endY: number } | null) => {
      if (!channelRef.current || !connectedRef.current) return;

      const send = () => {
        lastDrawPreviewRef.current = Date.now();
        channelRef.current?.send({
          type: "broadcast",
          event: "draw:preview",
          payload: {
            senderId: user?.uid || "",
            preview,
          },
        });
      };

      // Send clear immediately
      if (!preview) {
        if (drawPreviewTimerRef.current) {
          clearTimeout(drawPreviewTimerRef.current);
          drawPreviewTimerRef.current = null;
        }
        send();
        return;
      }

      const elapsed = Date.now() - lastDrawPreviewRef.current;
      if (elapsed >= 50) {
        if (drawPreviewTimerRef.current) {
          clearTimeout(drawPreviewTimerRef.current);
          drawPreviewTimerRef.current = null;
        }
        send();
      } else {
        if (drawPreviewTimerRef.current) clearTimeout(drawPreviewTimerRef.current);
        drawPreviewTimerRef.current = setTimeout(send, 50 - elapsed);
      }
    },
    [user]
  );

  // Outgoing: broadcastConnectorPreview (throttled, broadcast-only — ephemeral connector preview)
  const broadcastConnectorPreview = useCallback(
    (preview: { fromId: string; toX: number; toY: number } | null) => {
      if (!channelRef.current || !connectedRef.current) return;

      const send = () => {
        lastConnectorPreviewRef.current = Date.now();
        channelRef.current?.send({
          type: "broadcast",
          event: "connector:preview",
          payload: {
            senderId: user?.uid || "",
            preview,
          },
        });
      };

      // Send clear immediately
      if (!preview) {
        if (connectorPreviewTimerRef.current) {
          clearTimeout(connectorPreviewTimerRef.current);
          connectorPreviewTimerRef.current = null;
        }
        send();
        return;
      }

      const elapsed = Date.now() - lastConnectorPreviewRef.current;
      if (elapsed >= 50) {
        if (connectorPreviewTimerRef.current) {
          clearTimeout(connectorPreviewTimerRef.current);
          connectorPreviewTimerRef.current = null;
        }
        send();
      } else {
        if (connectorPreviewTimerRef.current) clearTimeout(connectorPreviewTimerRef.current);
        connectorPreviewTimerRef.current = setTimeout(send, 50 - elapsed);
      }
    },
    [user]
  );

  // Outgoing: broadcastShapePreview (throttled, broadcast-only — ephemeral shape preview)
  const broadcastShapePreview = useCallback(
    (preview: { tool: string; startX: number; startY: number; endX: number; endY: number } | null) => {
      if (!channelRef.current || !connectedRef.current) return;

      const send = () => {
        lastShapePreviewRef.current = Date.now();
        channelRef.current?.send({
          type: "broadcast",
          event: "shape:preview",
          payload: {
            senderId: user?.uid || "",
            preview,
          },
        });
      };

      // Send clear immediately
      if (!preview) {
        if (shapePreviewTimerRef.current) {
          clearTimeout(shapePreviewTimerRef.current);
          shapePreviewTimerRef.current = null;
        }
        send();
        return;
      }

      const elapsed = Date.now() - lastShapePreviewRef.current;
      if (elapsed >= 50) {
        if (shapePreviewTimerRef.current) {
          clearTimeout(shapePreviewTimerRef.current);
          shapePreviewTimerRef.current = null;
        }
        send();
      } else {
        if (shapePreviewTimerRef.current) clearTimeout(shapePreviewTimerRef.current);
        shapePreviewTimerRef.current = setTimeout(send, 50 - elapsed);
      }
    },
    [user]
  );

  return { broadcastCreate, broadcastUpdate, broadcastDelete, broadcastLiveMove, broadcastDrawPreview, remoteDrawPreviews, broadcastConnectorPreview, remoteConnectorPreviews, broadcastShapePreview, remoteShapePreviews };
}
