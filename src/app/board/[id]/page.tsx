"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Toolbar from "@/components/board/Toolbar";
import AiPrompt from "@/components/board/AiPrompt";
import { useAuth } from "@/lib/auth-context";
import { useConnectionManager } from "@/hooks/useConnectionManager";

const Canvas = dynamic(() => import("@/components/board/Canvas"), {
  ssr: false,
});

export default function BoardPage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const { status, reconnectKey, onChannelStatus, resetChannels } = useConnectionManager();
  const [access, setAccess] = useState<"loading" | "granted" | "denied">(
    "loading"
  );
  const [channelNonce, setChannelNonce] = useState<string | null>(null);

  // Initial one-time access check (prevents unauthorized mount)
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/boards/${params.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) {
          if (res.ok) {
            const board = await res.json();
            setChannelNonce(board.channel_nonce);
            setAccess("granted");
          } else {
            setAccess("denied");
          }
        }
      } catch {
        if (!cancelled) setAccess("denied");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, params.id]);

  // Server-driven revocation: called when the Realtime channel receives
  // a channel:rotated (for the revoked user) or board:deleted event
  const onAccessRevoked = useCallback(() => {
    setAccess("denied");
  }, []);

  // Channel rotation: called when a different user is revoked —
  // we reconnect to the new channel nonce
  const onChannelRotated = useCallback((nonce: string) => {
    resetChannels();
    setChannelNonce(nonce);
  }, [resetChannels]);

  // Forward member:joined events from the Realtime channel to SharePanel.
  // Uses a ref so the callback identity is stable (avoids channel reconnects).
  type JoinedMember = { user_id: string; display_name: string | null; role: string; joined_at: string };
  const memberJoinedRef = useRef<((m: JoinedMember) => void) | null>(null);
  const onMemberJoined = useCallback((member: JoinedMember) => {
    memberJoinedRef.current?.(member);
  }, []);

  if (access === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
        <p className="text-gray-600">
          You don&apos;t have permission to view this board.
        </p>
        <Link
          href="/boards"
          className="text-blue-600 hover:text-blue-800 underline"
        >
          Back to boards
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Toolbar boardId={params.id} connectionStatus={status} memberJoinedRef={memberJoinedRef} />
      <div className="flex-1 relative">
        {channelNonce && (
          <Canvas
            boardId={params.id}
            channelNonce={channelNonce}
            reconnectKey={reconnectKey}
            onChannelStatus={onChannelStatus}
            onAccessRevoked={onAccessRevoked}
            onChannelRotated={onChannelRotated}
            onMemberJoined={onMemberJoined}
          />
        )}
        <AiPrompt boardId={params.id} />
      </div>
    </div>
  );
}
