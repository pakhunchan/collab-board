"use client";

import { useAuth } from "@/lib/auth-context";
import { useBoardStore, Tool } from "@/stores/boardStore";

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: "select", label: "Select", icon: "↖" },
  { id: "pan", label: "Pan", icon: "✋" },
  { id: "sticky", label: "Sticky Note", icon: "▢" },
  { id: "rectangle", label: "Rectangle", icon: "□" },
];

export default function Toolbar({ boardId }: { boardId: string }) {
  const activeTool = useBoardStore((s) => s.activeTool);
  const setActiveTool = useBoardStore((s) => s.setActiveTool);
  const { signOut } = useAuth();

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shrink-0">
      <div className="flex items-center gap-1">
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
        <span className="text-xs text-gray-400 font-mono">{boardId}</span>
        <button
          onClick={signOut}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
