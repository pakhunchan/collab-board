import { getSupabaseServerClient } from "./server";

/**
 * Broadcast an event on a board's Realtime channel from the server.
 * Uses the service-role client so it can broadcast to any channel.
 * Callers should fire-and-forget (don't await in the API response path).
 */
export async function broadcastBoardEvent(
  boardId: string,
  event: string,
  payload: Record<string, unknown>
) {
  const supabase = getSupabaseServerClient();
  const channelName = `board:${boardId}:objects`;
  const channel = supabase.channel(channelName);

  return new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.send({
          type: "broadcast",
          event,
          payload,
        });
        // Give the message a moment to flush before cleaning up
        setTimeout(() => {
          supabase.removeChannel(channel);
          resolve();
        }, 200);
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        supabase.removeChannel(channel);
        resolve();
      }
    });
  });
}

export interface PersistentChannel {
  send(event: string, payload: Record<string, unknown>): void;
  close(): void;
}

/**
 * Create a persistent broadcast channel that subscribes once.
 * Messages are queued until the channel is subscribed, then flushed.
 * Call `close()` when done to tear down the channel.
 */
export function createPersistentChannel(boardId: string): PersistentChannel {
  const supabase = getSupabaseServerClient();
  const channelName = `board:${boardId}:objects:agent`;
  const channel = supabase.channel(channelName);

  let subscribed = false;
  const pending: Array<{ event: string; payload: Record<string, unknown> }> = [];

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      subscribed = true;
      for (const msg of pending) {
        channel.send({ type: "broadcast", event: msg.event, payload: msg.payload });
      }
      pending.length = 0;
    }
  });

  return {
    send(event: string, payload: Record<string, unknown>) {
      if (subscribed) {
        channel.send({ type: "broadcast", event, payload });
      } else {
        pending.push({ event, payload });
      }
    },
    close() {
      supabase.removeChannel(channel);
    },
  };
}
