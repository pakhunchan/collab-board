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
  const { status, reconnectKey, onChannelStatus } = useConnectionManager();
  const [access, setAccess] = useState<"loading" | "granted" | "denied">(
    "loading"
  );

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
        if (!cancelled) setAccess(res.ok ? "granted" : "denied");
      } catch {
        if (!cancelled) setAccess("denied");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, params.id]);

  // Server-driven revocation: called when the Realtime channel receives
  // an access:revoked or board:deleted event
  const onAccessRevoked = useCallback(() => {
    setAccess("denied");
  }, []);

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
        <Canvas
          boardId={params.id}
          reconnectKey={reconnectKey}
          onChannelStatus={onChannelStatus}
          onAccessRevoked={onAccessRevoked}
          onMemberJoined={onMemberJoined}
        />
        <AiPrompt boardId={params.id} />
      </div>
    </div>
  );
}
