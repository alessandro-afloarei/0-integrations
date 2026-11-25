function delay(value: number | undefined): number | null {
  if (value === undefined || value < 0 || !Number.isSafeInteger(Math.ceil(value))) return null;
  return Math.ceil(value);
}

/** Normalize only HTTP-date's three wire formats; Date.parse alone also accepts values such as "-1". */
function httpDate(value: string, nowMs: number): number | null {
  let canonical = value;
  if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT$/u.test(value)) {
    canonical = value.replace(/^([A-Z][a-z]+), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (.+)$/u,
      (_match: string, weekday: string, day: string, month: string, shortYear: string, time: string) => {
        const ceiling = new Date(nowMs);
        ceiling.setUTCFullYear(ceiling.getUTCFullYear() + 50);
        let year = Math.floor(ceiling.getUTCFullYear() / 100) * 100 + Number(shortYear);
        if (Date.parse(`${day} ${month} ${String(year)} ${time}`) > ceiling.getTime()) year -= 100;
        return `${weekday.slice(0, 3)}, ${day} ${month} ${String(year).padStart(4, '0')} ${time}`;
      });
  } else if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/u.test(value)) {
    canonical = value.replace(/^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/u,
      (_match: string, weekday: string, month: string, day: string, time: string, year: string) =>
        `${weekday}, ${day.trim().padStart(2, '0')} ${month} ${year} ${time} GMT`);
  }
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(canonical)) return null;
  const timestamp = Date.parse(canonical);
  // Refuse impossible dates and mismatched weekdays instead of accepting Date's calendar rollover.
  return new Date(timestamp).toUTCString() === canonical ? timestamp : null;
}

/** Diagnostic delay only: this does not change the HTTP client's existing capped retry policy. */
export function retryAfterMs(headers: Headers, nowMs: number, bodyWaitMs?: number): number | null {
  const value = headers.get('retry-after');
  if (value !== null) {
    if (/^\d+$/u.test(value)) {
      const milliseconds = delay(Number(value) * 1000);
      if (milliseconds !== null) return milliseconds;
    } else {
      const timestamp = httpDate(value, nowMs);
      if (timestamp !== null) return delay(Math.max(0, timestamp - nowMs)) ?? delay(bodyWaitMs);
    }
  }
  return delay(bodyWaitMs);
}
