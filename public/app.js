import { isHoliday } from './holidays.js';
// しびれろ！はしご寄席 — 選んだ寄席の10日間の番組、芸人さがし、推しを追いかけるはしご
const LS_KEY = 'hashigo-yose:venues';
const LS_VIEW = 'hashigo-yose:view';
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境でも表示は続ける */ } },
};

const state = {
  index: null,           // data/venues.json
  selected: store.get(LS_KEY, null),
  date: null,
  view: store.get(LS_VIEW, 'bangumi'),
  q: '',
  cache: new Map(),       // id -> schedule json（Promise）
};

let renderSeq = 0;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 名前の照合用：全角半角・空白・ひらがなカタカナの違いをならす */
const norm = (s = '') => s.normalize('NFKC').toLowerCase().replace(/[\s・]/g, '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hits = (name, q) => !!q && norm(name).includes(q);

function jstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { iso: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) };
}
const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`);
const venueOf = (id) => state.index.venues.find((v) => v.id === id);
const dateLabel = (iso) => {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}（${DOW[dow]}${isHoliday(iso) ? '・祝' : ''}）`;
};

async function loadIndex() {
  const res = await fetch(`data/venues.json?t=${Date.now()}`);
  if (!res.ok) throw new Error('寄席の一覧を読み込めませんでした');
  return res.json();
}
function loadSchedule(id) {
  if (!state.cache.has(id)) {
    state.cache.set(id, fetch(`data/schedules/${id}.json?t=${Math.floor(Date.now() / 6e5)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return state.cache.get(id);
}

/* ---------- 外部リンク ---------- */
const mapUrl = (v) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.name)}`;
function calUrl(date, { title, venue, start, end, url }) {
  const d = date.replaceAll('-', '');
  const t = (hm) => hm.replace(':', '') + '00';
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${d}T${t(start)}/${d}T${t(end || start)}`, ctz: 'Asia/Tokyo', location: venue.name, details: `${url}\n※出演者・時刻は変わることがあります。公式サイトでご確認ください。` });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/* ---------- 日付の帯 ---------- */
function renderDays() {
  const today = jstNow().iso;
  const days = state.index.days.filter((d) => d >= today);
  if (!days.includes(state.date)) state.date = days[0];
  $('#days').style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
  $('#days').innerHTML = days.map((iso) => {
    const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
    const m = Number(iso.slice(5, 7));
    const showMonth = iso === days[0] || iso.endsWith('-01');
    return `<button class="day" type="button" data-date="${iso}" data-dow="${dow}"${isHoliday(iso) ? ' data-hol="1"' : ''} ${iso === state.date ? 'aria-current="date"' : ''} aria-label="${m}月${Number(iso.slice(8))}日 ${DOW[dow]}曜">
      <span class="day__m">${showMonth ? m + '月' : ''}</span>
      <span class="day__d">${Number(iso.slice(8))}</span>
      <span class="day__w">${iso === today ? '今日' : DOW[dow]}</span></button>`;
  }).join('');
}

/* ---------- 本体 ---------- */
const fmtJst = (iso) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hint = (text) => `<p class="hint">${text}</p>`;

async function render() {
  $('#pickCount').textContent = state.selected.length;
  document.querySelectorAll('.view button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#hashigo').hidden = state.view !== 'hashigo';
  $('.search').hidden = state.view === 'hashigo';
  $('#q').placeholder = '芸人さんの名前で絞り込む（例: 喬太郎）';
  if (state.view === 'hashigo') return renderHashigo();
  if (state.view === 'geinin') return renderGeinin();
  return renderBangumi();
}

/** 番組の1公演 */
function programHtml(v, p, { q = '', date = state.date } = {}) {
  const now = jstNow();
  const past = date === now.iso && p.end && toMin(p.end) < toMin(now.hm);
  const links = `<span class="prog__links"><a class="th-btn" href="${esc(p.url || v.url)}" target="_blank" rel="noopener noreferrer">公式の番組</a>${p.start ? `<a class="th-btn" href="${esc(calUrl(date, { title: `${v.short || v.name} ${p.part || ''} ${p.title || ''}`.trim(), venue: v, start: p.start, end: p.end, url: p.url || v.url }))}" target="_blank" rel="noopener noreferrer">カレンダーに登録</a>` : ''}</span>`;
  const time = p.start ? `<span class="prog__time">${esc(p.start)}${p.end ? `〜${esc(p.end)}` : ''}${p.endEst || p.startEst ? '<small>頃</small>' : ''}</span>` : '';
  const showTitle = p.title && p.title !== p.part;
  const head = `<div class="prog__head"><span class="prog__part">${esc(p.part || '公演')}</span>${time}${showTitle ? `<span class="prog__title">${esc(p.title)}</span>` : ''}${p.hall ? `<span class="prog__title">${esc(p.hall)}</span>` : ''}${p.note ? `<span class="prog__note">${esc(p.note)}</span>` : ''}${links}</div>`;
  if (p.linkOnly) {
    return `<article class="prog">${head}<p class="link-only">${p.image ? `<a href="${esc(p.image)}" target="_blank" rel="noopener noreferrer">番組表（画像）を見る</a>` : `<a href="${esc(p.url || v.url)}" target="_blank" rel="noopener noreferrer">番組は公式サイトで確認</a>`}</p></article>`;
  }
  const rows = (p.acts || []).map((a) => {
    if (a.break) return '<li class="nakairi">仲入り</li>';
    const role = a.role === '主任' ? '<span class="badge">主任</span>' : a.role ? `<span class="badge badge--soft">${esc(a.role)}</span>` : '';
    const sub = [a.neta ? `「${a.neta}」` : '', a.note].filter(Boolean).join(' ');
    return `<li class="act-row${a.role === '主任' ? ' is-tori' : ''}${hits(a.name, q) || (a.alts || []).some((n) => hits(n, q)) ? ' is-hit' : ''}${a.tbd ? ' is-tbd' : ''}">
      <span class="act-row__at">${esc(a.at || '')}</span><span class="act-row__genre">${esc(a.genre || '')}</span>
      <span class="act-row__name">${esc(a.name)}${role}${sub ? `<small>${esc(sub)}</small>` : ''}</span></li>`;
  }).join('');
  return `<article class="prog${past ? ' is-past' : ''}">${head}${rows ? `<ol class="acts">${rows}</ol>` : '<p class="link-only">出演者は公式サイトでご確認ください。</p>'}</article>`;
}

async function renderBangumi() {
  const main = $('#main');
  if (!state.selected.length) { renderSeq++; main.replaceChildren($('#tplEmpty').content.cloneNode(true)); return; }
  const venues = state.selected.map(venueOf).filter(Boolean);
  const seq = ++renderSeq;
  if (venues.some((v) => !state.cache.has(v.id)) || main.querySelector('.empty')) main.innerHTML = hint('番組を読み込んでいます…');
  const schedules = await Promise.all(venues.map((v) => loadSchedule(v.id)));
  if (seq !== renderSeq) return;
  fillNames(schedules, [state.date]);
  const q = norm(state.q);
  main.innerHTML = venues.map((v, i) => {
    const sch = schedules[i];
    const head = `<header class="theater__head"><div class="theater__title"><h2 class="theater__name">${esc(v.name)}</h2>
        <a class="th-btn" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">公式サイト</a>
        <a class="th-btn" href="${esc(mapUrl(v))}" target="_blank" rel="noopener noreferrer">Googleマップ</a></div>
      <span class="theater__meta">${esc(v.pref)}・${esc(v.area)}</span></header>`;
    if (!sch) return `<section class="theater">${head}<p class="theater__note">この寄席のデータがまだありません。次の自動更新で取得されます。</p></section>`;
    const stale = sch.stale ? `<p class="stale-note">この寄席は最新の番組を取得できていません。${sch.lastOkAt ? `${fmtJst(sch.lastOkAt)}時点の情報を表示しています。` : ''}公式サイトでご確認ください。</p>` : '';
    let progs = sch.days?.[state.date] || [];
    if (q) progs = progs.filter((p) => (p.acts || []).some((a) => hits(a.name, q) || (a.alts || []).some((n) => hits(n, q))));
    if (!progs.length) return `<section class="theater">${head}${stale}<p class="theater__note">${q ? `「${esc(state.q)}」の出演はこの日ありません。` : 'この日の番組はまだ公開されていません。'}</p></section>`;
    return `<section class="theater">${head}${stale}${progs.map((p) => programHtml(v, p, { q })).join('')}</section>`;
  }).join('');
}

/** 名前の入力候補 */
function fillNames(schedules, dates) {
  const names = new Set();
  for (const sc of schedules) for (const d of dates) for (const p of sc?.days?.[d] || []) for (const a of p.acts || []) {
    if (a.break || a.tbd) continue;
    for (const n of a.alts || [a.name]) names.add(n);
  }
  const html = [...names].sort((a, b) => a.localeCompare(b, 'ja')).map((n) => `<option value="${esc(n)}">`).join('');
  if ($('#nameList').dataset.html !== html) { $('#nameList').innerHTML = html; $('#nameList').dataset.html = html; }
}

/* ---------- 芸人さがし：選んだ日の、選んだ寄席の出演者一覧 ---------- */
async function renderGeinin() {
  const main = $('#main');
  if (!state.selected.length) { renderSeq++; main.replaceChildren($('#tplEmpty').content.cloneNode(true)); return; }
  const seq = ++renderSeq;
  const ids = state.selected.filter((id) => venueOf(id));
  if (ids.some((id) => !state.cache.has(id))) main.innerHTML = hint('番組を読み込んでいます…');
  const schedules = await Promise.all(ids.map(loadSchedule));
  if (seq !== renderSeq) return;
  fillNames(schedules, [state.date]);
  const q = norm(state.q);
  const hitAct = (a) => hits(a.name, q) || (a.alts || []).some((n) => hits(n, q));

  // その日の出演者一覧（寄席ごと・公演ごとに名前を並べる）
  const list = ids.map((id, i) => {
    const v = venueOf(id);
    const progs = (schedules[i]?.days?.[state.date] || []).filter((p) => !p.linkOnly && (p.acts || []).some((a) => !a.break));
    const rows = progs.map((p) => {
      const acts = (p.acts || []).filter((a) => !a.break && !a.tbd && (!q || hitAct(a)));
      if (!acts.length) return '';
      return `<div class="cast__row"><div class="cast__part">${esc(p.part || '公演')}${p.start ? `<span>${esc(p.start)}〜</span>` : ''}</div>
        <div class="cast__names">${acts.map((a) => `<button type="button" class="cast__name${a.role === '主任' ? ' is-tori' : ''}${q && hitAct(a) ? ' is-hit' : ''}" data-name="${esc(a.alts ? a.alts[0] : a.name)}">${esc(a.name)}${a.at ? `<small>${esc(a.at)}</small>` : ''}</button>`).join('')}</div></div>`;
    }).join('');
    if (!rows) return q ? '' : `<section class="cast"><h2 class="cast__venue">${esc(v.name)}</h2><p class="theater__note">${progs.length ? '' : 'この日の出演者は公式サイトでご確認ください。'}</p></section>`;
    return `<section class="cast"><h2 class="cast__venue">${esc(v.name)}</h2>${rows}</section>`;
  }).join('');

  // 名前で絞ったときは、その人のこれから10日間の出演も出す
  let ahead = '';
  if (q) {
    const today = jstNow().iso;
    const days = state.index.days.filter((d) => d >= today && d !== state.date);
    const rows = [];
    schedules.forEach((sc, i) => {
      const v = venueOf(ids[i]);
      for (const d of days) for (const p of sc?.days?.[d] || []) for (const a of p.acts || []) if (!a.break && hitAct(a)) rows.push({ d, v, p, a });
    });
    rows.sort((x, y) => x.d.localeCompare(y.d) || (x.a.at || '99').localeCompare(y.a.at || '99'));
    if (rows.length) ahead = `<h2 class="find__head">ほかの日の出演</h2>` + rows.map(({ d, v, p, a }) => `<div class="find__row">
      <span class="find__at">${dateLabel(d)}</span>
      <div><div class="find__who">${esc(a.name)}${a.role === '主任' ? '<span class="badge">主任</span>' : ''}</div>
      <div class="find__where">${esc(v.name)}　${esc(p.part || '')} ${esc(a.at || '')}頃</div></div></div>`).join('');
  }
  main.innerHTML = list || ahead
    ? `<div class="find">${list || hint(`「${esc(state.q)}」はこの日の出演がありません。`)}${ahead}</div>`
    : hint(q ? `「${esc(state.q)}」の出演は、選んだ寄席の番組に見つかりませんでした。` : 'この日の番組はまだ公開されていません。');
}

/* ---------- はしご：推しを何人か、同じ日に順番に観る ---------- */
// 寄席どうしの移動時間の目安（直線距離から。電車移動を想定して 10分＋1kmあたり約2.2分、5分単位）
function travelMin(a, b) {
  const A = venueOf(a), B = venueOf(b);
  if (!A?.lat || !B?.lat) return 30;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (B.lat - A.lat) * rad, dLng = (B.lng - A.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(A.lat * rad) * Math.cos(B.lat * rad) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h));
  return Math.max(15, Math.ceil((10 + km * 2.2) / 5) * 5);
}

async function renderHashigo() {
  const main = $('#main');
  const seq = ++renderSeq;
  const f = $('#hashigoForm');
  const scopeAll = f.querySelector('input[name=scope]:checked').value === 'all';
  const ids = scopeAll ? state.index.venues.map((v) => v.id) : state.selected;
  if (!ids.length) { main.innerHTML = hint('「寄席を選ぶ」で寄席を選ぶか、探す範囲を「すべての寄席」にしてください。'); return; }
  if (ids.some((id) => !state.cache.has(id))) main.innerHTML = hint('番組を読み込んでいます…');
  const schedules = await Promise.all(ids.map(loadSchedule));
  if (seq !== renderSeq) return;
  fillNames(schedules, [state.date]);
  const words = [...f.querySelectorAll('input[name=n]')].map((i) => i.value.trim()).filter(Boolean);
  if (words.length < 2) {
    main.innerHTML = hint('芸人さんを2人以上入れると、その日に順番に観られる寄席と時刻の組み合わせを出します。同じ番組に出ていればそのまま、別の寄席なら移動時間の目安を見込みます。');
    return;
  }
  const now = jstNow();
  const isToday = state.date === now.iso;
  // 名前ごとに、この日の高座を全部集める
  const cands = words.map((w) => {
    const q = norm(w);
    const out = [];
    schedules.forEach((sc, i) => {
      (sc?.days?.[state.date] || []).forEach((p, pi) => {
        for (const a of p.acts || []) {
          if (a.break || !a.at || !(hits(a.name, q) || (a.alts || []).some((n) => hits(n, q)))) continue;
          if (isToday && toMin(a.until) < toMin(now.hm)) continue;
          out.push({ vid: ids[i], pkey: `${ids[i]}#${pi}`, p, a, w, s: toMin(a.at), e: toMin(a.until) });
        }
      });
    });
    return out;
  });
  const missing = words.filter((_, i) => !cands[i].length);
  if (missing.length) {
    main.innerHTML = hint(`「${missing.map(esc).join('」「')}」は、この日${scopeAll ? 'どの寄席にも' : '選んだ寄席には'}${isToday ? 'これから' : ''}出演がありません。` + (scopeAll ? '芸人さがしで、ほかの日の出演を探せます。' : '探す範囲を「すべての寄席」にすると見つかるかもしれません。'));
    return;
  }
  // 順番を入れ替えながら、間に合う高座だけをつなぐ
  const n = words.length;
  const plans = [];
  const chain = [];
  (function dfs(used) {
    if (plans.length >= 5000) return;
    if (chain.length === n) { plans.push([...chain]); return; }
    const prev = chain.at(-1);
    for (let i = 0; i < n; i++) {
      if (used & (1 << i)) continue;
      for (const c of cands[i]) {
        if (prev) {
          const need = prev.pkey === c.pkey ? 0 : prev.vid === c.vid ? 15 : travelMin(prev.vid, c.vid);
          if (c.s < prev.e + need) continue;
        }
        chain.push(c); dfs(used | (1 << i)); chain.pop();
      }
    }
  })(0);
  if (!plans.length) {
    main.innerHTML = hint(`この日は、${n}人を順番に観られる組み合わせが見つかりませんでした。高座の時刻は目安なので、同じ時間帯に出る人どうしは一緒に観られません。別の日や、探す範囲を広げて試してください。`);
    return;
  }
  const score = (p) => ({
    span: p.at(-1).e - p[0].s,
    tickets: new Set(p.map((c) => c.pkey)).size,
    move: p.slice(1).reduce((s, c, i) => s + (c.vid === p[i].vid ? 0 : travelMin(p[i].vid, c.vid)), 0),
  });
  const ranked = plans.map((p) => ({ p, ...score(p) })).sort((a, b) => a.tickets - b.tickets || a.span - b.span || a.move - b.move).slice(0, 20);
  main.innerHTML = `<div class="plans"><p class="hint">入る番組が少なく、短い時間で回れる順に${ranked.length}件を表示しています。高座の時刻は番組表から出した目安です。</p>` +
    ranked.map(({ p, tickets, move }) => {
      const legs = [];
      p.forEach((c, i) => {
        const v = venueOf(c.vid);
        if (i > 0) {
          const prev = p[i - 1];
          const gap = c.s - prev.e;
          const label = prev.pkey === c.pkey ? `同じ番組のまま（約${fmtMin(Math.max(0, gap))}後）` : prev.vid === c.vid ? `同じ寄席の次の番組へ（入れ替え・約${fmtMin(gap)}）` : `移動 約${fmtMin(travelMin(prev.vid, c.vid))}（余裕 ${fmtMin(gap)}）`;
          legs.push(`<div class="gap${prev.vid !== c.vid ? ' is-move' : ''}">${label}</div>`);
        }
        const enter = i === 0 || p[i - 1].pkey !== c.pkey;
        legs.push(`<div class="leg"><span class="leg__time">${c.a.at}<small>頃</small></span>
          <div><div class="leg__who">${esc(c.a.name)}${c.a.role === '主任' ? '<span class="badge">主任</span>' : ''}</div>
          <div class="leg__where">${esc(v.name)}　${esc(c.p.part || '')} ${esc(c.p.start || '')}〜${esc(c.p.end || '')}${enter ? '　<a href="' + esc(c.p.url || v.url) + '" target="_blank" rel="noopener noreferrer">番組</a>' : ''}</div></div></div>`);
      });
      return `<article class="plan"><div class="plan__head"><span class="plan__span">${p[0].a.at}〜${p.at(-1).a.until}</span><span class="plan__meta">入る番組 ${tickets}つ${move ? `／移動 約${fmtMin(move)}` : ''}</span></div>${legs.join('')}</article>`;
    }).join('') + '</div>';
}

/* ---------- 寄席の選択 ---------- */
function renderPicker() {
  const ORDER = ['東京', '神奈川', '大阪', '兵庫'];
  const prefs = [...new Set(state.index.venues.map((v) => v.pref))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  $('#pickerList').innerHTML = prefs.map((pref) => {
    const list = state.index.venues.filter((v) => v.pref === pref);
    return `<div class="pref"><div class="pref__head"><h3>${esc(pref)}</h3></div><div class="opts">${list.map((v) => `<label class="opt"><input type="checkbox" value="${v.id}" ${state.selected.includes(v.id) ? 'checked' : ''}><span>${esc(v.name)}${v.stale ? '<span class="opt__stale">更新できていません</span>' : ''}</span></label>`).join('')}</div></div>`;
  }).join('');
}
function setSelected(ids) {
  state.selected = ids;
  store.set(LS_KEY, ids);
}

function bind() {
  const dlg = $('#picker');
  const open = () => { renderPicker(); dlg.showModal(); };
  $('#openPicker').addEventListener('click', open);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-picker]')) open(); });
  $('#pickerList').addEventListener('change', (e) => {
    const id = e.target.value;
    setSelected(e.target.checked ? [...state.selected, id] : state.selected.filter((x) => x !== id));
    $('#pickCount').textContent = state.selected.length;
  });
  $('#clearPick').addEventListener('click', () => { setSelected([]); renderPicker(); $('#pickCount').textContent = 0; });
  dlg.addEventListener('close', render);
  $('#days').addEventListener('click', (e) => {
    const b = e.target.closest('.day');
    if (!b) return;
    state.date = b.dataset.date;
    renderDays();
    render();
  });
  document.querySelector('.view').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    store.set(LS_VIEW, state.view);
    render();
  });
  $('#main').addEventListener('click', (e) => {
    const b = e.target.closest('.cast__name');
    if (!b) return;
    $('#q').value = b.dataset.name;
    state.q = b.dataset.name;
    render();
    window.scrollTo({ top: 0 });
  });
  let t;
  $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 150); });
  $('#hashigoForm').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
  $('#hashigoForm').addEventListener('submit', (e) => e.preventDefault());
}

(async function init() {
  try {
    state.index = await loadIndex();
  } catch (e) {
    $('#main').innerHTML = hint('番組データを読み込めませんでした。しばらくしてから開き直してください。');
    return;
  }
  const known = new Set(state.index.venues.map((v) => v.id));
  // はじめては東京の4つの定席
  if (!Array.isArray(state.selected)) setSelected(state.index.venues.filter((v) => v.pref === '東京').map((v) => v.id));
  else setSelected(state.selected.filter((id) => known.has(id)));
  if (!['bangumi', 'geinin', 'hashigo'].includes(state.view)) state.view = 'bangumi';
  const at = state.index.generatedAt;
  $('#updated').textContent = at ? `番組の取得：${fmtJst(at)}` : '';
  renderDays();
  bind();
  render();
})();
