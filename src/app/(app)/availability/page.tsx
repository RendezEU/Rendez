"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS = [
  { key: "MORNING", label: "8–12" },
  { key: "AFTERNOON", label: "12–4" },
  { key: "EVENING", label: "4–8" },
  { key: "NIGHT", label: "8–11pm" },
];

export default function AvailabilityPage() {
  const router = useRouter();
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding/availability")
      .then((r) => r.json())
      .then((data: { dayOfWeek: string; timeBlock: string }[]) => {
        if (Array.isArray(data)) {
          setSlots(new Set(data.map((s) => `${s.dayOfWeek}-${s.timeBlock}`)));
        }
      });
  }, []);

  function toggleSlot(day: string, block: string) {
    const key = `${day}-${block}`;
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (slots.size === 0) return;
    setLoading(true);
    const slotData = Array.from(slots).map((key) => {
      const [day, block] = key.split("-");
      return { dayOfWeek: day, timeBlock: block, isRecurring: true };
    });
    await fetch("/api/onboarding/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots: slotData }),
    });
    setSaved(true);
    setLoading(false);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <div className="px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="text-stone-400 hover:text-stone-600">←</button>
        <h1 className="text-xl font-bold text-stone-900">Your availability</h1>
      </div>

      <p className="text-sm text-stone-500">Select all the time blocks you&apos;re typically free for a date.</p>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 text-stone-400 font-normal w-14" />
              {DAY_SHORT.map((d) => (
                <th key={d} className="text-center py-2 text-stone-500 font-medium text-xs">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BLOCKS.map((block) => (
              <tr key={block.key}>
                <td className="pr-2 py-1 text-xs text-stone-400 whitespace-nowrap">{block.label}</td>
                {DAYS.map((day) => {
                  const key = `${day}-${block.key}`;
                  const active = slots.has(key);
                  return (
                    <td key={day} className="py-1 px-0.5">
                      <button
                        onClick={() => toggleSlot(day, block.key)}
                        className={`w-full h-10 rounded-lg transition-colors ${
                          active ? "bg-brand-500" : "bg-stone-100 hover:bg-stone-200"
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={save}
        disabled={slots.size === 0 || loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Saving…" : saved ? "Saved ✓" : `Save (${slots.size} slots)`}
      </button>
    </div>
  );
}
