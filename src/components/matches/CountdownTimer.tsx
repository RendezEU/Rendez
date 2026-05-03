"use client";

import { useState, useEffect } from "react";

export default function CountdownTimer({ scheduledAt }: { scheduledAt: string }) {
  const [diff, setDiff] = useState(0);

  useEffect(() => {
    function update() {
      setDiff(new Date(scheduledAt).getTime() - Date.now());
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [scheduledAt]);

  if (diff <= 0) return null;

  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1_000);

  const label =
    hours > 48
      ? `${Math.round(hours / 24)} days away`
      : hours > 0
      ? `${hours}h ${mins}m`
      : `${mins}m ${secs}s`;

  return (
    <div className="mt-2 text-center text-sm text-brand-700 font-medium">
      ⏱ {label} to go
    </div>
  );
}
