"use client";

import { useEffect, useRef, useCallback } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { User } from "firebase/auth";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBoardStore } from "@/stores/boardStore";
import { BoardObject, BoardObjectType } from "@/types/board";

async function getAuthHeaders(user: User) {
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function useBoardSync(boardId: string | undefined) {
  const { user } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const connectedRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const lastLiveMoveRef = useRef<number>(0);
  const liveMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch objects on mount
  useEffect(() => {
    if (!boardId || !user) return;

    let cancelled = false;

    async function fetchObjects() {
      try {
        const headers = await getAuthHeaders(user!);
        const res = await fetch(`/api/boards/${boardId}/objects`, { headers });
        if (!res.ok) return;
        const data: BoardObject[] = await res.json();
        if (!cancelled) {
          useBoardStore.getState().loadObjects(data);
        }
      } catch (err) {
        console.error("Failed to load board objects:", err);
      }
    }

    fetchObjects();

    return () => {
      cancelled = true;
    };
  }, [boardId, user]);

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
      }
    },
    [boardId, user]
  );

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

    // Subscribe AFTER registering listeners
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        connectedRef.current = true;
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
        connectedRef.current = false;
      }
    });

    return () => {
      connectedRef.current = false;
      channelRef.current = null;
      channel.unsubscribe();
    };
  }, [boardId, user]);

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
    (id: string, x: number, y: number) => {
      if (!channelRef.current || !connectedRef.current) return;

      const send = () => {
        lastLiveMoveRef.current = Date.now();
        channelRef.current?.send({
          type: "broadcast",
          event: "object:update",
          payload: {
            senderId: user?.uid || "",
            objectId: id,
            changes: { x, y },
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

  return { broadcastCreate, broadcastUpdate, broadcastDelete, broadcastLiveMove };
}
