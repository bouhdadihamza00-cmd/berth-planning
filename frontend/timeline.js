// Calendar geometry shared by labels, cards, navigation and native scrollbars.
const HOUR = 3600000;
const formatters = new Map();
function parts(value, timezone) {
  if (!formatters.has(timezone))
    formatters.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  return Object.fromEntries(
    formatters
      .get(timezone)
      .formatToParts(new Date(value))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
}
function zoned(p, timezone) {
  const local = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour || 0,
    p.minute || 0,
    p.second || 0,
  );
  let stamp = local;
  for (let i = 0; i < 4; i++) {
    const seen = parts(stamp, timezone);
    const correction =
      local -
      Date.UTC(
        seen.year,
        seen.month - 1,
        seen.day,
        seen.hour,
        seen.minute,
        seen.second,
      );
    if (!correction) break;
    stamp += correction;
  }
  return new Date(stamp);
}
export function shiftAnchor(value, mode, amount, timezone) {
  if (!["day", "week", "month", "year"].includes(mode))
    throw new Error("Unknown timeline scale");
  const p = parts(value, timezone);
  if (mode === "month" || mode === "year") {
    const month = new Date(
      Date.UTC(
        p.year + (mode === "year" ? amount : 0),
        p.month - 1 + (mode === "month" ? amount : 0),
        1,
      ),
    );
    p.year = month.getUTCFullYear();
    p.month = month.getUTCMonth() + 1;
    p.day = Math.min(
      p.day,
      new Date(Date.UTC(p.year, p.month, 0)).getUTCDate(),
    );
  } else {
    const day = new Date(
      Date.UTC(p.year, p.month - 1, p.day + amount * (mode === "week" ? 7 : 1)),
    );
    p.year = day.getUTCFullYear();
    p.month = day.getUTCMonth() + 1;
    p.day = day.getUTCDate();
  }
  return zoned(p, timezone);
}
function periodStart(value, mode, timezone) {
  const p = parts(value, timezone);
  p.hour = 0;
  p.minute = 0;
  p.second = 0;
  if (mode === "year") {
    p.month = 1;
    p.day = 1;
  }
  if (mode === "month") p.day = 1;
  let result = zoned(p, timezone);
  if (mode === "week") {
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    result = shiftAnchor(result, "day", -((weekday + 6) % 7), timezone);
  }
  return result;
}
export function buildTimeline({
  mode,
  anchor,
  timezone,
  viewportWidth,
  records = [],
  locale = "en-GB",
}) {
  if (!["day", "week", "month", "year"].includes(mode))
    throw new Error("Unknown timeline scale");
  const focus = periodStart(anchor, mode, timezone),
    periodEnd = shiftAnchor(focus, mode, 1, timezone);
  let start = shiftAnchor(focus, mode, -1, timezone),
    end = shiftAnchor(
      focus,
      mode,
      mode === "day" ? 6 : mode === "week" ? 4 : 2,
      timezone,
    );
  const bound = { day: 45, week: 26, month: 12, year: 10 }[mode];
  const low = shiftAnchor(focus, mode, -bound, timezone),
    high = shiftAnchor(focus, mode, bound, timezone);
  for (const record of records) {
    for (const value of [record.start, record.end]) {
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isFinite(+date) || date < low || date > high) continue;
      const beginning = periodStart(date, mode, timezone),
        ending = shiftAnchor(beginning, mode, 1, timezone);
      if (beginning < start) start = beginning;
      if (ending > end) end = ending;
    }
  }
  const visibleHours = (periodEnd - focus) / HOUR,
    scale = Math.max(1, viewportWidth) / visibleHours;
  const width = ((end - start) / HOUR) * scale;
  const minor = [],
    major = [];
  const format = (date, options) =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, ...options }).format(
      date,
    );
  const segment = (a, b, label) => ({
    start: a,
    end: b,
    left: ((a - start) / HOUR) * scale,
    width: ((b - a) / HOUR) * scale,
    label,
  });
  const hourStep =
    [1, 2, 3, 6, 12].find(
      (step) =>
        step >= (viewportWidth >= 1100 ? 1 : 2) &&
        (end - start) / HOUR / step <= 1100,
    ) || 24;
  for (let date = new Date(start); date < end;) {
    const next =
      mode === "day"
        ? new Date(+date + hourStep * HOUR)
        : shiftAnchor(date, mode === "year" ? "month" : "day", 1, timezone);
    const label =
      mode === "day"
        ? format(date, { hour: "2-digit", minute: "2-digit" })
        : mode === "week"
          ? format(date, { weekday: "short", day: "2-digit" })
          : mode === "month"
            ? format(date, { day: "2-digit" })
            : format(date, { month: "short" });
    minor.push(segment(date, next, label));
    date = next;
  }
  const majorMode = mode === "day" ? "day" : mode === "year" ? "year" : "month";
  for (let date = periodStart(start, majorMode, timezone); date < end;) {
    const next = shiftAnchor(date, majorMode, 1, timezone);
    const label =
      majorMode === "day"
        ? format(date, {
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : majorMode === "year"
          ? format(date, { year: "numeric" })
          : format(date, { month: "long", year: "numeric" });
    major.push(
      segment(
        new Date(Math.max(+date, +start)),
        new Date(Math.min(+next, +end)),
        label,
      ),
    );
    date = next;
  }
  return {
    mode,
    start,
    end,
    periodStart: focus,
    periodEnd,
    visibleHours,
    scale,
    width,
    minor,
    major,
  };
}
