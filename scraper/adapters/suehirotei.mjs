// 新宿末廣亭（suehirotei.com）
// トップのメニューにある席ごとのページ（10naka.html など）の番組表（table）を読む。
// 「交互」「〃」の行は出演日つきの交代出演。日付で解いてその日の出演者だけを残す。
import * as cheerio from 'cheerio';
import { get, sleep, hm, nameOf, isoFrom, sekiRange, daySet } from '../lib.mjs';

const BASE = 'http://suehirotei.com/';
export const pageUrl = () => BASE;

const SEKI = { kami: '上席', naka: '中席', shimo: '下席' };

function parseSeki(html) {
  const $ = cheerio.load(html);
  const note = $('.jouseki').first().text().replace(/\s+/g, ' ').trim(); // 例「10月中席(11日～20日)昼夜入替なし」
  const parts = [];
  $('table').each((_, tb) => {
    const th = $(tb).find('th').first().text().replace(/\s+/g, '');
    const pm = th.match(/(昼の部|夜の部|深夜寄席|早朝寄席|特別興行|[^\(（]*の部)[\(（]?(\d{1,2}:\d{2})?[〜~～-]?(\d{1,2}:\d{2})?/);
    if (!pm) return;
    const slots = [];
    let time = '';
    $(tb).find('tr').each((__, tr) => {
      const td = $(tr).find('td');
      if (td.length < 3) return;
      const t = $(td[0]).text().trim();
      if (/\d{1,2}:\d{2}/.test(t)) time = hm(t);
      const mark = $(td[1]).text().replace(/\s+/g, '');
      const cell = $(td[2]);
      const dates = cell.find('.grad-item').text().replace(/\s+/g, '');
      cell.find('.grad-wrap').remove();
      const label = cell.find('.futatsume').text().replace(/\s+/g, ' ').trim(); // 「壽 二ツ目昇進」など
      cell.find('.futatsume').remove();
      const name = nameOf(cell.text());
      const genre = nameOf($(td[3]).text());
      if (/仲入/.test(name)) { slots.push({ break: true, time }); return; }
      if (!name) return;
      const on = dates && /\d/.test(dates) && !/休/.test(dates) ? daySet(dates) : null;
      const off = /休/.test(dates) ? daySet(dates) : null;
      const alt = { name, on, off, note: label.replace(/\s+/g, ' ') };
      if (mark === '〃' && slots.length && !slots.at(-1).break) slots.at(-1).alts.push(alt);
      else slots.push({ time, genre, role: mark === '主任' ? '主任' : '', alts: [alt] });
    });
    parts.push({ label: pm[1], start: pm[2] ? hm(pm[2]) : '', end: pm[3] ? hm(pm[3]) : '', slots });
  });
  return { note, parts };
}

function resolve(slots, day) {
  const acts = [];
  for (const s of slots) {
    if (s.break) { acts.push({ break: true, time: s.time }); continue; }
    const a = s.alts.find((x) => (!x.on || x.on.has(day)) && !(x.off && x.off.has(day)));
    if (!a) continue;
    acts.push({ name: a.name, genre: s.genre, time: s.time, ...(s.role ? { role: s.role } : {}), ...(a.note ? { note: a.note } : {}) });
  }
  return acts;
}

export async function fetchRange(venue, days) {
  const top = await get(BASE);
  if (!top) throw new Error('トップページを取得できませんでした');
  // 席ページ「10naka.html」と、その月を集める
  const files = [...new Set([...top.matchAll(/href="(\d{1,2})(kami|naka|shimo)\.html"/g)].map((m) => `${m[1]}${m[2]}`))];
  const want = new Set(days.map((d) => d.iso));
  const out = Object.fromEntries(days.map((d) => [d.iso, []]));
  for (const f of files) {
    const [, mo, seki] = f.match(/^(\d{1,2})(kami|naka|shimo)$/);
    const isos = sekiRange(Number(mo), seki);
    if (!isos.some((i) => want.has(i))) continue;
    const html = await get(`${BASE}${f}.html`);
    await sleep(800);
    if (!html) continue;
    const { note, parts } = parseSeki(html);
    for (const iso of isos) {
      if (!want.has(iso)) continue;
      const day = Number(iso.slice(8));
      for (const p of parts) {
        const acts = resolve(p.slots, day);
        if (!acts.length) continue;
        out[iso].push({ part: p.label, title: `${Number(mo)}月${SEKI[seki]}`, start: p.start, end: p.end, url: `${BASE}${f}.html`, note: /入替なし/.test(note) ? '昼夜入替なし' : '', acts });
      }
    }
  }
  return out;
}

export const _test = { parseSeki, resolve, isoFrom };
