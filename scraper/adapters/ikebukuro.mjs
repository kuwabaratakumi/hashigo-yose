// 池袋演芸場（ike-en.com）
// 番組は画像でしか公開されていないため、席の期間と番組表の画像へのリンクだけを載せる（芸人さがし・はしごの対象外）。
import { get, isoFrom } from '../lib.mjs';

const BASE = 'https://www.ike-en.com/';
export const pageUrl = () => BASE + 'index2.html';

const SEKI_FILE = { 上席: 'kami', 中席: 'naka', 下席: 'simo' };

export async function fetchRange(venue, days) {
  const raw = await get(BASE + 'index2.html', { encoding: 'cp932' });
  if (!raw) throw new Error('トップページを取得できませんでした');
  const text = raw.normalize('NFKC').replace(/<[^>]+>/g, ' ');
  const images = [...raw.matchAll(/openPopup\('([^']*img_touka(\d{2})(\d{2})_(kami|naka|simo)[^']*)'/g)];
  const out = Object.fromEntries(days.map((d) => [d.iso, []]));
  const want = new Set(days.map((d) => d.iso));
  for (const m of text.matchAll(/(上席|中席|下席)\s*:\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*[~〜～]\s*(?:(\d{1,2})月)?(\d{1,2})日/g)) {
    const [, seki, y, mo, d1, mo2, d2] = m;
    const from = isoFrom(Number(mo), Number(d1), Number(y));
    const to = isoFrom(Number(mo2 || mo), Number(d2), Number(y));
    const img = images.find((x) => Number(x[3]) === Number(mo) && x[4] === SEKI_FILE[seki]);
    for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (!want.has(iso)) continue;
      out[iso].push({ part: '昼の部・夜の部', title: `${Number(mo)}月${seki}`, url: pageUrl(), image: img ? BASE + img[1] : '', acts: [], linkOnly: true, note: '番組は公式サイトの画像でご確認ください' });
    }
  }
  return out;
}
