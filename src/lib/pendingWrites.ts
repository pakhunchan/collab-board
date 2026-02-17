import { BoardObject } from "@/types/board";

export type PendingWrite =
  | { type: "create"; object: BoardObject }
  | { type: "update"; objectId: string; changes: Partial<BoardObject> }
  | { type: "delete"; objectId: string };

function storageKey(boardId: string): string {
  return `pending-writes:${boardId}`;
}

export function getPendingWrites(boardId: string): PendingWrite[] {
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (!raw) return [];
    return JSON.parse(raw) as PendingWrite[];
  } catch {
    return [];
  }
}

export function addPendingWrite(boardId: string, write: PendingWrite): void {
  const writes = getPendingWrites(boardId);
  writes.push(write);
  try {
    localStorage.setItem(storageKey(boardId), JSON.stringify(writes));
  } catch {
    // localStorage full or unavailable — drop silently
  }
}

export function clearPendingWrites(boardId: string): void {
  try {
    localStorage.removeItem(storageKey(boardId));
  } catch {
    // ignore
  }
}
