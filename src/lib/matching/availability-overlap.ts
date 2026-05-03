import type { AvailabilitySlot, DayOfWeek, TimeBlock } from "@prisma/client";

type SlotKey = `${DayOfWeek}-${TimeBlock}`;

export function findOverlap(
  slotsA: AvailabilitySlot[],
  slotsB: AvailabilitySlot[]
): SlotKey[] {
  const setA = new Set(
    slotsA
      .filter((s) => s.isActive)
      .map((s) => `${s.dayOfWeek}-${s.timeBlock}` as SlotKey)
  );

  return slotsB
    .filter((s) => s.isActive && setA.has(`${s.dayOfWeek}-${s.timeBlock}` as SlotKey))
    .map((s) => `${s.dayOfWeek}-${s.timeBlock}` as SlotKey);
}

export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
