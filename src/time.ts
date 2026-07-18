/** Timezone helpers — all Ts are UTC epoch ms. */

/**
 * Format an epoch-ms timestamp for a given IANA timezone.
 * Returns a stable string like "2026-06-08 23:00:00 GMT-3" (Sao Paulo) or
 * "2026-06-09 11:00:00 GMT+9" (Tokyo) for the same instant.
 */
export function formatInTz(ts: number, tz: string): string {
  const date = new Date(ts);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "??";
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${offset}`;
}

/** Human minute display, e.g. "60′" or "N/D" when unknown. */
export function minuteLabel(minute: number | null | undefined): string {
  if (typeof minute !== "number" || !Number.isFinite(minute)) return "N/D";
  return `${minute}′`;
}
