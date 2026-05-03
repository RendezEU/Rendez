"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MatchDecision({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"yes" | "no" | null>(null);
  const [done, setDone] = useState(false);

  async function decide(accept: boolean) {
    setLoading(accept ? "yes" : "no");
    const res = await fetch(`/api/matches/${matchId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept }),
    });
    if (res.ok) {
      setDone(true);
      router.refresh();
    } else {
      setLoading(null);
    }
  }

  if (done) {
    return <div className="text-center text-sm text-stone-400 py-2">Decision recorded ✓</div>;
  }

  return (
    <div className="flex gap-3">
      <button
        onClick={() => decide(false)}
        disabled={!!loading}
        className="flex-1 py-2.5 border border-stone-200 text-stone-600 rounded-xl text-sm font-medium hover:bg-stone-50 disabled:opacity-50 transition-colors"
      >
        {loading === "no" ? "…" : "Pass"}
      </button>
      <button
        onClick={() => decide(true)}
        disabled={!!loading}
        className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading === "yes" ? "…" : "Yes, let's Rendez! ✓"}
      </button>
    </div>
  );
}
