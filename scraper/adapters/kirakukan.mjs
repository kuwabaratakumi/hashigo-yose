// 神戸新開地・喜楽館（kobe-kirakukan.jp）
// 公演情報の一覧（今月・来月・再来月）に、日付・時間帯・出演者がまとめて載っている。
import * as cheerio from 'cheerio';
import { get, hm, htmlToText, parseLineup, addMinutes } from '../lib.mjs';

const LIST = 'https://kobe-kirakukan.jp/performances/';
export const pageUrl = () => 'https://kobe-kirakukan.jp/';

const ZONES = { morning: '朝席', noon: '昼席', night: '夜席' };

export async function fetchRange(venue, days) {
  const html = await get(LIST);
  if (!html) throw new Error('公演情報を取得できませんでした');
  const $ = cheerio.load(html);
  const want = new Set(days.map((d) => d.iso));
  const out = Object.fromEntries(days.map((d) => [d.iso, []]));
  const now = new Date(Date.now() + 9 * 3600e3);
  $('li.infobox[data-timezone]').each((_, li) => {
    const zone = $(li).attr('data-timezone');
    const dm = $(li).find('p.date').text().normalize('NFKC').match(/(\d{1,2})月(\d{1,2})日/);
    if (!dm) return;
    const kind = $(li).attr('data-kind'); // kongetsu / raigetsu / saraigetsu
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + ({ raigetsu: 1, saraigetsu: 2 }[kind] || 0), 1));
    const iso = `${base.getUTCFullYear()}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`;
    if (!want.has(iso)) return;
    const a = $(li).find('.rightContent a').first();
    const title = (a.attr('title') || '').trim();
    const text = htmlToText($(li).find('.rightContent p').first().html() || '').normalize('NFKC');
    // 出演者は最初の空行まで。「※」「開演」「料金」以降はお知らせ
    const lines = [];
    for (const l of text.split('\n').map((s) => s.trim())) {
      if (/^(※|開演[:：]|料金|席種|お問い合わせ|主催|注意事項)/.test(l)) break;
      if (!l) { if (lines.length) break; continue; }
      if (l.replace(/\s/g, '') === title.normalize('NFKC').replace(/\s/g, '')) continue;
      lines.push(l);
    }
    // 昼席は1行目がサブタイトル（～防犯ウイーク～ など）
    if (zone === 'noon' && lines.length && /^[～~〜].*[～~〜]$/.test(lines[0])) lines.shift();
    const lineup = zone === 'noon' ? lines.join('') : lines.join('／');
    const st = text.match(/開演[:：]\s*(\d{1,2}(?::\d{2}|時(?:\d{1,2}分)?))/);
    const op = text.match(/開場\s*(\d{1,2}(?::\d{2}|時(?:\d{1,2}分)?))/);
    let start = st ? hm(st[1]) : '';
    if (zone === 'noon' && !start) start = '14:00'; // 昼席は14時開演（公式の一覧に時刻の記載がないため目安）
    out[iso].push({
      part: ZONES[zone] || '', title: title || ZONES[zone], open: op ? hm(op[1]) : '', start,
      end: start ? addMinutes(start, zone === 'noon' ? 150 : 120) : '', endEst: true, startEst: zone === 'noon' && !st,
      url: a.attr('href') || LIST, kind: zone === 'noon' ? '寄席' : '会',
      acts: parseLineup(lineup.replace(/／+/g, '／')),
    });
  });
  for (const iso of Object.keys(out)) out[iso].sort((x, y) => (x.start || '99').localeCompare(y.start || '99'));
  return out;
}
