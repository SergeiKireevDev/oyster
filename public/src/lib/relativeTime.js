export function formatRelativeTime(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const current = new Date(now);
  const diff = Math.max(0, current.getTime() - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (dateDay === today) {
    if (diff < minute) return "just now";
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    return `${Math.floor(diff / hour)}h ago`;
  }
  if (dateDay === today - day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== current.getFullYear() ? { year: "numeric" } : {}),
  });
}
