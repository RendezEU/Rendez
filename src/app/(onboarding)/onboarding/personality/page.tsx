"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PersonalityPage() {
  const router = useRouter();
  const [score, setScore] = useState(5);
  const [loading, setLoading] = useState(false);

  const label =
    score <= 2 ? "Strong introvert"
    : score <= 4 ? "More introverted"
    : score === 5 ? "Right in the middle"
    : score <= 7 ? "More extroverted"
    : "Strong extrovert";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/onboarding/personality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personalityScore: score }),
    });
    if (res.ok) router.push("/onboarding/activities");
    else setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Your social energy</h1>
        <p className="text-stone-500 mt-1 text-sm">We match you with people whose energy complements yours.</p>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl p-6 text-center space-y-4">
        <div className="flex justify-between text-xs text-stone-400">
          <span>Introvert</span>
          <span>Extrovert</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="w-full accent-brand-600"
        />
        <div className="text-lg font-semibold text-stone-900">{label}</div>
        <div className="text-sm text-stone-400">{score} / 10</div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Saving…" : "Continue →"}
      </button>
    </form>
  );
}
