"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface BoardListItem {
  id: string;
  name: string;
  visibility: string;
  created_by: string;
  created_at: string;
  role: string | null;
}

export default function BoardsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create board form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newVisibility, setNewVisibility] = useState<"public" | "private">("public");
  const [creating, setCreating] = useState(false);

  const fetchBoards = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/boards", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load boards");
      const data = await res.json();
      setBoards(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load boards");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newName.trim()) return;

    setCreating(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName.trim(), visibility: newVisibility }),
      });
      if (!res.ok) throw new Error("Failed to create board");
      const board = await res.json();
      router.push(`/board/${board.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">My Boards</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{user?.email}</span>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Board
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Create board modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Board</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label htmlFor="board-name" className="block text-sm font-medium text-gray-700">
                    Board Name
                  </label>
                  <input
                    id="board-name"
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="My Board"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Visibility
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setNewVisibility("public")}
                      className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                        newVisibility === "public"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewVisibility("private")}
                      className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                        newVisibility === "private"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Private
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {newVisibility === "public"
                      ? "Anyone with an account can view and edit this board."
                      : "Only invited members can access this board."}
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate(false);
                      setNewName("");
                      setNewVisibility("public");
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !newName.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Board grid */}
        {boards.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-4">No boards yet. Create your first board to get started.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Board
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => router.push(`/board/${board.id}`)}
                className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:border-blue-300 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-900 truncate pr-2">{board.name}</h3>
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                      board.visibility === "private"
                        ? "bg-gray-100 text-gray-600"
                        : "bg-green-50 text-green-700"
                    }`}
                  >
                    {board.visibility}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  {board.role && (
                    <span className="capitalize">{board.role}</span>
                  )}
                  <span>
                    {new Date(board.created_at).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
