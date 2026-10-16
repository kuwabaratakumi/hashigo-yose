// 使い方:
//   node scraper/run.mjs                    全寄席を取得
//   node scraper/run.mjs --only suzumoto    指定した寄席だけ（カンマ区切り）
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextDays, countPrograms, addMinutes } from './lib.mjs';
import { SITE_URL } from '../public/site-info.js';
import * as suzumoto from './adapters/suzumoto.mjs';
import * as suehirotei from './adapters/suehirotei.mjs';
import * as asakusa from './adapters/asakusa.mjs';
import * as ikebukuro from './adapters/ikebukuro.mjs';
import * as nigiwaiza from './adapters/nigiwaiza.mjs';
import * as hanjotei from './adapters/hanjotei.mjs';
import * as kirakukan from './adapters/kirakukan.mjs';

const ADAPTERS = { suzumoto, suehirotei, asakusa, ikebukuro, nigiwaiza, hanjotei, kirakukan };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public', 'data');
const DAYS = Number(process.env.DAYS || 10);

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : '';
};
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.round(x) % 60).padStart(2, '0')}`;

/**
 * 出演者ごとの高座の時刻の目安を付ける（at〜until）。
 * 番組表の時刻は「この時刻からの数人」という区切りなので、区切りの中で人数割りにする。
 * 時刻がない番組は、開演〜終演を人数で割る（仲入りは15分）。主任は長めに取る。
 */
function estimateActTimes(p) {
  const acts = p.acts || [];
  if (!acts.length || !p.start) return;
  const endMin = p.end ? toMin(p.end) : toMin(p.start) + 150;
  // 区切り（同じ時刻の出演者のまとまり）を作る
  const blocks = [];
  let cur = null;
  for (const a of acts) {
    const t = a.time && /^\d\d:\d\d$/.test(a.time) ? a.time : '';
    if (!cur || (t && t !== cur.time)) { cur = { time: t || (cur ? '' : p.start), items: [] }; blocks.push(cur); }
    cur.items.push(a);
  }
  if (!blocks[0].time) blocks[0].time = p.start;
  // 時刻のない区切りは前後から補う
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const from = toMin(b.time || p.start);
    const next = blocks.slice(i + 1).find((x) => x.time);
    const to = next ? toMin(next.time) : endMin;
    const weight = (a) => (a.break ? 1 : a.role === '主任' ? 2 : 1.2);
    const total = b.items.reduce((s, a) => s + weight(a), 0) || 1;
    let t = from;
    for (const a of b.items) {
      const len = ((to - from) * weight(a)) / total;
      if (!a.break) { a.at = fromMin(t); a.until = fromMin(t + len); }
      t += len;
    }
  }
}

/** 番組の後始末：終演の目安、主任の印、出演者の時刻の目安 */
function finish(p, venue) {
  if (p.linkOnly) return p;
  if (p.start && !p.end) { p.end = addMinutes(p.start, 150); p.endEst = true; }
  if (p.kind !== '会' && venue.kind === '定席') {
    const acts = (p.acts || []).filter((a) => !a.break);
    if (acts.length >= 5 && !acts.some((a) => a.role === '主任')) acts.at(-1).role = '主任';
  }
  estimateActTimes(p);
  for (const a of p.acts || []) delete a.time; // 区切りの時刻は at に反映済み
  return p;
}

/** 公開中のサイトから、前回うまく取れたデータを読む（取得に失敗した寄席の穴埋め用） */
async function loadPrevious(id) {
  if (process.env.NO_PREV) return null;
  try {
    const res = await fetch(`${process.env.PREV_BASE || SITE_URL}/data/schedules/${id}.json`, { signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function scrapeVenue(v, days) {
  const ad = ADAPTERS[v.adapter];
  const out = { id: v.id, name: v.name, url: ad.pageUrl(v), updatedAt: new Date().toISOString(), days: {}, errors: [] };
  try {
    const got = await ad.fetchRange(v, days);
    for (const d of days) out.days[d.iso] = (got[d.iso] || []).map((p) => finish(p, v));
  } catch (e) {
    for (const d of days) out.days[d.iso] = [];
    out.errors.push(e.message);
  }
  return out;
}

async function main() {
  const listed = JSON.parse(await fs.readFile(path.join(root, 'scraper', 'venues.json'), 'utf-8'));
  const excluded = JSON.parse(await fs.readFile(path.join(root, 'scraper', 'excluded.json'), 'utf-8')).venues ?? [];
  const all = listed.filter((v) => !excluded.some((e) => e.id === v.id));
  const only = arg('--only').split(',').filter(Boolean);
  const targets = all.filter((v) => !only.length || only.includes(v.id));
  const days = nextDays(DAYS);
  await fs.mkdir(path.join(outDir, 'schedules'), { recursive: true });

  // 寄席ごとにサイトが違うので並行して取る（同じサイトの中は順番に、間隔をあけて）
  const summary = await Promise.all(targets.map(async (v) => {
    const started = Date.now();
    const fresh = await scrapeVenue(v, days);
    const n = countPrograms(fresh.days);
    let data = { ...fresh, stale: false, lastOkAt: fresh.updatedAt };
    if (n === 0) {
      const prev = await loadPrevious(v.id);
      const filled = Object.fromEntries(days.map((d) => [d.iso, prev?.days?.[d.iso] ?? []]));
      data = { ...fresh, days: filled, stale: true, lastOkAt: prev ? (prev.lastOkAt ?? prev.updatedAt) : null };
    }
    await fs.writeFile(path.join(outDir, 'schedules', `${v.id}.json`), JSON.stringify(data));
    console.log(`${n === 0 ? '✗' : '✓'} ${v.name}  ${n}公演  ${((Date.now() - started) / 1000).toFixed(1)}s${fresh.errors.length ? '  ' + fresh.errors[0] : ''}${data.stale ? '  → 前回のデータで表示' : ''}`);
    return { id: v.id, name: v.name, programs: n, firstError: fresh.errors[0] || '', stale: data.stale, lastOkAt: data.lastOkAt };
  }));

  const index = all.map((v) => {
    const s = summary.find((x) => x.id === v.id);
    return { id: v.id, name: v.name, short: v.short, pref: v.pref, area: v.area, kind: v.kind, lat: v.lat, lng: v.lng, url: ADAPTERS[v.adapter].pageUrl(v), ...(s ? { lastPrograms: s.programs, stale: s.stale, lastOkAt: s.lastOkAt } : {}) };
  });
  await fs.writeFile(path.join(outDir, 'venues.json'), JSON.stringify({ generatedAt: new Date().toISOString(), days: days.map((d) => d.iso), venues: index }, null, 1));

  const failed = summary.filter((s) => s.programs === 0);
  console.log(`\n完了: ${summary.length}軒 / 取得できなかった寄席: ${failed.length}${failed.length ? ' (' + failed.map((f) => f.id).join(', ') + ')' : ''}`);
  await writeReport({ failed, total: summary.length });
}

/** 取得結果の報告。GitHub Actions では実行結果のページに表を出し、report.json を通知用に残す */
async function writeReport({ failed, total }) {
  const jst = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '前回分なし');
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ total, failed }, null, 1));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  let md = `## 番組の取得結果\n\n${total}軒中、取得できなかった寄席 **${failed.length}**\n`;
  if (failed.length) md += `\n| 寄席 | id | 表示中データの取得時刻 | 内容 |\n|---|---|---|---|\n` + failed.map((s) => `| ${s.name} | \`${s.id}\` | ${jst(s.lastOkAt)} | ${s.firstError.replace(/\|/g, '/').slice(0, 80) || '0件'} |`).join('\n') + '\n';
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md);
}

main().catch((e) => { console.error(e); process.exit(1); });
