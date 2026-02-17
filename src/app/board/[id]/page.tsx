"use client";

import dynamic from "next/dynamic";
import Toolbar from "@/components/board/Toolbar";

const Canvas = dynamic(() => import("@/components/board/Canvas"), {
  ssr: false,
});

export default function BoardPage({ params }: { params: { id: string } }) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Toolbar boardId={params.id} />
      <div className="flex-1 relative">
        <Canvas />
      </div>
    </div>
  );
}
