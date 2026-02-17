"use client";

import { useEffect, useRef, useCallback } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBoardStore } from "@/stores/boardStore";
import { BoardObject, BoardObjectType } from "@/types/board";

export function useBoardSync(boardId: string | undefined) {
  const { user } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const connectedRef = useRef(false);

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
    // Note: self:false already prevents receiving our own broadcasts,
    // so no senderId check needed (would break same-user multi-tab sync)
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

      return fullObj;
    },
    [boardId, user]
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
    },
    [user]
  );

  // Outgoing: broadcastDelete
  const broadcastDelete = useCallback(
    (id: string) => {
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
    },
    [user]
  );

  return { broadcastCreate, broadcastUpdate, broadcastDelete };
}
