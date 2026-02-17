"use client";

import { useAuth } from "@/lib/auth-context";

export default function BoardPage({ params }: { params: { id: string } }) {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Board: {params.id}
            </h1>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
          <button
            onClick={signOut}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Sign Out
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-500">Board canvas will go here.</p>
        </div>
      </div>
    </div>
  );
}
