import { format, formatDistanceToNow, isPast, differenceInHours } from "date-fns";

export function formatDate(date: Date | string): string {
  return format(new Date(date), "EEE, MMM d 'at' h:mm a");
}

export function formatTimeAgo(date: Date | string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function isDatePast(date: Date | string): boolean {
  return isPast(new Date(date));
}

export function hoursUntil(date: Date | string): number {
  return differenceInHours(new Date(date), new Date());
}

export function isDateActive(scheduledAt: Date | string): boolean {
  const h = hoursUntil(scheduledAt);
  return h <= 2 && h >= -3;
}

export const TIME_BLOCK_LABELS: Record<string, string> = {
  MORNING: "Morning (8–12)",
  AFTERNOON: "Afternoon (12–4)",
  EVENING: "Evening (4–8)",
  NIGHT: "Night (8–11)",
};

export const DAY_LABELS: Record<string, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};
