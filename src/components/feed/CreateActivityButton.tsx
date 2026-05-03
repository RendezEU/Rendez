"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVITY_LABELS, ACTIVITY_EMOJIS } from "@/types";

const ACTIVITIES = Object.keys(ACTIVITY_LABELS);

export default function CreateActivityButton({ city }: { userId: string; city: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !title || !scheduledAt) return;
    setLoading(true);

    const res = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityCategory: category,
        title,
        scheduledAt,
        locationName: location,
        city,
      }),
    });

    if (res.ok) {
      setOpen(false);
      setTitle("");
      setCategory("");
      setScheduledAt("");
      setLocation("");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
      >
        + Post activity
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-t-2xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-stone-900 mb-4">Post an activity</h2>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-stone-700 block mb-2">Activity type</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {ACTIVITIES.slice(0, 9).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setCategory(a)}
                      className={`py-2 px-1 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1 justify-center ${
                        category === a
                          ? "bg-brand-600 text-white border-brand-600"
                          : "border-stone-200 text-stone-600"
                      }`}
                    >
                      {ACTIVITY_EMOJIS[a]} {ACTIVITY_LABELS[a]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-stone-700 block mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Morning run in the park"
                  required
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-stone-700 block mb-1">When</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  required
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-stone-700 block mb-1">Location (optional)</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Vondelpark"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <button
                type="submit"
                disabled={!category || !title || !scheduledAt || loading}
                className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {loading ? "Posting…" : "Post activity"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
