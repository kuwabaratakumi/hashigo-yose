// 天満天神繁昌亭（hanjotei.jp）
// 「公演番組案内」のページが使っている月×時間帯（朝席・昼席・夜席・深夜）の一覧（JSON）を読む。
import { get, sleep, hm, htmlToText, parseLineup, addMinutes } from '../lib.mjs';

const ENDPOINT = 'https://www.hanjotei.jp/wp/wp-admin/admin-ajax.php';
export const pageUrl = () => 'https://www.hanjotei.jp/performances/';

const ZONES = { morning: '朝席', day: '昼席', night: '夜席', itsuya: '深夜' };

/** 「開演：午後6時30分（6時開場）」から開演・開場 */
function times(text, zone) {
  const t = text.normalize('NFKC');
  const st = t.match(/開演[:：]?\s*((?:午前|午後)?\s*\d{1,2}時(?:\d{1,2}分)?)/);
  const op = t.match(/[（(]\s*((?:午前|午後)?\s*\d{1,2}時(?:\d{1,2}分)?)\s*開場/) || t.match(/開場[:：]?\s*((?:午前|午後)?\s*\d{1,2}時(?:\d{1,2}分)?)/);
  let start = st ? hm(st[1]) : '';
  let open = op ? hm(op[1]) : '';
  // 「午後6時30分（6時開場）」の開場は午後のこと
  const pm = /午後/.test(st?.[1] || '') || zone === 'night' || zone === 'itsuya';
  if (pm && open && Number(open.slice(0, 2)) < 12) open = `${String(Number(open.slice(0, 2)) + 12).padStart(2, '0')}${open.slice(2)}`;
  if (pm && start && Number(start.slice(0, 2)) < 12) start = `${String(Number(start.slice(0, 2)) + 12).padStart(2, '0')}${start.slice(2)}`;
  return { start, open };
}

export async function fetchRange(venue, days) {
  const want = new Set(days.map((d) => d.iso));
  const out = Object.fromEntries(days.map((d) => [d.iso, []]));
  const months = [...new Set(days.map((d) => `${d.y}-${d.m}`))];
  let got = 0;
  for (const ym of months) {
    const [y, m] = ym.split('-');
    for (const zone of Object.keys(ZONES)) {
      const body = new URLSearchParams([['action', 'child_search'], ['array[]', y], ['array[]', m], ['array[]', zone]]);
      const res = await get(ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      await sleep(800);
      let list;
      try { list = JSON.parse(res); } catch { continue; } // 「まだ記事はありません」
      if (!Array.isArray(list)) continue;
      got++;
      for (const it of list) {
        if (!want.has(it.date)) continue;
        const text = htmlToText(it.content).split('\n').map((s) => s.trim()).filter(Boolean);
        const lineupLine = text.find((s) => /[／/]/.test(s) && !/開演|前売|問合|料金/.test(s)) || (zone === 'day' ? text[0] : text.find((s) => !/開演|開場|前売|当日|問合|配信|完売|※/.test(s)) || '');
        const all = text.join('\n');
        let { start, open } = times(all, zone);
        let end = '';
        if (zone === 'day') { start ||= '13:30'; open ||= '13:00'; end = '16:10'; }
        const title = String(it.title || '').replace(/^昼席：番組案内$/, '').trim();
        out[it.date].push({
          part: ZONES[zone], title: zone === 'day' && !title ? '昼席' : title || ZONES[zone],
          open, start, end: end || (start ? addMinutes(start, zone === 'morning' ? 120 : 150) : ''), endEst: !end,
          url: zone === 'day' ? pageUrl() : it.url, kind: zone === 'day' ? '寄席' : '会',
          acts: parseLineup(lineupLine),
          note: /完売/.test(all) ? '完売' : '',
        });
      }
    }
  }
  if (!got) throw new Error('番組一覧を取得できませんでした');
  for (const iso of Object.keys(out)) out[iso].sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  return out;
}

export const _test = { times };
