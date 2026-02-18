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
