export interface Board {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface BoardCard {
  id: string;
  boardId: string;
  content: string;
  authorId: string;
  position: { x: number; y: number };
  createdAt: number;
  updatedAt: number;
}
