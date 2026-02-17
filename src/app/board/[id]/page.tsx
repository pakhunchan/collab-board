"use client";

import dynamic from "next/dynamic";
import Toolbar from "@/components/board/Toolbar";
import { useConnectionManager } from "@/hooks/useConnectionManager";

const Canvas = dynamic(() => import("@/components/board/Canvas"), {
  ssr: false,
});

export default function BoardPage({ params }: { params: { id: string } }) {
  const { status, reconnectKey, onChannelStatus } = useConnectionManager();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Toolbar boardId={params.id} connectionStatus={status} />
      <div className="flex-1 relative">
        <Canvas
          boardId={params.id}
          reconnectKey={reconnectKey}
          onChannelStatus={onChannelStatus}
        />
      </div>
    </div>
  );
}
