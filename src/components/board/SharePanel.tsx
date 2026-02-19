"use client";

import { useState, useEffect, useCallback, type MutableRefObject } from "react";
import { useAuth } from "@/lib/auth-context";

interface Invite {
  id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

interface Member {
  user_id: string;
  display_name: string | null;
  role: string;
  joined_at: string;
}

export default function SharePanel({
  boardId,
  onClose,
  memberJoinedRef,
}: {
  boardId: string;
  onClose: () => void;
  memberJoinedRef?: MutableRefObject<((m: Member) => void) | null>;
}) {
  const { user } = useAuth();
  const [isOwner, setIsOwner] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [expiresIn, setExpiresIn] = useState<"3h" | "1d" | "3d">("1d");
  const [generating, setGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedBoardLink, setCopiedBoardLink] = useState(false);
  const [loading, setLoading] = useState(true);

  const getToken = useCallback(async () => {
    if (!user) return "";
    return user.getIdToken();
  }, [user]);

  const fetchData = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const headers = { Authorization: `Bearer ${token}` };

    // Fetch board to get visibility
    const boardRes = await fetch(`/api/boards/${boardId}`, { headers });
    if (boardRes.ok) {
      const boardData = await boardRes.json();
      setVisibility(boardData.visibility);
    }

    // Fetch members (any board member can do this)
    const membersRes = await fetch(`/api/boards/${boardId}/members`, {
      headers,
    });
    if (membersRes.ok) {
      const membersData = await membersRes.json();
      setMembers(membersData);

      // Check if current user is owner
      const currentMember = membersData.find(
        (m: Member) => m.user_id === user?.uid
      );
      const ownerStatus = currentMember?.role === "owner";
      setIsOwner(ownerStatus);

      // Fetch invites only if owner
      if (ownerStatus) {
        const invitesRes = await fetch(`/api/boards/${boardId}/invites`, {
          headers,
        });
        if (invitesRes.ok) {
          setInvites(await invitesRes.json());
        }
      }
    }

    setLoading(false);
  }, [boardId, getToken, user?.uid]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Register handler for real-time member:joined events via the shared channel
  useEffect(() => {
    if (!memberJoinedRef) return;
    memberJoinedRef.current = (member: Member) => {
      setMembers((prev) => {
        if (prev.some((m) => m.user_id === member.user_id)) return prev;
        return [...prev, member];
      });
    };
    return () => {
      memberJoinedRef.current = null;
    };
  }, [memberJoinedRef]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/boards/${boardId}/invites`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn }),
      });
      if (res.ok) {
        await fetchData();
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    const token = await getToken();
    await fetch(`/api/boards/${boardId}/invites/${inviteId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setInvites((prev) => prev.filter((i) => i.id !== inviteId));
  };

  const handleRemoveMember = async (userId: string) => {
    const token = await getToken();
    const res = await fetch(`/api/boards/${boardId}/members/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    }
  };

  const copyLink = async (inviteToken: string) => {
    const url = `${window.location.origin}/invite/${inviteToken}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(inviteToken);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const copyBoardLink = async () => {
    const url = `${window.location.origin}/board/${boardId}`;
    await navigator.clipboard.writeText(url);
    setCopiedBoardLink(true);
    setTimeout(() => setCopiedBoardLink(false), 2000);
  };

  const formatExpiry = (dateStr: string) => {
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 24) return `${hours}h remaining`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h remaining`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-20 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Share Board</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            {/* Public board: simple copy link */}
            {visibility === "public" && (
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Board Link
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  This board is public. Anyone with the link can access it.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/board/${boardId}`}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 bg-gray-50 truncate"
                  />
                  <button
                    onClick={copyBoardLink}
                    className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                  >
                    {copiedBoardLink ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {/* Private board: invite link section — owner only */}
            {visibility === "private" && isOwner && (
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Invite Link
                </h3>
                <div className="flex gap-2 mb-3">
                  <select
                    value={expiresIn}
                    onChange={(e) =>
                      setExpiresIn(e.target.value as "3h" | "1d" | "3d")
                    }
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="3h">3 hours</option>
                    <option value="1d">1 day</option>
                    <option value="3d">3 days</option>
                  </select>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {generating ? "..." : "Generate Link"}
                  </button>
                </div>

                {invites.length > 0 && (
                  <div className="space-y-2">
                    {invites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2"
                      >
                        <div className="text-xs text-gray-500 min-w-0">
                          <span className="font-mono truncate block">
                            ...{invite.token.slice(-8)}
                          </span>
                          <span>{formatExpiry(invite.expires_at)}</span>
                        </div>
                        <div className="flex gap-1 shrink-0 ml-2">
                          <button
                            onClick={() => copyLink(invite.token)}
                            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                          >
                            {copiedToken === invite.token ? "Copied!" : "Copy"}
                          </button>
                          <button
                            onClick={() => handleRevoke(invite.id)}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Members section */}
            <div className="px-5 py-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Members ({members.length})
              </h3>
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="flex items-center justify-between py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-gray-900 truncate">
                        {member.display_name || member.user_id}
                      </span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          member.role === "owner"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {member.role}
                      </span>
                    </div>
                    {isOwner &&
                      member.role !== "owner" &&
                      member.user_id !== user?.uid && (
                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          className="text-xs text-red-500 hover:text-red-700 shrink-0"
                        >
                          Remove
                        </button>
                      )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
