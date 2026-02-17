export const CURSOR_COLORS = [
  "#e53935", "#8e24aa", "#3949ab", "#039be5", "#00897b",
  "#43a047", "#c0ca33", "#ffb300", "#f4511e", "#6d4c41",
];

export function uidToColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = ((hash << 5) - hash + uid.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}
