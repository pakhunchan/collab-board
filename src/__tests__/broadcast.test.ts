import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// --- Mock supabase channel ---

let subscribeCallback: ((status: string) => void) | null = null;

const mockChannel = {
  subscribe: vi.fn((cb: (status: string) => void) => {
    subscribeCallback = cb;
  }),
  send: vi.fn(),
};

const mockClient = {
  channel: vi.fn(() => mockChannel),
  removeChannel: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => mockClient,
}));

// Import AFTER mocks are set up
import { broadcastBoardEvent } from "@/lib/supabase/broadcast";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  subscribeCallback = null;
});

describe("broadcastBoardEvent", () => {
  it("creates a channel with the correct name", () => {
    broadcastBoardEvent("board-123", "test:event", { key: "val" });

    expect(mockClient.channel).toHaveBeenCalledWith("board:board-123:objects");
  });

  it("subscribes to the channel", () => {
    broadcastBoardEvent("board-123", "test:event", {});

    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof subscribeCallback).toBe("function");
  });

  it("sends broadcast with correct event and payload on SUBSCRIBED", async () => {
    const promise = broadcastBoardEvent("board-123", "access:revoked", {
      userId: "user-456",
    });

    // Simulate subscription success
    subscribeCallback!("SUBSCRIBED");

    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "access:revoked",
      payload: { userId: "user-456" },
    });

    // Advance past the 200ms cleanup delay
    vi.advanceTimersByTime(200);
    await promise;
  });

  it("removes the channel after sending (after 200ms delay)", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});

    subscribeCallback!("SUBSCRIBED");

    // Channel not removed yet (within 200ms window)
    expect(mockClient.removeChannel).not.toHaveBeenCalled();

    // Advance past cleanup delay
    vi.advanceTimersByTime(200);
    await promise;

    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("resolves the promise after cleanup", async () => {
    let resolved = false;

    const promise = broadcastBoardEvent("board-123", "test:event", {}).then(
      () => {
        resolved = true;
      }
    );

    subscribeCallback!("SUBSCRIBED");
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(200);
    await promise;

    expect(resolved).toBe(true);
  });

  it("cleans up and resolves on CLOSED status without sending", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});

    subscribeCallback!("CLOSED");
    await promise;

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("cleans up and resolves on CHANNEL_ERROR status without sending", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});

    subscribeCallback!("CHANNEL_ERROR");
    await promise;

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("cleans up and resolves on TIMED_OUT status without sending", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});

    subscribeCallback!("TIMED_OUT");
    await promise;

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("does not send or clean up on non-terminal statuses (e.g. CONNECTING)", () => {
    broadcastBoardEvent("board-123", "test:event", {});

    subscribeCallback!("CONNECTING");

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).not.toHaveBeenCalled();
  });

  it("handles board:deleted event with empty payload", async () => {
    const promise = broadcastBoardEvent("board-xyz", "board:deleted", {});

    subscribeCallback!("SUBSCRIBED");

    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "board:deleted",
      payload: {},
    });

    vi.advanceTimersByTime(200);
    await promise;
  });

  it("passes arbitrary payload through", async () => {
    const payload = { userId: "u1", extra: 42, nested: { a: true } };
    const promise = broadcastBoardEvent("b1", "custom:event", payload);

    subscribeCallback!("SUBSCRIBED");
    vi.advanceTimersByTime(200);
    await promise;

    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "custom:event",
      payload,
    });
  });
});
