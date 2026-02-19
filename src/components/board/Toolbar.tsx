"use client";

import { useState, type MutableRefObject } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useBoardStore, Tool } from "@/stores/boardStore";
import PresenceBar from "@/components/board/PresenceBar";
import ConnectionStatusIndicator from "@/components/board/ConnectionStatus";
import SharePanel from "@/components/board/SharePanel";
import type { ConnectionStatus } from "@/hooks/useConnectionManager";

type JoinedMember = { user_id: string; display_name: string | null; role: string; joined_at: string };

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: "select", label: "Select", icon: "↖" },
  { id: "pan", label: "Pan", icon: "✋" },
  { id: "sticky", label: "Sticky Note", icon: "▢" },
  { id: "rectangle", label: "Rectangle", icon: "□" },
  { id: "circle", label: "Circle", icon: "○" },
  { id: "line", label: "Line", icon: "╱" },
  { id: "text", label: "Text", icon: "T" },
  { id: "connector", label: "Connector", icon: "→" },
  { id: "frame", label: "Frame", icon: "⬒" },
];

export default function Toolbar({
  boardId,
  connectionStatus,
  memberJoinedRef,
}: {
  boardId: string;
  connectionStatus: ConnectionStatus;
  memberJoinedRef?: MutableRefObject<((m: JoinedMember) => void) | null>;
}) {
  const activeTool = useBoardStore((s) => s.activeTool);
  const setActiveTool = useBoardStore((s) => s.setActiveTool);
  const { signOut } = useAuth();
  const [showShare, setShowShare] = useState(false);

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
      <div className="flex items-center gap-1">
        <Link
          href="/boards"
          className="w-9 h-9 flex items-center justify-center rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          title="Back to boards"
        >
          ←
        </Link>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            title={tool.label}
            className={`w-9 h-9 flex items-center justify-center rounded-md text-sm transition-colors ${
              activeTool === tool.id
                ? "bg-blue-100 text-blue-700"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <ConnectionStatusIndicator status={connectionStatus} />
        <PresenceBar />
        <span className="text-xs text-gray-400 font-mono">{boardId}</span>
        <button
          onClick={() => setShowShare(true)}
          className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-white border border-blue-300 rounded-md hover:bg-blue-50"
        >
          Share
        </button>
        <button
          onClick={signOut}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Sign Out
        </button>
      </div>
      {showShare && (
        <SharePanel boardId={boardId} onClose={() => setShowShare(false)} memberJoinedRef={memberJoinedRef} />
      )}
    </div>
  );
}
