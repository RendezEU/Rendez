"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const INTENTS = [
  { key: "SERIOUS", label: "Something serious", desc: "Looking for a real relationship." },
  { key: "CASUAL", label: "Casual connection", desc: "Keep it light, see where it goes." },
  { key: "OPEN", label: "Open to anything", desc: "Let chemistry decide." },
];

export default function IntentPage() {
  const router = useRouter();
  const [intent, setIntent] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!intent) return;
    setLoading(true);
    const res = await fetch("/api/onboarding/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });
    if (res.ok) router.push("/onboarding/personality");
    else setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">What are you looking for?</h1>
        <p className="text-stone-500 mt-1 text-sm">We use this to find compatible matches.</p>
      </div>

      <div className="space-y-3">
        {INTENTS.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => setIntent(i.key)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
              intent === i.key
                ? "border-brand-500 bg-brand-50"
                : "border-stone-200 hover:border-stone-300"
            }`}
          >
            <div className="font-semibold text-stone-900">{i.label}</div>
            <div className="text-sm text-stone-500 mt-0.5">{i.desc}</div>
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={!intent || loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Saving…" : "Continue →"}
      </button>
    </form>
  );
}
