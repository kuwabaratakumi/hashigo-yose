// 共通ユーティリティ
import iconv from 'iconv-lite';
import { BOT_UA } from '../public/site-info.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTTP GET（リトライ付き）。サイト名と連絡先を名乗ってアクセスする（ブラウザのふりはしない） */
export async function get(url, { encoding = 'utf-8', json = false, retries = 2, method = 'GET', body = null, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { method, body, headers: { 'User-Agent': BOT_UA, 'Accept-Language': 'ja', ...headers }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      if (json) return await res.json();
      const buf = Buffer.from(await res.arrayBuffer());
      return encoding.toLowerCase() === 'utf-8' ? buf.toString('utf-8') : iconv.decode(buf, encoding);
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/** 日本時間で今日から n 日分の日付 [{ymd:'20261009', iso:'2026-10-09', y, m, d}] */
export function nextDays(n = 10) {
  const out = [];
  const now = new Date(Date.now() + 9 * 3600e3); // JST
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const iso = d.toISOString().slice(0, 10);
    out.push({ iso, ymd: iso.replaceAll('-', ''), y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
  }
  return out;
}

/** 全角英数→半角、空白をひとつに */
export function clean(s = '') {
  return String(s).normalize('NFKC').replace(/[\s　]+/g, ' ').trim();
}

/** 芸人名：寄席の番付は字間に空白を入れるので、空白をすべて取る（「柳　家　小　次　郎」→「柳家小次郎」） */
export function nameOf(s = '') {
  return String(s).normalize('NFKC').replace(/[\s　 ]+/g, '')
    .replace(/(?<=[ァ-ヶー])[-‐－−](?=[ァ-ヶー]|$)/g, 'ー') // 「ホンキ－トンク」→「ホンキートンク」
    .replace(/^[・／/.]+|[・／/.]+$/g, '');
}

/**
 * 時刻の書き方いろいろを "HH:MM" に
 *  "12:30" "１２：３０" "12時30分" "11 時 40 分" "午後6時30分" "18時" "10時（開場9時30分）"
 */
export function hm(s = '') {
  const t = String(s).normalize('NFKC').replace(/\s+/g, '');
  let m = t.match(/(午前|午後)?(\d{1,2})(?::|時)(\d{1,2})?/);
  if (!m) return '';
  let h = Number(m[2]);
  if (m[1] === '午後' && h < 12) h += 12;
  return `${String(h).padStart(2, '0')}:${String(Number(m[3] || 0)).padStart(2, '0')}`;
}

/** "HH:MM" に分を足す */
export function addMinutes(t, min) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const x = h * 60 + m + Number(min);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

/** HTML文字列 → 改行付きのプレーンテキスト */
export function htmlToText(s = '') {
  return String(s)
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>\n?/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8211;/g, '–');
}

/** 今日(JST)を基準に、月日から年を補って ISO 日付にする */
export function isoFrom(month, day, year = null) {
  const now = new Date(Date.now() + 9 * 3600e3);
  let y = year ?? now.getUTCFullYear();
  if (!year) {
    const diff = (Date.UTC(y, month - 1, day) - now.getTime()) / 864e5;
    if (diff < -180) y += 1; else if (diff > 180) y -= 1;
  }
  return new Date(Date.UTC(y, month - 1, day)).toISOString().slice(0, 10);
}

/** 席（上席・中席・下席）の期間。下席は月末まで（31日は余一会のことが多いが、席の側では含めない） */
export function sekiRange(month, seki, year = null) {
  const start = { kami: 1, naka: 11, shimo: 21 }[seki];
  const end = { kami: 10, naka: 20, shimo: 30 }[seki];
  const out = [];
  for (let d = start; d <= end; d++) out.push(isoFrom(month, d, year));
  return out;
}

/** "11,12,13,17,18日" "[13,14,15日出演]" → 日の数字の集合 */
export function daySet(s = '') {
  const t = String(s).normalize('NFKC');
  const out = new Set();
  for (const part of t.replace(/日.*$/, '').split(/[,、・]/)) {
    const r = part.match(/(\d{1,2})\s*[~〜～\-]\s*(\d{1,2})/);
    if (r) { for (let i = Number(r[1]); i <= Number(r[2]); i++) out.add(i); continue; }
    const n = part.match(/\d{1,2}/);
    if (n) out.add(Number(n[0]));
  }
  return out;
}

/** 色物の種類（番付の左側）。番付の文字から最初に当たる種類を取る */
export const GENRES = [
  '真打昇進披露口上', '口上', '上方落語', '新作落語', '落語', '講談', '浪曲', '漫才', 'ウクレレ漫談', 'ギター漫談', 'バイオリン漫談', 'ムード歌謡漫談', '三味線漫談', '漫談', 'コント',
  '奇術', 'マジック', '手品', '紙切り', '太神楽曲芸', '太神楽', '曲芸', '曲独楽', '曲ごま', 'ジャグリング', 'パントマイム',
  '粋曲', '俗曲', '音曲', '浮世節', '民謡', '新内', '女道楽', '江戸売り声', '津軽三味線', '三味線', '音楽', '歌謡',
  '声帯模写', '動物ものまね', '物まね', 'ものまね', '音まね', '腹話術', '踊り', '江戸芸かっぽれ', 'ワンマン笑', 'ボーイズ',
];

/** 番組を数える（取得件数の確認用）：日ごとの公演の数 */
export const countPrograms = (days) => Object.values(days).reduce((n, list) => n + list.length, 0);

/** 公演の終わりが分からないときの目安（分） */
export const DEFAULT_LENGTH = { 定席: 240, 昼席: 160, 夜席: 150, 朝席: 120, 深夜: 120, 会: 150 };

/**
 * 上方の寄席でよくある1行の番組「桂健枝郎／桂弥っこ／春野恵子（浪曲・曲師：藤初雪）／笑福亭仁昇※～仲入～露の紫／…」を出演者の並びにする。
 *  「名前（種類）」「名前「演目」」「ゲスト：名前」「開演前の一席 名前」「【博多にわか】名前・名前」に対応
 */
const GENRE_HINT = /浪曲|曲|芸|漫|奇術|マジック|手品|紙切|まね|太神楽|にわか|三味線|女道楽|講談|歌|踊|ギター|コント|ジャグ|腹話|パント|落語|弁士|音楽/;

export function parseLineup(text = '') {
  const t = String(text).normalize('NFKC')
    .replace(/[（(]※[^）)]*[）)]/g, '')
    .replace(/[~〜～]\s*(仲入り?|中入り?)\s*[~〜～]/g, '／仲入／')
    .replace(/\n+/g, '／');
  const acts = [];
  for (let raw of t.split(/[／/]/)) {
    raw = raw.replace(/※/g, '').trim();
    if (!raw) continue;
    if (/^(仲入り?|中入り?)$/.test(raw.replace(/\s/g, ''))) { acts.push({ break: true }); continue; }
    let role = '', note = '', genre = '';
    let pre;
    while ((pre = raw.match(/^(開演前の一席|開口一番|ゲスト|特別ゲスト|トーク|対談)[:：\s]*/))) {
      if (/ゲスト/.test(pre[1])) note = 'ゲスト'; else role = pre[1];
      raw = raw.slice(pre[0].length);
    }
    const br = raw.match(/^【([^】]+)】/);
    if (br) { genre = br[1]; raw = raw.slice(br[0].length); }
    let titles = [...raw.matchAll(/「([^」]*)」?/g)].map((m) => m[1]).filter(Boolean);
    if (titles.includes('開口一番')) { role = '開口一番'; titles = titles.filter((x) => x !== '開口一番'); }
    raw = raw.replace(/「[^」]*」?/g, '');
    const paren = raw.match(/[（(]([^）)]*)[）)]/);
    if (paren) {
      raw = raw.replace(paren[0], '');
      if (/開口一番/.test(paren[1])) role = '開口一番';
      else if (/席$/.test(paren[1])) note = paren[1];
      else {
        // 「浪曲・曲師：藤初雪」→ 種類は浪曲、曲師はメモ。「曲師・沢村道世、トリをつとめます」は全部メモ
        const [first, ...rest] = paren[1].split(/[・、]/);
        if (GENRE_HINT.test(first) && !/曲師/.test(first) && first.length <= 10) { genre ||= first; if (rest.length) note = rest.join('・'); }
        else note = paren[1];
      }
    }
    const name = nameOf(raw.replace(/他\s*一席|ほか.*$/, ''));
    if (!name || name.length > 20) continue;
    acts.push({ name, ...(genre ? { genre } : {}), ...(role ? { role } : {}), ...(note ? { note } : {}), ...(titles.length ? { neta: titles.join('・') } : {}) });
  }
  return acts;
}
