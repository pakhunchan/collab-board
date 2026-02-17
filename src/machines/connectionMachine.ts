import { setup, assign, enqueueActions, not } from "xstate";
import { toast } from "sonner";

export type ChannelStatus =
  | "SUBSCRIBED"
  | "CLOSED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT";

type ConnectionEvent =
  | { type: "CHANNEL_STATUS"; channelId: string; status: ChannelStatus }
  | { type: "BROWSER_OFFLINE" }
  | { type: "BROWSER_ONLINE" };

interface ConnectionContext {
  retryCount: number;
  maxRetries: number;
  channelStatuses: Record<string, ChannelStatus>;
  hasConnectedBefore: boolean;
  browserOnline: boolean;
  onReconnect: () => void;
}

function allChannelsSubscribed(statuses: Record<string, ChannelStatus>) {
  const values = Object.values(statuses);
  return values.length >= 2 && values.every((s) => s === "SUBSCRIBED");
}

function anyChannelDown(statuses: Record<string, ChannelStatus>) {
  return Object.values(statuses).some(
    (s) => s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT"
  );
}

export const connectionMachine = setup({
  types: {
    context: {} as ConnectionContext,
    events: {} as ConnectionEvent,
    input: {} as { onReconnect: () => void },
  },
  delays: {
    backoff: ({ context }) => Math.min(1000 * Math.pow(2, context.retryCount), 16000),
  },
  actions: {
    updateChannelStatus: assign({
      channelStatuses: ({ context, event }) => {
        if (event.type !== "CHANNEL_STATUS") return context.channelStatuses;
        return { ...context.channelStatuses, [event.channelId]: event.status };
      },
    }),
    resetRetryCount: assign({ retryCount: 0 }),
    setBrowserOnline: assign({ browserOnline: true }),
    setBrowserOffline: assign({ browserOnline: false }),
    incrementRetryCount: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),
    markConnected: assign({ hasConnectedBefore: true }),
    toastDisconnected: () => {
      toast.warning("Connection lost. Reconnecting...");
    },
    toastReconnected: () => {
      toast.success("Reconnected");
    },
    toastOffline: () => {
      toast.error("Offline. Changes may not sync.");
    },
    triggerReconnect: ({ context }) => {
      context.onReconnect();
    },
  },
  guards: {
    allSubscribed: ({ context, event }) => {
      if (event.type !== "CHANNEL_STATUS") return false;
      const next = {
        ...context.channelStatuses,
        [event.channelId]: event.status,
      };
      return allChannelsSubscribed(next);
    },
    anyDown: ({ context, event }) => {
      if (event.type !== "CHANNEL_STATUS") return false;
      const next = {
        ...context.channelStatuses,
        [event.channelId]: event.status,
      };
      return anyChannelDown(next);
    },
    hasConnectedBefore: ({ context }) => context.hasConnectedBefore,
    isBrowserOnline: ({ context }) => context.browserOnline,
    maxRetriesExceeded: ({ context }) =>
      context.retryCount >= context.maxRetries,
  },
}).createMachine({
  id: "connection",
  context: ({ input }) => ({
    retryCount: 0,
    maxRetries: 5,
    channelStatuses: {},
    hasConnectedBefore: false,
    browserOnline: true,
    onReconnect: input.onReconnect,
  }),
  initial: "idle",
  states: {
    idle: {
      on: {
        CHANNEL_STATUS: [
          {
            guard: "allSubscribed",
            target: "connected",
            actions: ["updateChannelStatus", "markConnected"],
          },
          { actions: ["updateChannelStatus"] },
        ],
      },
    },
    connected: {
      on: {
        CHANNEL_STATUS: [
          {
            guard: "anyDown",
            target: "reconnecting",
            actions: ["updateChannelStatus"],
          },
          { actions: ["updateChannelStatus"] },
        ],
        BROWSER_OFFLINE: {
          target: "reconnecting",
          actions: ["setBrowserOffline"],
        },
      },
    },
    reconnecting: {
      entry: enqueueActions(({ context, enqueue }) => {
        if (context.hasConnectedBefore) {
          enqueue("toastDisconnected");
        }
      }),
      after: {
        backoff: [
          {
            guard: not("isBrowserOnline"),
            target: "offline",
          },
          {
            guard: "maxRetriesExceeded",
            target: "offline",
          },
          {
            target: "reconnecting",
            reenter: true,
            actions: ["incrementRetryCount", "triggerReconnect"],
          },
        ],
      },
      on: {
        CHANNEL_STATUS: [
          {
            guard: "allSubscribed",
            target: "connected",
            actions: [
              "updateChannelStatus",
              "resetRetryCount",
              "markConnected",
              "toastReconnected",
            ],
          },
          { actions: ["updateChannelStatus"] },
        ],
        BROWSER_ONLINE: {
          target: "reconnecting",
          reenter: true,
          actions: ["setBrowserOnline", "resetRetryCount"],
        },
      },
    },
    offline: {
      entry: ["toastOffline"],
      on: {
        BROWSER_ONLINE: {
          target: "reconnecting",
          actions: ["setBrowserOnline", "resetRetryCount"],
        },
      },
    },
  },
});
