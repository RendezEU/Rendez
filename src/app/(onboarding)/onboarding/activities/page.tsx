"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVITY_LABELS, ACTIVITY_EMOJIS } from "@/types";

const ACTIVITIES = Object.keys(ACTIVITY_LABELS);

export default function ActivitiesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function toggle(a: string) {
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length < 2) return;
    setLoading(true);
    const res = await fetch("/api/onboarding/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredActivities: selected }),
    });
    if (res.ok) router.push("/onboarding/availability");
    else setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">What do you enjoy?</h1>
        <p className="text-stone-500 mt-1 text-sm">Pick at least 2. We match on these.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ACTIVITIES.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => toggle(a)}
            className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-sm ${
              selected.includes(a)
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-stone-200 text-stone-600 hover:border-stone-300"
            }`}
          >
            <span className="text-2xl">{ACTIVITY_EMOJIS[a]}</span>
            <span className="font-medium leading-tight text-center text-xs">
              {ACTIVITY_LABELS[a]}
            </span>
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={selected.length < 2 || loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Saving…" : `Continue → (${selected.length} selected)`}
      </button>
    </form>
  );
}
