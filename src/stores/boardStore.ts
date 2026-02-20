import { create } from "zustand";
import { BoardObject, BoardObjectType } from "@/types/board";

export type Tool = "select" | "pan" | "sticky" | "rectangle" | "circle" | "line" | "text" | "connector" | "frame";

const DEFAULT_COLORS: Record<BoardObjectType, string> = {
  sticky: "#FFEB3B",
  rectangle: "#90CAF9",
  circle: "#CE93D8",
  line: "#666666",
  text: "#333333",
  connector: "#666666",
  frame: "#4A90D9",
};

const DEFAULT_SIZES: Record<BoardObjectType, { width: number; height: number }> = {
  sticky: { width: 200, height: 200 },
  rectangle: { width: 240, height: 160 },
  circle: { width: 160, height: 160 },
  line: { width: 200, height: 0 },
  text: { width: 200, height: 40 },
  connector: { width: 0, height: 0 },
  frame: { width: 400, height: 300 },
};

interface BoardStore {
  // Tool state
  activeTool: Tool;
  setActiveTool: (tool: Tool) => void;

  // Objects
  objects: Record<string, BoardObject>;
  addObject: (type: BoardObjectType, x: number, y: number) => BoardObject;
  updateObject: (id: string, changes: Partial<BoardObject>) => void;
  deleteObject: (id: string) => void;

  // Remote-apply (no re-broadcast)
  applyRemoteCreate: (obj: BoardObject) => void;
  applyRemoteUpdate: (id: string, changes: Partial<BoardObject>) => void;
  applyRemoteDelete: (id: string) => void;
  applyRemoteBatchUpdate: (updates: Array<{ objectId: string; changes: Partial<BoardObject> }>) => void;

  // Persistence
  loadObjects: (objects: BoardObject[]) => void;
  reconcileObjects: (remoteObjects: BoardObject[]) => BoardObject[];

  // Connectors
  getConnectorsForObject: (objectId: string) => string[];

  // Frames
  getFrameChildren: (frameId: string) => BoardObject[];

  // Selection
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  activeTool: "select",
  setActiveTool: (tool) => set({ activeTool: tool }),

  objects: {},
  addObject: (type, x, y) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const size = DEFAULT_SIZES[type];
    const obj: BoardObject = {
      id,
      boardId: "",
      type,
      x: x - size.width / 2,
      y: y - size.height / 2,
      width: size.width,
      height: size.height,
      rotation: 0,
      ...(type === "text" ? { text: "Text" } : type === "frame" ? { text: "Frame" } : {}),
      color: DEFAULT_COLORS[type],
      zIndex: type === "frame" ? -1 : Object.keys(get().objects).length,
      properties: {},
      createdBy: "",
      updatedAt: now,
      createdAt: now,
    };
    set((state) => ({
      objects: { ...state.objects, [id]: obj },
    }));
    return obj;
  },
  updateObject: (id, changes) =>
    set((state) => {
      const existing = state.objects[id];
      if (!existing) return state;
      return {
        objects: {
          ...state.objects,
          [id]: { ...existing, ...changes, updatedAt: new Date().toISOString() },
        },
      };
    }),
  deleteObject: (id) =>
    set((state) => {
      const next = { ...state.objects };
      delete next[id];
      return {
        objects: next,
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
      };
    }),

  applyRemoteCreate: (obj) =>
    set((state) => ({
      objects: { ...state.objects, [obj.id]: obj },
    })),
  applyRemoteUpdate: (id, changes) =>
    set((state) => {
      const existing = state.objects[id];
      if (!existing) return state;
      return {
        objects: {
          ...state.objects,
          [id]: { ...existing, ...changes },
        },
      };
    }),
  applyRemoteDelete: (id) =>
    set((state) => {
      const next = { ...state.objects };
      delete next[id];
      return {
        objects: next,
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
      };
    }),
  applyRemoteBatchUpdate: (updates) =>
    set((state) => {
      let newObjects = state.objects;
      let changed = false;
      for (const { objectId, changes } of updates) {
        const existing = newObjects[objectId];
        if (!existing) continue;
        if (!changed) {
          newObjects = { ...newObjects };
          changed = true;
        }
        newObjects[objectId] = { ...existing, ...changes };
      }
      return changed ? { objects: newObjects } : state;
    }),

  loadObjects: (objects) => {
    const map: Record<string, BoardObject> = {};
    for (const obj of objects) {
      map[obj.id] = obj;
    }
    set({ objects: map, selectedIds: [] });
  },

  reconcileObjects: (remoteObjects) => {
    const local = get().objects;
    const remoteMap: Record<string, BoardObject> = {};
    for (const obj of remoteObjects) {
      remoteMap[obj.id] = obj;
    }

    // Merge: remote wins by default, but local wins if updatedAt is newer
    const merged: Record<string, BoardObject> = { ...remoteMap };
    for (const [id, localObj] of Object.entries(local)) {
      const remoteObj = remoteMap[id];
      if (remoteObj) {
        // Both exist: newer updatedAt wins
        if (localObj.updatedAt > remoteObj.updatedAt) {
          merged[id] = localObj;
        }
      } else {
        // Local-only: preserve (created offline)
        merged[id] = localObj;
      }
    }

    // Collect local-only objects to persist
    const localOnly = Object.values(local).filter((obj) => !remoteMap[obj.id]);

    set({ objects: merged });
    return localOnly;
  },

  getConnectorsForObject: (objectId) => {
    return Object.values(get().objects)
      .filter((o) => o.type === "connector" && (o.properties.fromId === objectId || o.properties.toId === objectId))
      .map((o) => o.id);
  },

  getFrameChildren: (frameId) => {
    return Object.values(get().objects).filter(
      (o) => o.properties?.parentFrameId === frameId
    );
  },

  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),
}));
