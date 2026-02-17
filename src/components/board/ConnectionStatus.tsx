import type { ConnectionStatus as ConnectionStatusType } from "@/hooks/useConnectionManager";

const config: Record<
  ConnectionStatusType,
  { color: string; pulse: boolean; label: string }
> = {
  idle: { color: "bg-gray-400", pulse: false, label: "Connecting" },
  connected: { color: "bg-green-500", pulse: false, label: "Connected" },
  reconnecting: { color: "bg-yellow-500", pulse: true, label: "Reconnecting" },
  offline: { color: "bg-red-500", pulse: false, label: "Offline" },
};

export default function ConnectionStatus({
  status,
}: {
  status: ConnectionStatusType;
}) {
  const { color, pulse, label } = config[status];

  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span
        className={`inline-block w-2 h-2 rounded-full ${color} ${
          pulse ? "animate-pulse" : ""
        }`}
      />
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}
