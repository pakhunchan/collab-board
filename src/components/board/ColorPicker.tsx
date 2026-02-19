const COLORS = [
  "#FFEB3B",
  "#FF9800",
  "#F44336",
  "#E91E63",
  "#9C27B0",
  "#2196F3",
  "#4CAF50",
  "#90CAF9",
  "#CE93D8",
  "#FFFFFF",
];

interface ColorPickerProps {
  currentColor?: string;
  onChange: (color: string) => void;
}

export default function ColorPicker({ currentColor, onChange }: ColorPickerProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 6,
        padding: "6px 10px",
        background: "rgba(255,255,255,0.95)",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        zIndex: 10,
      }}
    >
      {COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: color,
            border: currentColor === color ? "2px solid #333" : "2px solid #ccc",
            cursor: "pointer",
            padding: 0,
            outline: "none",
          }}
        />
      ))}
    </div>
  );
}
