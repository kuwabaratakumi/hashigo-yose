// 日本の祝日（振替休日・国民の休日を含む）を計算する。ISO日付 'YYYY-MM-DD' を渡す。
const pad = (n) => String(n).padStart(2, '0');
const nthMonday = (y, m, n) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
const cache = new Map();

function baseHolidays(y) {
  const d = (m, day) => `${y}-${pad(m)}-${pad(day)}`;
  const k = y - 1980;
  const spring = Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4));
  return new Set([
    d(1, 1), d(1, nthMonday(y, 1, 2)), d(2, 11), d(2, 23), d(3, spring), d(4, 29),
    d(5, 3), d(5, 4), d(5, 5), d(7, nthMonday(y, 7, 3)), d(8, 11), d(9, nthMonday(y, 9, 3)),
    d(9, autumn), d(10, nthMonday(y, 10, 2)), d(11, 3), d(11, 23),
  ]);
}

function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const set = baseHolidays(y);
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const DAY = 86400000;
  // 国民の休日：前後が祝日の平日
  for (const h of [...set]) {
    const t = Date.parse(h + 'T00:00:00Z');
    const mid = iso(t + DAY);
    if (set.has(iso(t + 2 * DAY)) && !set.has(mid) && new Date(t + DAY).getUTCDay() !== 0) set.add(mid);
  }
  // 振替休日：日曜の祝日のあと、最初の祝日でない日
  for (const h of [...set].sort()) {
    const t = Date.parse(h + 'T00:00:00Z');
    if (new Date(t).getUTCDay() !== 0) continue;
    let n = t + DAY;
    while (set.has(iso(n))) n += DAY;
    set.add(iso(n));
  }
  cache.set(y, set);
  return set;
}

export const isHoliday = (isoDate) => holidaysOf(Number(isoDate.slice(0, 4))).has(isoDate);
