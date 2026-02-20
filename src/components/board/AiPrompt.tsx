"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

export default function AiPrompt({ boardId }: { boardId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!prompt.trim() || !user || loading) return;

      setLoading(true);
      setResponse(null);

      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/boards/${boardId}/ai`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt: prompt.trim() }),
        });

        const data = await res.json();

        if (!res.ok) {
          setResponse(`Error: ${data.error ?? "Request failed"}`);
        } else {
          setResponse(data.message);
          setPrompt("");
        }
      } catch {
        setResponse("Error: Failed to reach AI service");
      } finally {
        setLoading(false);
      }
    },
    [prompt, user, loading, boardId]
  );

  if (!open) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
        <button
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-full shadow-lg hover:bg-purple-700 transition-colors"
        >
          AI Assistant
        </button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
        {response && (
          <div
            className={`px-4 py-2 text-sm border-b ${
              response.startsWith("Error")
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {response}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-center gap-2 p-2">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask AI to modify the board..."
            disabled={loading}
            className="flex-1 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Send"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setResponse(null);
            }}
            className="px-2 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ✕
          </button>
        </form>
      </div>
    </div>
  );
}
