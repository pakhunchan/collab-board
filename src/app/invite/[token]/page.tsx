"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function InvitePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push(`/auth/login?invite=${params.token}`);
      return;
    }

    if (accepting) return;
    setAccepting(true);

    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/invites/${params.token}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to accept invite");
          return;
        }
        router.push(`/board/${data.boardId}`);
      } catch {
        setError("Failed to accept invite");
      }
    })();
  }, [user, loading, params.token, router, accepting]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      {error ? (
        <div className="text-center space-y-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg">
            {error}
          </div>
          <button
            onClick={() => router.push("/boards")}
            className="text-sm text-blue-600 hover:text-blue-500"
          >
            Go to My Boards
          </button>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          <p className="text-gray-600">Accepting invite...</p>
        </div>
      )}
    </div>
  );
}
