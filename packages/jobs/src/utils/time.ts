const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export function addDays(input: Date, days: number): Date {
  return new Date(input.getTime() + days * DAY_MS);
}

export function enumerateDays(windowStart: Date, windowEnd: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfUtcDay(windowStart);
  const end = startOfUtcDay(windowEnd);

  while (cursor < end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return days;
}

export function toIsoDay(input: Date): string {
  return input.toISOString().slice(0, 10);
}
