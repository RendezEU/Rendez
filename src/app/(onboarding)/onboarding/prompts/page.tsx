"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROFILE_PROMPTS } from "@/types";

export default function PromptsPage() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function setAnswer(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  const answeredCount = Object.values(answers).filter((v) => v.trim().length > 0).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (answeredCount < 3) return;
    setLoading(true);

    const answerData = PROFILE_PROMPTS
      .filter((p) => answers[p.key]?.trim())
      .map((p, i) => ({ promptKey: p.key, answer: answers[p.key].trim(), displayOrder: i }));

    const res = await fetch("/api/onboarding/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: answerData }),
    });
    if (res.ok) router.push("/dashboard");
    else setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Complete your profile</h1>
        <p className="text-stone-500 mt-1 text-sm">
          Answer at least 3 prompts. These replace small talk — one prompt is shown to each match.
        </p>
      </div>

      <div className="space-y-4">
        {PROFILE_PROMPTS.map((prompt) => (
          <div key={prompt.key} className="bg-white border border-stone-200 rounded-xl p-4">
            <label className="text-sm font-medium text-stone-700 block mb-2">
              {prompt.question}
            </label>
            <textarea
              value={answers[prompt.key] || ""}
              onChange={(e) => setAnswer(prompt.key, e.target.value)}
              placeholder="Your answer…"
              maxLength={200}
              rows={2}
              className="w-full text-sm text-stone-800 resize-none focus:outline-none placeholder:text-stone-300"
            />
            {answers[prompt.key] && (
              <div className="text-xs text-stone-400 text-right mt-1">
                {answers[prompt.key].length}/200
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="submit"
        disabled={answeredCount < 3 || loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Finishing…" : `Complete profile (${answeredCount}/3 minimum) →`}
      </button>
    </form>
  );
}
