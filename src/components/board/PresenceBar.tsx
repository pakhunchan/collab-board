"use client";

import { usePresenceStore } from "@/stores/presenceStore";

export default function PresenceBar() {
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

  if (onlineUsers.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {onlineUsers.map((user) => (
        <div
          key={user.uid}
          title={user.name}
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
          style={{ backgroundColor: user.color }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  );
}
