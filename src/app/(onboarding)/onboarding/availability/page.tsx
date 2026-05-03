"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS = [
  { key: "MORNING", label: "8–12" },
  { key: "AFTERNOON", label: "12–4" },
  { key: "EVENING", label: "4–8" },
  { key: "NIGHT", label: "8–11pm" },
];

type Slot = { dayOfWeek: string; timeBlock: string; isRecurring: boolean };

export default function AvailabilityPage() {
  const router = useRouter();
  const [slots, setSlots] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  function toggleSlot(day: string, block: string) {
    const key = `${day}-${block}`;
    setSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (slots.size === 0) return;
    setLoading(true);

    const slotData: Slot[] = Array.from(slots).map((key) => {
      const [day, block] = key.split("-");
      return { dayOfWeek: day, timeBlock: block, isRecurring: true };
    });

    const res = await fetch("/api/onboarding/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots: slotData }),
    });
    if (res.ok) router.push("/onboarding/prompts");
    else setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">When are you free?</h1>
        <p className="text-stone-500 mt-1 text-sm">Select your typical weekly availability.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 text-stone-400 font-normal w-16" />
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
                        type="button"
                        onClick={() => toggleSlot(day, block.key)}
                        className={`w-full h-10 rounded-lg transition-colors ${
                          active ? "bg-brand-500" : "bg-stone-100 hover:bg-stone-200"
                        }`}
                        aria-label={`${day} ${block.label}`}
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
        type="submit"
        disabled={slots.size === 0 || loading}
        className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Saving…" : `Continue → (${slots.size} slots)`}
      </button>
    </form>
  );
}
