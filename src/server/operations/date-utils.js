const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeDateKey(value) {
  const raw = String(value || '').trim().replaceAll('-', '');
  if (!/^\d{8}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return raw;
}

export function shiftDateKey(dateKey, days) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return null;
  const date = new Date(
    Date.UTC(
      Number(normalized.slice(0, 4)),
      Number(normalized.slice(4, 6)) - 1,
      Number(normalized.slice(6, 8)) + Number(days || 0)
    )
  );
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
}

export function displayDateKey(dateKey) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return String(dateKey || '');
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

export function daysBetweenInclusive(fromDateKey, toDateKey) {
  const from = normalizeDateKey(fromDateKey);
  const to = normalizeDateKey(toDateKey);
  if (!from || !to) return null;
  const fromMs = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(4, 6)) - 1,
    Number(from.slice(6, 8))
  );
  const toMs = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(4, 6)) - 1,
    Number(to.slice(6, 8))
  );
  if (toMs < fromMs) return null;
  return Math.floor((toMs - fromMs) / DAY_MS) + 1;
}

export function getDateKeyInTimeZone(date = new Date(), timeZone = 'Asia/Riyadh') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}${month}${day}` : null;
}

export function normalizeDateRange(
  { fromDate, toDate },
  { todayDateKey, defaultDays = 1, maxDays = 366 } = {}
) {
  const today = normalizeDateKey(todayDateKey) || getDateKeyInTimeZone();
  const normalizedTo = normalizeDateKey(toDate) || today;
  const normalizedFrom =
    normalizeDateKey(fromDate) || shiftDateKey(normalizedTo, -(Math.max(defaultDays, 1) - 1));
  const days = daysBetweenInclusive(normalizedFrom, normalizedTo);
  if (!days) throw new Error('Invalid date range');
  if (days > maxDays) throw new Error(`Date range cannot exceed ${maxDays} days`);
  return { fromDate: normalizedFrom, toDate: normalizedTo, days };
}
