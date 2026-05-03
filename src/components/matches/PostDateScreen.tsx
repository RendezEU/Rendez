"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PostDateScreen({ matchId, otherName }: { matchId: string; otherName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"CONNECT" | "PASS" | null>(null);
  const [done, setDone] = useState(false);

  async function decide(decision: "CONNECT" | "PASS") {
    setLoading(decision);
    const res = await fetch(`/api/matches/${matchId}/post-date`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (res.ok) {
      setDone(true);
    }
    setLoading(null);
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="text-5xl mb-4">✓</div>
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Decision recorded</h1>
        <p className="text-stone-500 text-sm mb-6">
          If both of you chose Connect, you&apos;ll receive each other&apos;s contact details.
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="bg-brand-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
      <div className="text-5xl mb-4">🎉</div>
      <h1 className="text-2xl font-bold text-stone-900 mb-2">How did it go?</h1>
      <p className="text-stone-500 text-sm mb-8 max-w-xs">
        Your decision is private. Only if both of you choose Connect will you exchange contact details.
      </p>

      <div className="w-full max-w-xs space-y-3">
        <button
          onClick={() => decide("CONNECT")}
          disabled={!!loading}
          className="w-full bg-brand-600 text-white py-4 rounded-2xl font-semibold text-base hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading === "CONNECT" ? "…" : `Connect with ${otherName} ✓`}
        </button>
        <button
          onClick={() => decide("PASS")}
          disabled={!!loading}
          className="w-full border border-stone-200 text-stone-600 py-4 rounded-2xl font-semibold text-base hover:bg-stone-50 disabled:opacity-50 transition-colors"
        >
          {loading === "PASS" ? "…" : "Pass"}
        </button>
      </div>

      <p className="text-xs text-stone-400 mt-6 max-w-xs">
        Whatever you choose, further chat is disabled. Rendez is about real-world connections.
      </p>
    </div>
  );
}
