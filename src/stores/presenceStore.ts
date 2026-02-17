import { create } from "zustand";

export interface OnlineUser {
  uid: string;
  name: string;
  color: string;
}

interface PresenceStore {
  onlineUsers: OnlineUser[];
  setOnlineUsers: (users: OnlineUser[]) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  onlineUsers: [],
  setOnlineUsers: (users) => set({ onlineUsers: users }),
}));
