"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RequestMatchButton({ activityId, alreadyRequested }: { activityId: string; alreadyRequested: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(alreadyRequested);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showInput, setShowInput] = useState(false);

  async function sendRequest() {
    setLoading(true);
    const res = await fetch(`/api/feed/${activityId}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message || undefined }),
    });
    if (res.ok) {
      setDone(true);
      router.refresh();
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <span className="text-sm text-stone-400">Request sent ✓ — they&apos;ll be notified.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showInput && (
        <div>
          <label className="text-sm font-medium text-stone-700 block mb-1">
            Optional intro (counts as 1 of your 5 messages)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Hi! I'd love to join for this…"
            maxLength={200}
            rows={2}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </div>
      )}

      <button
        onClick={showInput ? sendRequest : () => setShowInput(true)}
        disabled={loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Sending…" : showInput ? "Send request" : "Request to join"}
      </button>

      {showInput && (
        <button onClick={() => setShowInput(false)} className="w-full text-sm text-stone-400 hover:text-stone-600">
          Cancel
        </button>
      )}
    </div>
  );
}
