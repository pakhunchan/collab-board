"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useMachine } from "@xstate/react";
import {
  connectionMachine,
  type ChannelStatus as ChannelStatusType,
} from "@/machines/connectionMachine";

export type ConnectionStatus = "idle" | "connected" | "reconnecting" | "offline";

export function useConnectionManager() {
  const [reconnectKey, setReconnectKey] = useState(0);
  const onReconnectRef = useRef(() => {
    setReconnectKey((k) => k + 1);
  });

  const [snapshot, send] = useMachine(connectionMachine, {
    input: { onReconnect: () => onReconnectRef.current() },
  });

  const status = snapshot.value as ConnectionStatus;

  // Browser online/offline events
  useEffect(() => {
    const handleOnline = () => send({ type: "BROWSER_ONLINE" });
    const handleOffline = () => send({ type: "BROWSER_OFFLINE" });

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // If browser is already offline on mount, notify the machine
    if (!navigator.onLine) {
      send({ type: "BROWSER_OFFLINE" });
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [send]);

  const onChannelStatus = useCallback(
    (channelId: string, channelStatus: string) => {
      send({
        type: "CHANNEL_STATUS",
        channelId,
        status: channelStatus as ChannelStatusType,
      });
    },
    [send]
  );

  return { status, reconnectKey, onChannelStatus };
}
