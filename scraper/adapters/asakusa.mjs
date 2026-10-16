// 浅草演芸ホール（asakusaengei.com）
// スケジュールのカレンダーから日ごとのページ（/schedule/?ca=番号）を見つけ、昼の部・夜の部の番組を読む。
import * as cheerio from 'cheerio';
import { get, sleep, hm, nameOf } from '../lib.mjs';

const BASE = 'https://www.asakusaengei.com/schedule/';
export const pageUrl = () => 'https://www.asakusaengei.com/';

/** カレンダーから {iso: {ca, title}} */
function parseCalendar(html) {
  const $ = cheerio.load(html);
  const map = {};
  $('h3.h3_title').each((_, h) => {
    const ym = $(h).text().match(/(\d{4})年(\d{1,2})月/);
    if (!ym) return;
    const tb = $(h).nextAll('table.tb_sch').first();
    tb.find('td, th').each((__, c) => {
      const d = $(c).find('span').first().text().trim();
      const a = $(c).find('a[href*="ca="]').last();
      if (!/^\d+$/.test(d) || !a.length) return;
      const iso = `${ym[1]}-${ym[2].padStart(2, '0')}-${d.padStart(2, '0')}`;
      map[iso] = { ca: a.attr('href').match(/ca=(\d+)/)[1], title: a.text().replace(/\s+/g, '').normalize('NFKC') };
    });
  });
  return map;
}

function parseDay(html) {
  const $ = cheerio.load(html);
  const parts = [];
  $('ul.ul_dt > li').each((_, li) => {
    const h3 = $(li).find('h3').first();
    const label = h3.clone().children().remove().end().text().replace(/\s+/g, '') || h3.text().replace(/\s+/g, '').replace(/[（(].*$/, '');
    const range = h3.find('span').text().normalize('NFKC').replace(/\s+/g, '');
    const rm = range.match(/(\d{1,2}時\d{1,2}分)[~〜～](\d{1,2}時\d{1,2}分)/);
    const acts = [];
    let time = '';
    $(li).find('.content_sch').children().each((__, el) => {
      if (el.tagName === 'h4') { time = hm($(el).text()); return; }
      if (el.tagName !== 'table') return;
      $(el).children('tbody').children('tr').add($(el).children('tr')).each((___, tr) => {
        const genre = nameOf($(tr).children('th').text()).replace(/^新真打/, '');
        const td = $(tr).children('td').first();
        const role = /主任/.test(td.clone().children('table').remove().end().text()) ? '主任' : '';
        const inner = td.find('table.style1').first();
        const alternate = /交互/.test(inner.text());
        const cells = inner.find('td').map((i, c) => $(c).html()).get()
          .filter((h) => h && !/program_bundle/.test(h) && !/交互/.test(h) && h.replace(/<br\s*\/?>|\s/g, ''));
        const split = (h) => h.split(/<br\s*\/?>/).map((x) => nameOf(x.replace(/<[^>]+>/g, ''))).filter(Boolean);
        let name, alts;
        if (alternate) {
          // 「（交互）」：日によってどなたか1人。どの日かは書かれていない
          alts = cells.flatMap(split);
          name = alts.join('／');
        } else if (cells.length >= 2) {
          // 2人組：「すず風」「にゃん子<br>金魚」→ すず風にゃん子・金魚
          const head = split(cells[0]).join('');
          const members = split(cells[1]);
          name = members.length ? `${head}${members.join('・')}` : head;
        } else {
          name = split(cells[0] || '').join('・');
        }
        if (!name) return;
        if (/仲入/.test(name)) { acts.push({ break: true, time }); return; }
        if (/出演者未定/.test(name)) { acts.push({ name: '（出演者未定）', genre, time, tbd: true }); return; }
        acts.push({ name, genre, time, ...(role ? { role } : {}), ...(alts ? { alts, note: '交互出演（日によっていずれか）' } : {}) });
      });
    });
    if (!label || !acts.length) return;
    parts.push({ label: label.replace(/[（(].*$/, ''), start: rm ? hm(rm[1]) : acts[0]?.time || '', end: rm ? hm(rm[2]) : '', acts });
  });
  return parts;
}

export async function fetchRange(venue, days) {
  const cal = await get(BASE);
  if (!cal) throw new Error('スケジュールを取得できませんでした');
  const map = parseCalendar(cal);
  const out = {};
  for (const d of days) {
    out[d.iso] = [];
    const e = map[d.iso];
    if (!e) continue;
    const url = `${BASE}?ca=${e.ca}`;
    const html = await get(url);
    await sleep(800);
    if (!html) continue;
    const title = e.title.replace(/^令和\d+年/, '').replace(/番組$/, '');
    for (const p of parseDay(html)) out[d.iso].push({ part: p.label, title, start: p.start, end: p.end, url, acts: p.acts });
  }
  return out;
}

export const _test = { parseCalendar, parseDay };
