import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mock supabase channel ---

let subscribeCallback: ((status: string) => void) | null = null;

const mockChannel = {
  subscribe: vi.fn((cb: (status: string) => void) => {
    subscribeCallback = cb;
  }),
  send: vi.fn(),
};

const MOCK_NONCE = "test-nonce-uuid";

// Chainable mock for .from().select().eq().single()
const mockSingleResult = { data: { channel_nonce: MOCK_NONCE }, error: null };
const mockQueryChain = {
  select: vi.fn(() => mockQueryChain),
  eq: vi.fn(() => mockQueryChain),
  single: vi.fn(() => mockSingleResult),
};

const mockClient = {
  channel: vi.fn(() => mockChannel),
  removeChannel: vi.fn(),
  from: vi.fn(() => mockQueryChain),
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
  it("creates a channel with the correct name (including nonce from DB)", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", { key: "val" });

    // Wait for the async nonce fetch to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(mockClient.channel).toHaveBeenCalledWith(`board:board-123:${MOCK_NONCE}:objects`);

    subscribeCallback!("SUBSCRIBED");
    vi.advanceTimersByTime(200);
    await promise;
  });

  it("uses provided channelNonce without fetching from DB", async () => {
    const customNonce = "custom-nonce";
    const promise = broadcastBoardEvent("board-123", "test:event", {}, customNonce);

    // No need to advance timers for async — nonce is provided directly
    await vi.advanceTimersByTimeAsync(0);

    expect(mockClient.from).not.toHaveBeenCalled();
    expect(mockClient.channel).toHaveBeenCalledWith(`board:board-123:${customNonce}:objects`);

    subscribeCallback!("SUBSCRIBED");
    vi.advanceTimersByTime(200);
    await promise;
  });

  it("subscribes to the channel", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});
    await vi.advanceTimersByTimeAsync(0);

    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof subscribeCallback).toBe("function");

    subscribeCallback!("SUBSCRIBED");
    vi.advanceTimersByTime(200);
    await promise;
  });

  it("sends broadcast with correct event and payload on SUBSCRIBED", async () => {
    const promise = broadcastBoardEvent("board-123", "channel:rotated", {
      channelNonce: "new-nonce",
      revokedUserId: "user-456",
    });

    await vi.advanceTimersByTimeAsync(0);

    // Simulate subscription success
    subscribeCallback!("SUBSCRIBED");

    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "channel:rotated",
      payload: { channelNonce: "new-nonce", revokedUserId: "user-456" },
    });

    // Advance past the 200ms cleanup delay
    vi.advanceTimersByTime(200);
    await promise;
  });

  it("removes the channel after sending (after 200ms delay)", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});
    await vi.advanceTimersByTimeAsync(0);

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

    await vi.advanceTimersByTimeAsync(0);
    subscribeCallback!("SUBSCRIBED");
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(200);
    await promise;

    expect(resolved).toBe(true);
  });

  it("cleans up and resolves on CLOSED status without sending", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});
    await vi.advanceTimersByTimeAsync(0);

    subscribeCallback!("CLOSED");
    await promise;

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("cleans up and resolves on CHANNEL_ERROR status without sending", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});
    await vi.advanceTimersByTimeAsync(0);

    subscribeCallback!("CHANNEL_ERROR");
    await promise;

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("cleans up and resolves on TIMED_OUT status without sending", async () => {
    const promise = broadcastBoardEvent("board-123", "test:event", {});
    await vi.advanceTimersByTimeAsync(0);

    subscribeCallback!("TIMED_OUT");
    await promise;

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  it("does not send or clean up on non-terminal statuses (e.g. CONNECTING)", async () => {
    broadcastBoardEvent("board-123", "test:event", {});
    await vi.advanceTimersByTimeAsync(0);

    subscribeCallback!("CONNECTING");

    expect(mockChannel.send).not.toHaveBeenCalled();
    expect(mockClient.removeChannel).not.toHaveBeenCalled();
  });

  it("handles board:deleted event with empty payload", async () => {
    const promise = broadcastBoardEvent("board-xyz", "board:deleted", {});
    await vi.advanceTimersByTimeAsync(0);

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
    await vi.advanceTimersByTimeAsync(0);

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
