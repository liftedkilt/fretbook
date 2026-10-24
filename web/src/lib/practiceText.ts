import { t } from "./i18n.svelte";
import { durationParts } from "./practiceLog";

/** "45s", "12m" or "1h 05m", with the units from the language catalog. */
export function formatDuration(seconds: number): string {
  const parts = durationParts(seconds);
  if (parts.unit === "seconds") return t("practiceLog.durationSeconds", { count: parts.seconds });
  if (parts.unit === "minutes") return t("practiceLog.durationMinutes", { count: parts.minutes });
  return t("practiceLog.durationHours", {
    hours: parts.hours,
    minutes: String(parts.minutes).padStart(2, "0"),
  });
}
