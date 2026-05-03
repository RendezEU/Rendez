"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GENDER_LABELS } from "@/types";

const GENDERS = Object.entries(GENDER_LABELS);

export default function DemographicsPage() {
  const router = useRouter();
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [genderPrefs, setGenderPrefs] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [maxDistanceKm, setMaxDistanceKm] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function togglePref(g: string) {
    setGenderPrefs((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gender || genderPrefs.length === 0) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/onboarding/demographics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthDate, gender, genderPreferences: genderPrefs, city, maxDistanceKm }),
    });
    if (res.ok) {
      router.push("/onboarding/intent");
    } else {
      const d = await res.json();
      setError(d.error || "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">About you</h1>
        <p className="text-stone-500 mt-1 text-sm">This helps us find the right people.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-stone-700 block mb-1">Date of birth</label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
            max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-stone-700 block mb-2">I am…</label>
          <div className="grid grid-cols-2 gap-2">
            {GENDERS.filter(([k]) => k !== "PREFER_NOT_TO_SAY").map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setGender(key)}
                className={`py-2.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                  gender === key
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-stone-200 text-stone-700 hover:border-stone-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-stone-700 block mb-2">I want to meet…</label>
          <div className="grid grid-cols-2 gap-2">
            {GENDERS.filter(([k]) => k !== "PREFER_NOT_TO_SAY").map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => togglePref(key)}
                className={`py-2.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                  genderPrefs.includes(key)
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-stone-200 text-stone-700 hover:border-stone-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-stone-700 block mb-1">City</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
            placeholder="e.g. Amsterdam"
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-stone-700 block mb-1">
            Max distance: {maxDistanceKm} km
          </label>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={maxDistanceKm}
            onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
