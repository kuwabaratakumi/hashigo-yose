// 鈴本演芸場（rakugo.or.jp）
// トップページから「日ごとの番組（10-16.html）」と「席ごとの番組（2026-10naka-hiru.html）」へのリンクを集める。
// 日ごとのページがある日はそれを使い、ない日は席ごとのページの「交代出演」「休演」「代演」を日付で解いて番組を作る。
import { get, sleep, hm, nameOf, GENRES, isoFrom, sekiRange, daySet, htmlToText } from '../lib.mjs';

const BASE = 'https://rakugo.or.jp/';
export const pageUrl = () => BASE;

const SEKI_LABEL = { kami: '上席', naka: '中席', shimo: '下席' };
const PART_LABEL = { hiru: '昼の部', yoru: '夜の部' };

/** 番付の1行を「種類」と「名前」に分ける（例「落 語┌柳 家 小 次 郎」→ 落語 / 柳家小次郎） */
function splitLine(raw) {
  let s = raw.normalize('NFKC').replace(/[\s ]+/g, '');
  let alt = false;
  if (s.startsWith('交代出演')) { alt = true; s = s.slice(4); }
  let genre = '';
  s = s.replace(/[｜|├]/g, '└');
  const g = GENRES.find((x) => s.replace(/^[┌└]/, '').startsWith(x));
  if (g) { s = s.replace(/^[┌└]/, '').slice(g.length); genre = g; }
  else {
    const k = s.search(/[┌└]/);
    if (k > 0) { genre = s.slice(0, k); s = s.slice(k); }
  }
  const bracketOpen = /^[┌]/.test(s);
  const cont = /^[└]/.test(s);
  return { alt, genre, name: nameOf(s.replace(/^[┌└]/, '')), bracketOpen, cont };
}

/**
 * 番組の部分（HTML）を、出演の枠の並びにする。
 * 枠 = { time, genre, alts: [{ names, on: Set|null, off: Set|null, subs: {日: 代演者} }] } または { break: true, time }
 */
function parseBanzuke(html) {
  const lines = htmlToText(html).split('\n').map((l) => l.normalize('NFKC').trim()).filter(Boolean);
  const slots = [];
  let time = '';
  let pending = null; // 2人組などで次の行に名前が続くとき
  const head = { open: '', start: '', end: '' };
  for (let line of lines) {
    const compact = line.replace(/\s+/g, '');
    // 開場・開演・終演
    const oe = compact.match(/開場:?(\d{1,2}時\d{1,2}分)/); if (oe) head.open ||= hm(oe[1]);
    const st = compact.match(/開演:?(\d{1,2}時\d{1,2}分)/); if (st) head.start ||= hm(st[1]);
    const en = compact.match(/終演:?(\d{1,2}時\d{1,2}分)/); if (en) head.end ||= hm(en[1]);
    if (oe || st || en || /入場料金|当日売り|チケット|一般:|未就学|現金/.test(compact)) continue;
    if (/[＜<].*の部.*[＞>]|^[昼夜]の部/.test(compact)) {
      const t = compact.match(/(\d{1,2}):(\d{2})/); if (t) time = hm(t[0]);
      continue;
    }
    // 代演 「[15日 柳家さん喬 代演]」
    const sub = compact.match(/^\[(.+?)日(.+?)代演\]$/);
    if (sub) {
      const last = slots.filter((x) => !x.break).at(-1);
      if (last) for (const d of daySet(sub[1])) last.alts.at(-1).subs[d] = nameOf(sub[2]);
      continue;
    }
    const t = compact.match(/^(\d{1,2}):(\d{2})(.*)$/);
    if (t) {
      time = hm(`${t[1]}:${t[2]}`);
      if (/仲入/.test(t[3])) slots.push({ break: true, time });
      continue;
    }
    if (/仲入/.test(compact)) { slots.push({ break: true, time }); continue; }
    if (!/[^\s.]/.test(compact)) continue;

    // 出演日・休演日 [11,12日出演] [13日休演]
    let on = null, off = null;
    const br = line.match(/\[([^\]]*)\]/);
    if (br) {
      if (/出演/.test(br[1])) on = daySet(br[1]);
      else if (/休演/.test(br[1])) off = daySet(br[1]);
      line = line.replace(/\[[^\]]*\]/, '');
    }
    const p = splitLine(line);
    if (!p.name && !p.genre) continue;

    if (p.cont && pending) {
      pending.names.push(p.name);
      if (on) pending.on = on;
      if (off) pending.off = off;
      if (br) pending = null;
      continue;
    }
    const entry = { names: p.name ? [p.name] : [], on, off, subs: {} };
    // 「└」で始まる行に出演日があれば、3人目以降の交代出演
    if ((p.alt || (p.cont && on)) && slots.length && !slots.at(-1).break) {
      slots.at(-1).alts.push(entry);
    } else {
      slots.push({ time, genre: p.genre, alts: [entry] });
    }
    // ┌ で始まり出演日の指定がない行は「2人組の1人目」。次の └ 行に続く
    pending = p.bracketOpen && !br ? entry : null;
  }
  return { head, slots };
}

/** 枠の並びから、ある日の出演者を決める */
function resolve(slots, day) {
  const acts = [];
  let hasBreak = false;
  for (const s of slots) {
    if (s.break) { acts.push({ break: true, time: s.time }); hasBreak = true; continue; }
    const pick = s.alts.find((a) => (!a.on || a.on.has(day)) && !(a.off && a.off.has(day)))
      ?? (s.alts.length > 1 ? null : null);
    if (!pick) continue;
    const sub = pick.subs[day];
    const name = sub || joinNames(pick.names);
    if (!name) continue;
    acts.push({ name, genre: s.genre, time: s.time, ...(sub ? { note: '代演' } : {}) });
  }
  // 最後の落語家が主任（トリ）
  const last = acts.filter((a) => !a.break).at(-1);
  if (last && hasBreak) last.role = '主任';
  return acts;
}

/** 2人組は「すず風にゃん子・金魚」のように亭号を1回にまとめる */
function joinNames(names) {
  if (names.length < 2) return names[0] || '';
  const first = names[0];
  const rest = names.slice(1).map((n) => {
    for (let k = Math.min(4, first.length - 1); k >= 2; k--) if (n.startsWith(first.slice(0, k))) return n.slice(k);
    return n;
  });
  return [first, ...rest].join('・');
}

async function parseSekiPage(file) {
  const html = await get(BASE + file);
  if (!html) return null;
  const body = html.match(/<div id="update1">([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const info = html.match(/<div id="update2">([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const parsed = parseBanzuke(body);
  const h = parseBanzuke(info).head;
  return { ...parsed, head: { ...h, ...Object.fromEntries(Object.entries(parsed.head).filter(([, v]) => v)) } };
}

async function parseDailyPage(file) {
  const html = await get(BASE + file);
  if (!html) return null;
  const parts = [];
  for (const id of ['update2', 'update3', 'update4']) {
    const block = html.match(new RegExp(`<div id="${id}">([\\s\\S]*?)<\\/div>`, 'i'))?.[1];
    if (!block) continue;
    const label = /夜\s*の\s*部/.test(block) ? '夜の部' : /昼\s*の\s*部/.test(block) ? '昼の部' : /早朝|朝/.test(block) ? '早朝' : '';
    if (!label) continue;
    const { head, slots } = parseBanzuke(block);
    parts.push({ label, head, slots });
  }
  return parts;
}

export async function fetchRange(venue, days) {
  const top = await get(BASE);
  if (!top) throw new Error('トップページを取得できませんでした');
  const links = [...new Set([...top.matchAll(/href="([^"]+\.html)"/g)].map((m) => m[1]))];
  const out = {};
  const sekiCache = new Map();
  const seki = async (file) => {
    if (!sekiCache.has(file)) { sekiCache.set(file, await parseSekiPage(file).catch(() => null)); await sleep(800); }
    return sekiCache.get(file);
  };

  for (const day of days) {
    const list = [];
    const daily = links.find((l) => l === `${day.m}-${day.d}.html` || l === `${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}.html`);
    const sekiKey = day.d <= 10 ? 'kami' : day.d <= 20 ? 'naka' : day.d <= 30 ? 'shimo' : null;
    const sekiTitle = sekiKey ? `${day.m}月${SEKI_LABEL[sekiKey]}` : '';
    if (daily) {
      const parts = await parseDailyPage(daily);
      await sleep(800);
      for (const p of parts || []) {
        list.push({ part: p.label, title: sekiTitle, open: p.head.open, start: p.head.start || p.slots.find((s) => s.time)?.time || '', end: p.head.end, url: BASE + daily, acts: resolve(p.slots, day.d) });
      }
    } else if (sekiKey) {
      for (const part of ['hiru', 'yoru']) {
        const file = links.find((l) => new RegExp(`^${day.y}-0?${day.m}${sekiKey}-${part}\\.html$`).test(l));
        if (!file) continue;
        const s = await seki(file);
        if (!s || !s.slots.length) continue;
        list.push({ part: PART_LABEL[part], title: sekiTitle, open: s.head.open, start: s.head.start || s.slots.find((x) => x.time)?.time || '', end: s.head.end, url: BASE + file, acts: resolve(s.slots, day.d) });
      }
    }
    // 余一会（31日）や特別興行は、公式ページへのリンクだけ載せる
    const yoichi = day.d === 31 && links.find((l) => new RegExp(`^${day.y}-0?${day.m}yoichi\\.html$`).test(l));
    if (yoichi) list.push({ part: '余一会', title: `${day.m}月余一会`, url: BASE + yoichi, acts: [], linkOnly: true });
    const special = links.find((l) => l === `${day.y}-${day.m}${String(day.d).padStart(2, '0')}.html`);
    if (special && !list.length) list.push({ part: '特別興行', title: '特別興行', url: BASE + special, acts: [], linkOnly: true });
    out[day.iso] = list;
  }
  return out;
}

// テスト用
export const _test = { parseBanzuke, resolve, joinNames, isoFrom, sekiRange };
