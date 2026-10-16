// 横浜にぎわい座（nigiwaiza.yafjp.org）
// 公演スケジュールの月ごとの一覧から対象日の公演を拾い、公演ページの「出演」欄を読む。
import * as cheerio from 'cheerio';
import { get, sleep, hm, parseLineup, addMinutes } from '../lib.mjs';

const BASE = 'https://nigiwaiza.yafjp.org/perform/';
export const pageUrl = () => 'https://nigiwaiza.yafjp.org/';

function parseList(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('ul.perform_list > li').each((_, li) => {
    const a = $(li).find('.perform_inner_title a').first();
    const date = $(li).find('.perform_inner_date.day_date').text().normalize('NFKC').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!a.length || !date) return;
    const timeText = $(li).find('.perform_inner_date').not('.day_date').first().text().normalize('NFKC');
    const cats = $(li).find('.perform_cate').map((i, c) => $(c).text().trim()).get();
    items.push({
      iso: `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`,
      title: a.text().trim(), url: a.attr('href'),
      start: hm(timeText.match(/(\d{1,2}:\d{2})\s*開演/)?.[1] || ''),
      open: hm(timeText.match(/(\d{1,2}:\d{2})\s*開場/)?.[1] || ''),
      hall: cats[0] || '', kind: cats.slice(1).join('・'),
      status: $(li).find('.perform_inner_status').text().trim(),
    });
  });
  return items;
}

function parseDetail(html) {
  const $ = cheerio.load(html);
  const acts = [];
  const lines = $('ul.cast_list > li').map((_, li) => $(li).text().normalize('NFKC').replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  acts.push(...parseLineup(lines.map((l) => (/仲入/.test(l) ? '仲入' : l)).join('／')));
  const last = acts.filter((x) => !x.break).at(-1);
  if (last && acts.some((x) => x.break)) last.role = '主任';
  return acts;
}

export async function fetchRange(venue, days) {
  const top = await get(BASE);
  if (!top) throw new Error('公演スケジュールを取得できませんでした');
  // 「2026年10月」→ cat=276 のような月の番号
  const months = Object.fromEntries([...top.matchAll(/<option value="(\d+)"\s*>\s*(\d{4})年(\d{1,2})月/g)].map((m) => [`${m[2]}-${m[3].padStart(2, '0')}`, m[1]]));
  const want = new Set(days.map((d) => d.iso));
  const out = Object.fromEntries(days.map((d) => [d.iso, []]));
  for (const ym of [...new Set(days.map((d) => d.iso.slice(0, 7)))]) {
    const cat = months[ym];
    if (!cat) continue;
    const list = parseList(await get(`${BASE}?cat=${cat}`) || '');
    await sleep(800);
    for (const it of list) {
      if (!want.has(it.iso)) continue;
      let acts = [];
      try { acts = parseDetail(await get(it.url) || ''); } catch { /* 出演者が取れなくても公演は載せる */ }
      await sleep(800);
      const isYose = /寄席/.test(it.kind + it.title);
      out[it.iso].push({
        part: /夜/.test(it.kind) ? '夜' : /昼/.test(it.kind) ? '昼' : '', title: it.title, open: it.open, start: it.start,
        end: it.start ? addMinutes(it.start, isYose ? 150 : 120) : '', endEst: true,
        url: it.url, hall: it.hall === '芸能ホール' ? '' : it.hall, kind: isYose ? '寄席' : '会', acts,
        note: /完売|売切/.test(it.status) ? '完売' : '',
      });
    }
  }
  return out;
}

export const _test = { parseList, parseDetail };
