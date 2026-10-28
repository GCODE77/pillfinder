// 필파인더 화면 로직
import { readImprint, warmUpOcr } from './ocr.js';
import * as SH from './share.js';
import { shapeTile, formTile } from './shapes.js';

const APP_VERSION = '1.11.2';
const V = window.Vision, M = window.Match;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 저장(기기 안에만) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('저장 공간이 부족합니다'); } },
};
const settings = Object.assign({ auto: true, share: true, cardGuide: true, coin: '24', ai: false, aiKey: '', aiModel: 'claude-opus-5-5' }, store.get('pf.settings', {}));
const saveSettings = () => store.set('pf.settings', settings);
let favs = store.get('pf.favs', []);
let hist = store.get('pf.hist', []);
// 확인된 약: 사용자가 "이 약이 맞아요"를 누른 사진의 각인 지문(32×32, 8비트) — 다음에 같은 약을 찍으면 맨 위로
let learned = store.get('pf.learned', []);
const packDesc = (d) => { const b = new Int8Array(d.length); for (let i = 0; i < d.length; i++) b[i] = Math.max(-127, Math.min(127, Math.round(d[i] * 32))); let s = ''; for (const v of new Uint8Array(b.buffer)) s += String.fromCharCode(v); return btoa(s); };
const unpackDesc = (t) => { const s = atob(t), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); const b = new Int8Array(u.buffer); const d = new Float32Array(b.length); for (let i = 0; i < b.length; i++) d[i] = b[i] / 32; return d; };
let learnedCache = null;
// 공유 학습: 다른 사용자들이 확인한 지문(기기 2대 이상 일치한 것만) — 하루 한 번 새로 받는다
let shared = store.get('pf.shared', { t: 0, list: [] });
const learnedDescs = () => (learnedCache ||= [...learned, ...shared.list].map((e) => ({ s: e.s, d: unpackDesc(e.d) })));
async function syncShared() {
  if (!SH.enabled() || !settings.share || Date.now() - shared.t < 864e5) return;
  const list = await SH.download();
  if (!list) return;
  shared = { t: Date.now(), list }; learnedCache = null; store.set('pf.shared', shared);
}

// 기준 물체(동전 또는 카드)로 약 크기를 mm로 환산. 카드는 두 변(85.6×54mm)의 평균 배율을 쓴다
function mmFrom(pill, res) {
  const scale = (ref) => (ref.kind === 'card' ? (85.6 / ref.long + 53.98 / ref.short) / 2 : Number(settings.coin) / ref.long);
  const us = [res.coin, res.coin2].filter(Boolean).map(scale);
  const u = us.reduce((s, x) => s + x, 0) / us.length;
  return { long: pill.long * u, short: pill.short * u };
}
// 쓴 기준 이름: 카드 / 동전 / 카드·동전
// 설정의 기준 동전 이름(10·50·100·500원)
const coinName = () => ({ 18: '10원', 21.6: '50원', 24: '100원', 26.5: '500원' }[Number(settings.coin)] || '동전');
const refLabel = (res) => (res.coin2 ? `카드·${coinName()}` : res.coin && res.coin.kind === 'card' ? '카드' : coinName());

function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms);
}

// ---------- 데이터 ----------
const DEMO = new URLSearchParams(location.search).has('demo');
const BASE = DEMO ? 'tests/demo/' : 'data/';
const data = { db: [], bySeq: new Map(), meta: null, ready: false, shards: new Map() };

async function loadData() {
  try {
    const [meta, db] = await Promise.all([
      fetch(BASE + 'meta.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw 0; return r.json(); }),
      fetch(BASE + 'pills.json').then((r) => { if (!r.ok) throw 0; return r.json(); }),
    ]);
    data.meta = meta; data.db = db;
    for (const r of db) data.bySeq.set(r.s, r);
    data.ready = true;
    const d = new Date(meta.updated);
    $('#dbInfo').textContent = `${db.length.toLocaleString()}품목 · ${d.getMonth() + 1}/${d.getDate()} 갱신`;
    $('#sData').textContent = `낱알 ${db.length.toLocaleString()}품목, 상세 ${Number(meta.details || 0).toLocaleString()}품목 · ${d.toLocaleDateString('ko-KR')} 기준${DEMO ? ' (데모 데이터)' : ''}`;
    if (DEMO) showBanner('데모 데이터로 실행 중입니다. 약 이름·정보는 모두 가짜입니다.');
  } catch {
    showBanner('약 데이터가 아직 없습니다. 관리자가 식약처 인증키로 데이터를 만들어야 합니다(README의 "데이터 만들기"). 카메라 분석은 되지만 약 이름은 찾을 수 없습니다.', true);
    $('#sData').textContent = '데이터 없음';
  }
  route();
}
function showBanner(msg, err) { const b = $('#dataBanner'); b.textContent = msg; b.classList.toggle('err', !!err); b.classList.remove('hidden'); }

async function detailOf(seq) {
  const k = String(seq).slice(-2).padStart(2, '0');
  if (!data.shards.has(k)) data.shards.set(k, fetch(`${BASE}details/${k}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return (await data.shards.get(k))[seq];
}

// ---------- 보기 도구 ----------
const SWATCH = { 하양: '#f5f5f0', 노랑: '#f2d34b', 주황: '#ef9443', 분홍: '#f3abc0', 빨강: '#d23b3b', 갈색: '#8f5c37', 연두: '#b3d662', 초록: '#2f9a52', 청록: '#25a5a3', 파랑: '#3d6fd0', 남색: '#25307a', 자주: '#9d2f74', 보라: '#7d55b3', 회색: '#9a9ca0', 검정: '#25262a', 투명: 'rgba(255,255,255,.25)' };
const COLOR_LIST = Object.keys(SWATCH);

// 사진이 없는 약은 모양·색으로 그린 그림
function glyph(r) {
  const cs = M.dbColors(r);
  const c1 = SWATCH[cs[0]] || '#ccc', c2 = SWATCH[cs[1]] || c1;
  const sh = r.sh || '';
  let path;
  if (/원형/.test(sh) && !/타원|반원/.test(sh)) path = '<circle cx="46" cy="33" r="24"/>';
  else if (/타원/.test(sh)) path = '<ellipse cx="46" cy="33" rx="34" ry="20"/>';
  else if (/장방/.test(sh)) path = '<rect x="10" y="14" width="72" height="38" rx="19"/>';
  else if (/반원/.test(sh)) path = '<path d="M14 44a32 32 0 0 1 64 0z"/>';
  else if (/삼각/.test(sh)) path = '<path d="M46 8 74 56H18z"/>';
  else if (/마름모/.test(sh)) path = '<path d="M46 6 80 33 46 60 12 33z"/>';
  else if (/사각/.test(sh)) path = '<rect x="20" y="8" width="52" height="50" rx="6"/>';
  else if (/오각/.test(sh)) path = '<path d="M46 6 72 25 62 58H30L20 25z"/>';
  else if (/육각/.test(sh)) path = '<path d="M33 9h26l13 24-13 24H33L20 33z"/>';
  else if (/팔각/.test(sh)) path = '<path d="M36 8h20l14 14v22L56 58H36L22 44V22z"/>';
  else path = '<rect x="14" y="12" width="64" height="42" rx="14"/>';
  return `<svg viewBox="0 0 92 66" width="92" height="66"><defs><linearGradient id="g${r.s}" x1="0" x2="1"><stop offset=".5" stop-color="${c1}"/><stop offset=".5" stop-color="${c2}"/></linearGradient></defs><g fill="url(#g${r.s})" stroke="rgba(0,0,0,.35)">${path}</g><text x="46" y="37" text-anchor="middle" font-size="11" font-weight="800" fill="rgba(0,0,0,.55)">${esc((r.pf || '').slice(0, 8))}</text></svg>`;
}
const imgOf = (r, big) => (r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createRange().createContextualFragment(this.dataset.g))" data-g="${esc(glyph(r))}">` : glyph(r));
const otcBadge = (r) => (r.o ? `<span class="badge ${/전문/.test(r.o) ? 'etc' : 'otc'}">${esc(/전문/.test(r.o) ? '전문' : '일반')}</span>` : '');
const won = (v) => `${Math.round(v).toLocaleString()}원`;
const priceTxt = (r) => (r.pr ? `약가 ${won(r.pr)}/${r.pu || '개'}` : '');
const sizeTxt = (r) => (r.L ? [`장 ${r.L}`, r.W && `단 ${r.W}`, r.T && `두께 ${r.T}`].filter(Boolean).join(' · ') + 'mm' : '');
// 분할선(반절선) 표시: − 한 줄, + 십자, 종류 모르면 '있음'
const lineTxt = (r) => { const l = M.lineOf(r); return l.has ? (l.kinds.length ? l.kinds.map((k) => ({ '-': '−', '+': '+' }[k] || k)).join('/') : '있음') : ''; };
const printTxt = (r) => [r.pf, r.pb].filter((x) => x && x.trim() !== '분할선').join(' / ');

// ---------- 약 비교(2개 담기) ----------
let cmp = [];
function renderTray() {
  const tray = $('#cmpTray'), page = (location.hash || '#/cam').split('/')[1] || 'cam';
  document.querySelectorAll('[data-cmp]').forEach((b) => { const on = cmp.includes(b.dataset.cmp); b.classList.toggle('on', on); b.textContent = on ? '비교 ✓' : '비교 +'; });
  tray.classList.toggle('on', cmp.length > 0 && page !== 'cam' && page !== 'cmp');
  const name = (s) => { const r = data.bySeq && data.bySeq.get(s); return r ? r.n.replace(/\(.*$/, '') : s; };
  const NUM = ['①', '②', '③'];
  tray.innerHTML = `<div class="slots">${cmp.length ? cmp.map((s, i) => `<span>${NUM[i]} ${esc(name(s))}</span>`).join('') : ''}${cmp.length < 2 ? '<span>비교할 약을 하나 더 고르세요</span>' : cmp.length < 3 ? '<span style="color:var(--dim)">하나 더 담으면 3개까지 비교</span>' : ''}</div>
    <button class="primary" id="cmpGo" ${cmp.length < 2 ? 'disabled' : ''}>비교하기</button><button class="ghost" id="cmpClr" aria-label="비교 목록 비우기">비우기</button>`;
  $('#cmpGo').onclick = () => { location.hash = '#/cmp/' + cmp.map(encodeURIComponent).join('/'); };
  $('#cmpClr').onclick = () => { cmp = []; renderTray(); };
}
function toggleCmp(seq) {
  const i = cmp.indexOf(seq);
  if (i >= 0) cmp.splice(i, 1); else { cmp.push(seq); if (cmp.length > 3) cmp.shift(); }
  renderTray();
}

const preCard = (x) => (x.key ? `<input type="checkbox" class="ck" tabindex="-1" ${x.checked ? 'checked' : ''}>` : '') + (x.num ? `<span class="num">${x.num}</span>` : '');
function card(r, extra = {}) {
  const fg = M.formGroup(r);
  const feat = [r.sh, /캡슐/.test(fg) && fg, M.dbColors(r).join('·'), printTxt(r) && `<b>${esc(printTxt(r))}</b>`, lineTxt(r) && `분할선 ${lineTxt(r)}`, r.pr && `<span class="price">${esc(priceTxt(r))}</span>`].filter(Boolean);
  // 크기는 비교하기 쉽게 따로 한 줄(장축·단축·두께)
  const size = r.L ? `<span class="size"><i>장</i>${r.L} <i>단</i>${r.W || '-'} <i>두께</i>${r.T || '-'} <i>mm</i></span>` : '<span class="size"><i>크기 자료 없음</i></span>';
  const cmpb = extra.key ? '' : `<span class="cmpbtn${cmp.includes(r.s) ? ' on' : ''}" role="button" data-cmp="${esc(r.s)}">${cmp.includes(r.s) ? '비교 ✓' : '비교 +'}</span>`;
  const why = extra.parts ? Object.entries(extra.parts).map(([k, v]) => `<span class="${v > 0.75 ? 'hi' : ''}">${{ shape: '모양', color: '색', aspect: '비율', size: '크기', imprint: '각인', line: '분할선', blank: '빈면', form: '제형', hasimp: '각인 유무', splitline: '분할선', learned: '내가 확인한 약' }[k]} ${Math.round(v * 100)}</span>`).join('') : '';
  return `<button class="card${extra.checked ? ' sel' : ''}" data-seq="${esc(r.s)}"${extra.key ? ` data-key="${esc(extra.key)}"` : ''}>
    ${preCard(extra)}<div class="img">${imgOf(r)}</div>
    <div class="body"><div class="name">${otcBadge(r)}${esc(r.n)}</div><div class="sub">${esc(r.e)}${r.cl ? ' · ' + esc(r.cl) : ''}</div>
      <div class="feat">${feat.map((f) => `<span>${f.startsWith('<') ? f : esc(f)}</span>`).join('')}</div><div>${size}${cmpb}</div>${why ? `<div class="why">${why}</div>` : ''}${extra.note ? `<div class="why"><span class="hi">${esc(extra.note)}</span></div>` : ''}</div>
    ${extra.score !== undefined ? `<div class="score">${Math.round(extra.score * 100)}<small>일치</small></div>` : ''}
  </button>`;
}
document.addEventListener('click', (e) => {
  const cb = e.target.closest('[data-cmp]');
  if (cb) { e.preventDefault(); e.stopPropagation(); toggleCmp(cb.dataset.cmp); return; }
  const c = e.target.closest('.card[data-seq]');
  if (c && c.dataset.key) { toggleSel(c.dataset.key); return; }
  if (c) location.hash = '#/item/' + encodeURIComponent(c.dataset.seq);
});

// ---------- 화면 이동 ----------
const PAGES = { cam: '#pgCam', search: '#pgSearch', item: '#pgItem', cmp: '#pgCmp', mine: '#pgMine' };
function route() {
  const [, page = 'cam', arg, arg2, arg3] = (location.hash || '#/cam').split('/');
  if (page === 'shape') { location.replace('#/search'); return; } // 예전 '모양으로' 주소
  const key = PAGES[page] ? page : 'cam';
  if (key !== 'item') document.title = '필파인더 — 찍으면 무슨 약인지';
  for (const k in PAGES) $(PAGES[k]).classList.toggle('on', k === key);
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === key));
  if (key === 'cam') camEnter(); else camLeave();
  if (key === 'search') { runFilter(); if (!matchMedia('(pointer:coarse)').matches) setTimeout(() => $('#q').focus(), 50); }
  if (key === 'item') showItem(decodeURIComponent(arg || ''));
  if (key === 'cmp') showCmp([arg, arg2, arg3].filter(Boolean).map(decodeURIComponent));
  renderTray();
  if (key === 'mine') showMine();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.go; }));

// ---------- 영상 분석 워커 ----------
let vw = null, vSeq = 0;
const vPend = new Map();
function newWorker() {
  vw = new Worker('vision-worker.js?v=' + APP_VERSION);
  vw.onmessage = (e) => { const p = vPend.get(e.data.id); if (p) { vPend.delete(e.data.id); clearTimeout(p.t); p.res(e.data.res); } };
}
newWorker();
function vision(img, opts, timeout = 15000) {
  return new Promise((res) => {
    const id = ++vSeq;
    const t = setTimeout(() => { vPend.delete(id); vw.terminate(); newWorker(); res({ ok: false, reason: 'timeout' }); }, timeout);
    vPend.set(id, { res, t });
    vw.postMessage({ id, img: { width: img.width, height: img.height, data: img.data }, opts }, [img.data.buffer]);
  });
}

// ---------- 카메라 · 실시간 윤곽 ----------
const video = $('#video'), ovl = $('#ovl');
let stream = null, live = false, liveBusy = false, seed = null, stableSince = 0, lastLive = null, hist6 = [], capturing = false;
// 새로 찍기 직후 같은 약이 그대로 있으면 바로 다시 자동 촬영되던 문제 → 약을 옮기거나 치울 때까지 자동 촬영을 잠시 멈춘다
let autoHold = false, holdRef = null, loopOn = false, frameRetry = 0;
const small = document.createElement('canvas');

async function camStart() {
  if (stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#camEmpty').classList.remove('hidden');
    return toast('이 브라우저는 카메라를 지원하지 않습니다. 크롬 또는 삼성 인터넷으로 여세요(카카오톡 등 앱 안 브라우저 X)', 5000);
  }
  // 고해상도 후면 → 후면 → 아무 카메라 순으로 시도(기기마다 지원 조건이 달라 첫 요청이 실패할 수 있다)
  const tries = [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: { ideal: 'environment' } },
    true,
  ];
  let err = null;
  for (const v of tries) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); break; }
    catch (e) { err = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break; }
  }
  if (!stream) {
    $('#camEmpty').classList.remove('hidden');
    const why = {
      NotAllowedError: '카메라 권한이 막혀 있습니다. 주소창 왼쪽 자물쇠(또는 ⋮ → 사이트 설정) → 카메라 → 허용 후 새로고침',
      SecurityError: '카메라 권한이 막혀 있습니다. 사이트 설정에서 카메라를 허용하세요',
      NotFoundError: '카메라를 찾지 못했습니다(카메라 없는 PC는 사진 불러오기를 쓰세요)',
      NotReadableError: '다른 앱이 카메라를 쓰고 있습니다. 카메라 앱을 닫고 다시 시도하세요',
      AbortError: '카메라가 응답하지 않습니다. 다른 앱을 닫고 다시 시도하세요',
    }[err && err.name] || `카메라를 켤 수 없습니다 (${err && err.name || '알 수 없음'}: ${err && err.message || ''})`;
    return toast(why, 7000);
  }
  // 켜는 동안 사진을 불러왔거나 결과가 떠 있으면 카메라는 다시 끈다
  if (capturing || showingStill()) { camStop(); return; }
  try {
    video.srcObject = stream;
    await video.play();
  } catch (e) { /* 일부 기기는 play()가 늦게 끝남 — 영상은 그대로 나온다 */ }
  $('#camEmpty').classList.add('hidden');
  showStill(null);
  startLive();
  warmUpOcr();
}
// 실시간 분석 시작: 루프는 하나만 돌고, 영상이 실제로 흐르는지 확인한다
function startLive() {
  live = true; hist6 = []; stableSince = 0;
  video.play().catch(() => {});
  if (!loopOn) { loopOn = true; liveLoop(); }
  watchFrames();
}
async function watchFrames() {
  const t0 = video.currentTime;
  await new Promise((r) => setTimeout(r, 1200));
  if (!live || !stream) return;
  if (video.currentTime !== t0 && !video.paused) { frameRetry = 0; return; }
  if (frameRetry >= 2) { toast('카메라 화면이 멈췄습니다. 다른 앱에 갔다 오거나 새로고침해 주세요', 5000); return; }
  frameRetry++;
  try { await video.play(); } catch (e) { /* 무시 */ }
  await new Promise((r) => setTimeout(r, 600));
  if (live && stream && video.currentTime === t0) { camStop(); showStill(null); camStart(); }
}
function camStop() { live = false; if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
const showingStill = () => !!$('#still').getAttribute('src');
function camEnter() { if (!capturing && !showingStill() && !pendingPick()) { if (store.get('pf.camOk', false)) camStart(); } }
let pickAt = 0;
const pendingPick = () => pickAt > 0 && performance.now() - pickAt < 60000;
function camLeave() { camStop(); }
$('#btnCamStart').addEventListener('click', () => { store.set('pf.camOk', true); camStart(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) camStop(); else if (location.hash.startsWith('#/cam') || !location.hash) camEnter(); });

// 화면 좌표 ↔ 영상 좌표 (object-fit: contain)
function fit(el, w, h) {
  const r = el.getBoundingClientRect();
  const s = Math.min(r.width / w, r.height / h);
  return { s, ox: (r.width - w * s) / 2, oy: (r.height - h * s) / 2, rw: r.width, rh: r.height };
}

// 촬영 가이드: 약은 동그라미, 카드는 직사각형 안에 두면 크기까지 잰다(확대 모드는 가운데 큰 원)
let zoomMode = false;
function drawGuides(ctx, f, vw, vh, res) {
  if (!zoomMode && !settings.cardGuide) return;
  const X = (u) => f.ox + u * vw * f.s, Y = (v) => f.oy + v * vh * f.s, S = vw * f.s;
  ctx.save(); ctx.setLineDash([7, 6]); ctx.lineWidth = 1.5; ctx.textAlign = 'center'; ctx.font = '700 12px sans-serif';
  const label = (txt, x, y, col) => { ctx.setLineDash([]); ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3; ctx.fillText(txt, x, y); ctx.shadowBlur = 0; ctx.setLineDash([7, 6]); };
  if (zoomMode) {
    const r = 0.36 * Math.min(vw, vh) * f.s;
    ctx.strokeStyle = 'rgba(250,204,21,.75)'; ctx.beginPath(); ctx.arc(X(0.5), Y(0.5), r, 0, 7); ctx.stroke();
    label('약을 크게 · 각인이 잘 보이게', X(0.5), Y(0.5) + r + 16, '#fde68a');
  } else {
    const land = vw >= vh;
    const cw = land ? 0.42 : 0.74, chH = (cw * vw) / 1.586 / vh;                  // 카드 가로세로비 1.586
    const cx0 = land ? 0.55 : 0.13, cy0 = land ? 0.5 - chH / 2 : 0.58;
    const found = res && res.coin && res.coin.kind === 'card';
    const col = found ? '#4ade80' : 'rgba(125,211,252,.85)';
    ctx.strokeStyle = col; ctx.beginPath();
    const rx = X(cx0), ry = Y(cy0), rw = cw * S, rh = chH * vh * f.s, rr = rw * 0.05;
    ctx.moveTo(rx + rr, ry); ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rr); ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rr); ctx.arcTo(rx, ry + rh, rx, ry, rr); ctx.arcTo(rx, ry, rx + rw, ry, rr); ctx.closePath(); ctx.stroke();
    label(found ? '카드 인식됨 ✓' : '카드(선택)', rx + rw / 2, ry + rh / 2 + 4, col);
    // 동전 가이드(카드 대신 또는 함께): 같은 거리에서 카드 가로 길이의 24/85.6 크기
    const coinFound = !!(res && ((res.coin && res.coin.kind !== 'card') || res.coin2));
    const ccol = coinFound ? '#4ade80' : 'rgba(125,211,252,.85)', cr = (rw * (Number(settings.coin) / 85.6)) / 2;
    const ccx = land ? rx + rw / 2 : X(0.84), ccy = land ? Math.min(ry + rh + cr + 0.03 * vh * f.s, Y(0.95) - cr) : Y(0.28);
    ctx.strokeStyle = ccol; ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, 7); ctx.stroke();
    label(coinFound ? `${coinName()} ✓` : coinName(), ccx, ccy + 4, ccol);
    const px = land ? 0.30 : 0.5, py = land ? 0.5 : 0.28, pr = (land ? 0.16 : 0.2) * S;
    ctx.strokeStyle = 'rgba(250,204,21,.7)'; ctx.beginPath(); ctx.arc(X(px), Y(py), pr, 0, 7); ctx.stroke();
    label('약', X(px), Y(py) + 4, '#fde68a');
  }
  ctx.restore();
}

function drawOverlay(res, sw, sh, srcW, srcH) {
  const r = ovl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (ovl.width !== Math.round(r.width * dpr)) { ovl.width = Math.round(r.width * dpr); ovl.height = Math.round(r.height * dpr); }
  const ctx = ovl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  if (live && srcW) drawGuides(ctx, fit(ovl, srcW, srcH), srcW, srcH, res);
  if (!res || !res.ok) return;
  const f = fit(ovl, srcW, srcH), k = srcW / sw;
  const draw = (o, color, width, dash) => {
    ctx.beginPath();
    o.outline.forEach(([x, y], i) => { const X = f.ox + (x + 0.5) * k * f.s, Y = f.oy + (y + 0.5) * k * f.s; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.setLineDash(dash || []); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  };
  for (const o of res.objects) if (o !== res.pill && o !== res.coin && o !== res.coin2) draw(o, 'rgba(203,213,225,.4)', 1, [5, 5]);
  if (res.coin) draw(res.coin, '#7dd3fc', 1.5, [8, 5]);
  if (res.coin2) draw(res.coin2, '#7dd3fc', 1.5, [8, 5]);
  if (res.pill) {
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4;
    draw(res.pill, '#facc15', 1.6);
    ctx.shadowBlur = 0;
    // 장축 표시
    const p = res.pill, ca = Math.cos(p.angle), sa = Math.sin(p.angle), h = p.long / 2;
    ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(250,204,21,.6)';
    ctx.moveTo(f.ox + (p.cx - ca * h) * k * f.s, f.oy + (p.cy - sa * h) * k * f.s);
    ctx.lineTo(f.ox + (p.cx + ca * h) * k * f.s, f.oy + (p.cy + sa * h) * k * f.s); ctx.stroke();
  }
}

function liveTags(res, srcW) {
  const el = $('#liveTags');
  if (!res || !res.ok || !res.pill) { el.innerHTML = '<span class="pill-tag">약을 화면 가운데에 놓아 주세요</span>'; return; }
  const p = res.pill, tags = [];
  tags.push(`<span class="pill-tag"><b>${esc(p.shapeTop)}</b> · ${esc(p.colorTop.join('/'))} · 비율 ${p.aspect.toFixed(2)}</span>`);
  if (res.coin) {
    const m = mmFrom(p, res);
    tags.push(`<span class="pill-tag">${refLabel(res)} 기준 <b>장 ${m.long.toFixed(1)} · 단 ${m.short.toFixed(1)}mm</b></span>`);
  }
  if (p.cut) tags.push('<span class="pill-tag warn">약이 화면 밖으로 잘렸어요</span>');
  else if (p.contrast < 12) tags.push('<span class="pill-tag warn">바닥과 색이 비슷해요 — 다른 색 바닥에</span>');
  else if (p.long < srcW * 0.08) tags.push('<span class="pill-tag warn">조금 더 가까이</span>');
  el.innerHTML = tags.join('');
}

function setRing(t) {
  const ring = $('#ring');
  ring.classList.toggle('hidden', t <= 0);
  $('#ringArc').setAttribute('stroke-dashoffset', String(144.5 * (1 - Math.min(1, t))));
}

async function liveLoop() {
  if (!live) { loopOn = false; return; }
  if (!liveBusy && video.readyState >= 2 && video.videoWidth) {
    liveBusy = true;
    const vwid = video.videoWidth, vhei = video.videoHeight;
    const sw = 320, sh = Math.round((vhei / vwid) * sw);
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(video, 0, 0, sw, sh);
    const img = sctx.getImageData(0, 0, sw, sh);
    let res = null;
    try { res = await vision(img, { seed, coin: true, face: false }, 4000); } catch (e) { res = null; }
    liveBusy = false;
    if (!live) { loopOn = false; return; }
    lastLive = res;
    drawOverlay(res, sw, sh, vwid, vhei);
    liveTags(res, sw);
    // 윤곽이 멈춰 있으면(0.9초) 자동 촬영
    const good = !!res && res.ok && res.pill && !res.pill.cut && res.pill.contrast >= 10 && res.pill.long >= sw * 0.08;
    if (good) {
      const p = res.pill, cur = [p.cx / sw, p.cy / sh, p.long / sw, p.short / sw];
      if (autoHold) {
        if (!holdRef) holdRef = cur;
        else if (Math.abs(holdRef[0] - cur[0]) > 0.06 || Math.abs(holdRef[1] - cur[1]) > 0.06 || Math.abs(holdRef[2] - cur[2]) / holdRef[2] > 0.15) { autoHold = false; holdRef = null; hist6 = []; stableSince = 0; }
      }
      hist6.push(cur); if (hist6.length > 6) hist6.shift();
      const steady = hist6.length >= 4 && hist6.every((h) => Math.abs(h[0] - cur[0]) < 0.02 && Math.abs(h[1] - cur[1]) < 0.02 && Math.abs(h[2] - cur[2]) / cur[2] < 0.06);
      if (steady) { if (!stableSince) stableSince = performance.now(); } else stableSince = 0;
    } else { hist6 = []; stableSince = 0; autoHold = false; holdRef = null; }
    const t = stableSince ? (performance.now() - stableSince) / 900 : 0;
    setRing(settings.auto && !autoHold ? t : 0);
    if (autoHold && settings.auto && good) $('#liveTags').insertAdjacentHTML('beforeend', '<span class="pill-tag warn">약을 옮기면 자동 촬영 · 지금 찍으려면 촬영 버튼</span>');
    if (settings.auto && !autoHold && t >= 1 && !capturing) { stableSince = 0; hist6 = []; capture(); }
  }
  requestAnimationFrame(liveLoop);
}

let lastCanvas = null;
$('#stage').addEventListener('click', (e) => {
  // 결과(정지 사진)에서 다른 약을 터치하면 그 약으로 다시 찾기
  if (!live && showingStill() && lastCanvas && !capturing) {
    const r = ovl.getBoundingClientRect();
    const f = fit(ovl, lastCanvas.width, lastCanvas.height);
    const x = (e.clientX - r.left - f.ox) / (lastCanvas.width * f.s), y = (e.clientY - r.top - f.oy) / (lastCanvas.height * f.s);
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { seed = { x, y }; pendingBack = sides.length > 1 ? false : pendingBack; identify(lastCanvas); }
    return;
  }
  if (!live) return;
  const r = ovl.getBoundingClientRect();
  const f = fit(ovl, video.videoWidth, video.videoHeight);
  const x = (e.clientX - r.left - f.ox) / (video.videoWidth * f.s), y = (e.clientY - r.top - f.oy) / (video.videoHeight * f.s);
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { seed = { x, y }; hist6 = []; toast('이 약으로 찾습니다'); }
});

$('#btnAuto').classList.toggle('on', settings.auto);
$('#btnAuto').addEventListener('click', () => { settings.auto = !settings.auto; saveSettings(); $('#btnAuto').classList.toggle('on', settings.auto); toast(settings.auto ? '윤곽이 멈추면 자동으로 찍습니다' : '자동 촬영 끔'); });
$('#btnShoot').addEventListener('click', () => (stream ? capture() : $('#file').click()));
// 갤러리로 나갔다 오면 화면이 잠시 숨겨진다 → 카메라를 미리 끄고, 돌아와서 결과를 덮어쓰지 않게
$('#btnLoad').addEventListener('click', () => { pickAt = performance.now(); camStop(); $('#file').click(); });
$('#file').addEventListener('cancel', () => { pickAt = 0; camEnter(); });
$('#file').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; pickAt = 0; if (f) fromBlob(f); else camEnter(); });
window.addEventListener('paste', (e) => {
  const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (it) { location.hash = '#/cam'; fromBlob(it.getAsFile()); }
});
// PC: 사진을 끌어다 놓기
$('#stage').addEventListener('dragover', (e) => e.preventDefault());
$('#stage').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) fromBlob(f); });

async function fromBlob(blob) {
  camStop();
  busy(true, '사진 읽는 중');
  // 1) createImageBitmap(사진 회전 정보 반영) 2) 안 되면 <img>로 (일부 폰 사진 형식 대응)
  let src = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => null);
  let w = src && src.width, h = src && src.height;
  if (!src) {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.src = url;
    try { await im.decode(); src = im; w = im.naturalWidth; h = im.naturalHeight; } catch { src = null; }
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  if (!src || !w) { busy(false); return toast('이 사진 형식은 읽을 수 없습니다. 카메라 앱에서 JPG로 저장된 사진을 고르세요', 4500); }
  const c = toCanvas(src, w, h);
  seed = null;
  identify(c);
}
function toCanvas(src, w, h, max = 1400) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function capture() {
  if (!stream || capturing) return;
  const c = toCanvas(video, video.videoWidth, video.videoHeight);
  identify(c);
}
function showStill(canvas) {
  const im = $('#still');
  if (canvas) { im.src = canvas.toDataURL('image/jpeg', 0.85); im.classList.remove('hidden'); video.style.visibility = 'hidden'; $('#guideBox').classList.add('hidden'); }
  else { im.removeAttribute('src'); im.classList.add('hidden'); video.style.visibility = ''; $('#guideBox').classList.remove('hidden'); }
}
function busy(on, text) { $('#busy').classList.toggle('on', !!on); if (text) $('#busyText').textContent = text; }

// ---------- 식별 ----------
// sides: 앞면/뒷면 사진마다 {thumb, res, reads, ai}
let sides = [], obsEdit = null, pendingBack = false, pendingZoom = false, zoomSide = null;

function pillThumb(canvas, o, size = 360) {
  const m = Math.max(o.long, o.short) * 0.62;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  const s = size / (2 * m);
  ctx.translate(size / 2, size / 2); ctx.rotate(-o.angle); ctx.scale(s, s);
  ctx.drawImage(canvas, -o.cx, -o.cy);
  return c;
}

async function identify(canvas) {
  lastCanvas = canvas;
  capturing = true;
  live = false;
  showStill(canvas);
  drawOverlay(null);
  $('#liveTags').innerHTML = ''; setRing(0);
  busy(true, '윤곽과 모양을 재는 중');
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const res = await vision(img, { seed, crop: true, coin: true, desc: 'pill', rots: 36 });
    if (!res.ok || !res.pill) {
      busy(false);
      toast(res.reason === 'timeout' ? '분석이 너무 오래 걸립니다. 다시 찍어 주세요' : '약을 찾지 못했어요. 단색 바닥에 한 알만 두고 다시 찍어 주세요', 3800);
      if (pendingZoom) { // 확대 촬영이 실패해도 앞면 결과는 그대로 두고 다시 비춰 보게 한다
        pendingZoom = false; zoomMode = false; autoHold = true; holdRef = null;
        showStill(null); if (stream) startLive();
        toast('약 전체가 화면 안에 들어오게 가까이 비춰 주세요', 3500);
        return;
      }
      if (!pendingBack) resetCam();
      return;
    }
    if (res.objects.length > 1) toast('약이 여러 개입니다. 다른 약을 찾으려면 사진에서 그 약을 터치하세요', 3500);
    // 분석한 윤곽을 사진 위에 그려 보여 줌
    drawOverlay(res, canvas.width, canvas.height, canvas.width, canvas.height);
    const thumb = pillThumb(canvas, res.pill);
    busy(true, '각인 글자 읽는 중');
    let reads = [];
    try { reads = await readImprint(res.crop, res.pill.aspect, (p) => busy(true, `각인 글자 읽는 중 ${Math.round(p * 100)}%`)); }
    catch (e) { toast('각인 판독기를 불러오지 못했습니다(글자는 직접 입력)'); }
    let ai = null;
    if (settings.ai && settings.aiKey) {
      busy(true, 'AI가 각인을 읽는 중');
      try {
        const { aiRead } = await import('./ai.js');
        ai = await aiRead({ apiKey: settings.aiKey, model: settings.aiModel, jpegs: [thumb.toDataURL('image/jpeg', 0.9).split(',')[1]] });
      } catch (e) {
        const { describeAiError } = await import('./ai.js');
        toast('AI 판독 실패: ' + describeAiError(e), 4000);
      }
    }
    const mini = document.createElement('canvas'); mini.width = mini.height = 96;
    mini.getContext('2d').drawImage(thumb, 0, 0, 96, 96);
    const side = { thumb: thumb.toDataURL('image/jpeg', 0.8), mini: mini.toDataURL('image/jpeg', 0.7), res: stripRes(res), reads, ai };
    const zoomShot = pendingZoom;
    if (pendingZoom) { zoomSide = side; pendingZoom = false; zoomMode = false; }
    else { if (pendingBack && sides.length) sides[1] = side; else { sides = [side]; zoomSide = null; } pendingBack = false; }
    obsEdit = null;
    busy(false);
    renderResult(true, zoomShot);
  } finally {
    capturing = false;
  }
}
const stripRes = (r) => ({ pill: r.pill, coin: r.coin && { long: r.coin.long, short: r.coin.short, kind: r.coin.kind }, coin2: r.coin2 && { long: r.coin2.long, short: r.coin2.short }, bg: r.bg });

function resetCam() {
  sides = []; zoomSide = null; obsEdit = null; seed = null; pendingBack = false; pendingZoom = false; zoomMode = false;
  $('#result').classList.add('hidden'); $('#resultIntro').classList.remove('hidden');
  showStill(null);
  autoHold = true; holdRef = null; frameRetry = 0;
  window.scrollTo({ top: 0 });
  if (stream) startLive();
  else { camEnter(); if (!store.get('pf.camOk', false)) $('#camEmpty').classList.remove('hidden'); }
}

// 사진들에서 뽑은 특징 → 매칭용 obs
function autoObs() {
  const ps = sides.map((s) => s.res.pill);
  const shape = {};
  for (const k of V.SHAPES) shape[k] = ps.reduce((a, p) => a + (p.shape[k] || 0), 0) / ps.length;
  const p0 = ps[0];
  let colors = p0.colors.map((c) => ({ probs: c.probs }));
  const aspect = ps.reduce((a, p) => a + p.aspect, 0) / ps.length;
  let mm = null;
  const withCoin = sides.filter((s) => s.res.coin);
  if (withCoin.length) {
    const ms = withCoin.map((s) => mmFrom(s.res.pill, s.res));
    mm = { long: ms.reduce((a, m) => a + m.long, 0) / ms.length, short: ms.reduce((a, m) => a + m.short, 0) / ms.length };
  }
  const imprints = [];
  sides.forEach((s, i) => {
    for (const r of s.reads) imprints.push({ ...r, side: i });
    if (s.ai && s.ai.is_pill) {
      const conf = Math.max(0.5, Math.min(0.97, s.ai.confidence || 0.8));
      for (const t of [s.ai.imprint_side_a, s.ai.imprint_side_b]) if (t && t.trim()) imprints.push({ text: t, conf, how: 'AI', side: i });
      // AI가 본 모양·색은 영상 분석과 반반 섞는다
      if (s.ai.shape) for (const k of V.SHAPES) shape[k] = 0.5 * shape[k] + (k === s.ai.shape ? 0.5 : 0);
      if (i === 0 && s.ai.colors && s.ai.colors.length) colors = s.ai.colors.slice(0, 2).map((c, j) => ({ probs: mix(colors[j] ? colors[j].probs : {}, c) }));
    }
  });
  if (zoomSide) for (const r of zoomSide.reads) imprints.push({ ...r, side: 0, how: '확대' });
  // 면 특징 → 확률: 분할선 점수 7 근처, 각인 변화량 1.1 근처가 경계(실제 사진·식약처 사진 600면으로 맞춤)
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const faces = ps.map((p) => ({
    line: p.lineScore !== undefined ? sig((p.lineScore - 7) / 1.2) : undefined,
    blank: p.markEnergy !== undefined ? sig((1.1 - p.markEnergy) / 0.2) : undefined,
  }));
  // 확인된 약과 지문 비교(내 폰 사진끼리라 잘 맞는다): 0.35 이상만
  let learnedSim = null;
  if (learned.length || shared.list.length) {
    learnedSim = new Map();
    for (const sd of sides) {
      const q = sd.res.pill.desc; if (!q) continue;
      for (const e of learnedDescs()) { const v = V.descSim(q, e.d); if (v >= 0.35 && v > (learnedSim.get(e.s) || 0)) learnedSim.set(e.s, v); }
    }
  }
  const cp = sides[0].res.pill.capsule;
  const form = cp ? { hard: cp.p } : undefined;
  return { shape, colors, aspect, mm, imprints, faces, learnedSim, form };
}
const mix = (probs, c) => { const o = {}; for (const k of V.COLORS) o[k] = 0.4 * (probs[k] || 0); o[c] = (o[c] || 0) + 0.6; return o; };

// 사용자가 고친 값이 있으면 그것을 우선
function currentObs() {
  const o = autoObs();
  if (!obsEdit) return o;
  if (obsEdit.shape) o.shape = { [obsEdit.shape]: 1 };
  if (obsEdit.color) o.colors = [{ probs: { [obsEdit.color]: 1 } }].concat(obsEdit.color2 ? [{ probs: { [obsEdit.color2]: 1 } }] : []);
  else if (obsEdit.color2 === '') o.colors = o.colors.slice(0, 1);
  if (obsEdit.imprint !== undefined) o.imprints = obsEdit.imprint.trim() ? obsEdit.imprint.trim().split(/\s+/).map((t) => ({ text: t, conf: 0.9 })).concat([{ text: obsEdit.imprint.replace(/\s+/g, ''), conf: 0.9 }]) : [];
  if (obsEdit.mm !== undefined) o.mm = obsEdit.mm;
  if (obsEdit.form) o.form = { pick: obsEdit.form };
  if (obsEdit.has) o.has = obsEdit.has;
  if (obsEdit.line) o.line = obsEdit.line;
  if (obsEdit.has === 'none') { o.imprints = []; o.noImprint = false; }   // 각인 없음을 골랐으면 흐리게 읽힌 글자는 무시
  return o;
}

function fillSelect(sel, items, value, autoLabel) {
  sel.innerHTML = `<option value="">${autoLabel}</option>` + items.map((k) => `<option value="${k}" ${k === value ? 'selected' : ''}>${k}</option>`).join('');
}

function renderResult(fresh, noHistory) {
  $('#resultIntro').classList.add('hidden');
  $('#result').classList.remove('hidden');
  const o = autoObs();
  const p0 = sides[0].res.pill;
  $('#thumbs').innerHTML = sides.map((s, i) => `<div style="text-align:center"><img src="${s.thumb}" alt=""><div class="hint">${i ? '뒷면' : '앞면'}</div></div>`).join('') +
    (zoomSide ? `<div style="text-align:center"><img src="${zoomSide.thumb}" alt=""><div class="hint">확대</div></div>` : '') +
    `<div class="hint" style="flex:1;margin-left:4px">영상 분석: <b>${esc(p0.shapeTop)}</b> ${Math.round(p0.shape[p0.shapeTop] * 100)}% · ${esc(p0.colorTop.join('/'))} · 비율 ${o.aspect.toFixed(2)}${o.mm ? ` · ${refLabel((sides.find((s) => s.res.coin) || sides[0]).res)} 기준 ${o.mm.long.toFixed(1)}×${o.mm.short.toFixed(1)}mm` : ''}${sides.some((s) => s.ai) ? '<br>AI 판독 포함' : ''}</div>`;
  if (fresh) {
    const topShape = Object.keys(o.shape).reduce((a, b) => (o.shape[a] >= o.shape[b] ? a : b));
    fillSelect($('#oShape'), V.SHAPES, '', `자동 (${topShape})`);
    const cTop = (c) => c && Object.keys(c.probs).reduce((a, b) => (c.probs[a] >= c.probs[b] ? a : b));
    fillSelect($('#oColor'), COLOR_LIST, '', `자동 (${cTop(o.colors[0])})`);
    fillSelect($('#oColor2'), COLOR_LIST, '', o.colors[1] ? `자동 (${cTop(o.colors[1])})` : '없음');
    { const sel = $('#oHas'); sel.innerHTML = '<option value="">자동</option><option value="has">있음 (글자 모름)</option><option value="none">없음</option>'; sel.value = ''; }
    { const sel = $('#oLine'); sel.innerHTML = LINE_OPTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); sel.value = ''; }
    const hp = o.form ? o.form.hard : 0;
    autoPick = { shape: topShape, form: o.form ? (hp >= 0.5 ? '경질캡슐' : hp >= 0.2 ? '' : '정제') : '' };
    fillSelect($('#oForm'), ['정제', '경질캡슐', '연질캡슐'], '', o.form ? `자동 (${hp >= 0.5 ? '경질캡슐 ' + Math.round(hp * 100) + '%' : hp >= 0.2 ? '불확실' : '정제 같음'})` : '자동');
    setTimeout(syncTiles, 0);
    // 색이 애매하면(1등 확률 85% 미만) 상위 두 색을 한 번에 고르게 한다(조명·화이트밸런스로 흰색이 푸르게 찍히는 경우 등)
    { const pr = o.colors[0].probs, top2 = Object.keys(pr).sort((x, y) => pr[y] - pr[x]).slice(0, 2), box = $('#colorAsk');
      box.innerHTML = pr[top2[0]] < 0.85 ? `색이 애매해요. 맞는 색을 눌러 주세요: ${top2.map((k) => `<button class="chip" data-color-pick="${k}">${k} ${Math.round(pr[k] * 100)}%</button>`).join(' ')}` : ''; }
    $('#oSize').value = o.mm ? `${o.mm.long.toFixed(1)} x ${o.mm.short.toFixed(1)}` : '';
    const best = o.imprints.slice().sort((a, b) => b.conf - a.conf);
    // 확실한 판독(50% 이상, AI 포함)만 입력칸에 넣는다. 자신 없는 글자는 아래 칩으로만 보여 준다
    const sure = best.filter((r) => r.conf >= 0.5);
    const front = sure.find((r) => r.side === 0), back = sure.find((r) => r.side === 1);
    $('#oImprint').value = [front && front.text, back && back.text].filter(Boolean).join(' ');
    if (!sure.length) obsEdit = { imprint: '' }; // 엉터리 판독이 순위를 흔들지 않게
    $('#reads').innerHTML = best.length
      ? best.map((r) => `<button class="chip" data-read="${esc(r.text)}">${esc(r.text)} <span class="hint">${r.how === 'AI' ? 'AI' : (r.how === '확대' ? '확대 ' : '') + Math.round(r.conf * 100) + '%'}</span></button>`).join('')
      : '';
    if (!sure.length) $('#reads').insertAdjacentHTML('afterbegin', '<div class="hint" style="width:100%;color:#fde68a">각인을 확실히 읽지 못했습니다. 위 칸에 보이는 글자만 넣거나(모르는 글자는 ?, 예: T?5) 각인 유무를 골라 주세요. 글자가 보이면 각인 확대 찍기도 좋아요.' + (best.length ? ' 비슷하게 읽힌 글자:' : '') + '</div>');
    $('#obsNote').textContent = sides[0].ai && sides[0].ai.note ? 'AI 메모: ' + sides[0].ai.note : '';
    $('#btnBack').textContent = sides.length > 1 ? '뒷면 다시 찍기' : '뒷면도 찍기';
  }
  rerank();
  if (fresh && !noHistory) saveHistory();
}

let candOtc = false;
$('#candOtc').addEventListener('click', (e) => { candOtc = !candOtc; e.currentTarget.classList.toggle('on', candOtc); rerank(); });
function rerank() {
  if (!data.ready) { $('#cands').innerHTML = '<div class="empty-msg">약 데이터가 없어 비교할 수 없습니다.</div>'; return; }
  const ranked = M.rank(data.db, currentObs(), { limit: 30, filter: candOtc ? M.isOtc : undefined });
  $('#candTitle').textContent = `닮은 약 ${ranked.length ? '' : '— 없음'}`;
  $('#cands').innerHTML = ranked.map((x, i) => card(x.r, { score: x.score, parts: x.parts, num: i + 1 })).join('');
  rerank.top = ranked[0];
}

function saveHistory() {
  const top = rerank.top;
  hist.unshift({ t: Date.now(), thumb: sides[0].mini, seq: top ? top.r.s : null });
  hist = hist.slice(0, 30);
  store.set('pf.hist', hist);
}

const LINE_OPTS = [['', '자동'], ['none', '없음 (매끈함)'], ['-', '있음 − 한 줄'], ['+', '있음 + 십자'], ['has', '있음 (모양 모름)']];
const editObs = () => {
  const sz = $('#oSize').value.match(/([\d.]+)\s*[x×*]?\s*([\d.]+)?/);
  obsEdit = {
    shape: $('#oShape').value || undefined,
    color: $('#oColor').value || undefined,
    color2: $('#oColor2').value || ($('#oColor').value ? '' : undefined),
    imprint: $('#oImprint').value,
    form: $('#oForm').value || undefined,
    has: $('#oHas').value || undefined,
    line: $('#oLine').value || undefined,
    mm: sz ? { long: Math.max(+sz[1], +(sz[2] || sz[1])), short: Math.min(+sz[1], +(sz[2] || sz[1])) } : null,
  };
  rerank();
};
['#oShape', '#oColor', '#oColor2', '#oForm', '#oHas', '#oLine'].forEach((s) => $(s).addEventListener('change', editObs));
// 그림으로 고르기: 눌러서 선택칸 값을 바꾸고(다시 누르면 자동), 선택칸과 항상 같은 상태로 보여 준다
let autoPick = { shape: '', form: '' };
function syncTiles() {
  const sv = $('#oShape').value, fv = $('#oForm').value;
  document.querySelectorAll('#oShapeTiles .tile').forEach((b) => { b.classList.toggle('on', b.dataset.pick === sv); b.classList.toggle('auto', !sv && b.dataset.pick === autoPick.shape); });
  document.querySelectorAll('#oFormTiles .tile').forEach((b) => { b.classList.toggle('on', b.dataset.pick === fv); b.classList.toggle('auto', !fv && b.dataset.pick === autoPick.form); });
  $('#autoShapeNote').textContent = sv ? '(직접 고름)' : autoPick.shape ? `(자동: ${autoPick.shape} — 점선)` : '';
  $('#autoFormNote').textContent = fv ? '(직접 고름)' : autoPick.form ? `(자동 추정: ${autoPick.form} — 점선)` : '';
}
$('#oShapeTiles').innerHTML = V.SHAPES.map((s) => shapeTile(s, 'data-pick')).join('');
$('#oFormTiles').innerHTML = ['정제', '경질캡슐', '연질캡슐'].map((s) => formTile(s, 'data-pick')).join('');
$('#colorAsk').addEventListener('click', (e) => { const b = e.target.closest('[data-color-pick]'); if (!b) return; $('#oColor').value = b.dataset.colorPick; $('#oColor').dispatchEvent(new Event('change')); toast(`색을 ${b.dataset.colorPick}(으)로 정했어요`); });
for (const [box, sel] of [['#oShapeTiles', '#oShape'], ['#oFormTiles', '#oForm']]) {
  $(box).addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; const s = $(sel); s.value = s.value === b.dataset.pick ? '' : b.dataset.pick; s.dispatchEvent(new Event('change')); });
}
['#oShape', '#oForm'].forEach((s) => $(s).addEventListener('change', syncTiles));
let editT;
['#oImprint', '#oSize'].forEach((s) => $(s).addEventListener('input', () => { clearTimeout(editT); editT = setTimeout(editObs, 250); }));
$('#reads').addEventListener('click', (e) => { const c = e.target.closest('[data-read]'); if (c) { $('#oImprint').value = c.dataset.read; editObs(); } });
$('#btnRetake').addEventListener('click', resetCam);
$('#btnZoom').addEventListener('click', () => {
  pendingZoom = true; pendingBack = false; zoomMode = true; seed = null;
  toast('각인이 보이는 면을 크게 비춰 주세요');
  showStill(null);
  autoHold = true; holdRef = null; frameRetry = 0;
  window.scrollTo({ top: 0 });
  if (stream) startLive(); else if (store.get('pf.camOk', false)) camStart(); else $('#file').click();
});
$('#btnBack').addEventListener('click', () => {
  pendingBack = true; pendingZoom = false; zoomMode = false; seed = null;
  toast('약을 뒤집어서 비춰 주세요');
  showStill(null);
  autoHold = true; holdRef = null; frameRetry = 0;
  window.scrollTo({ top: 0 });
  if (stream) startLive(); else if (store.get('pf.camOk', false)) camStart(); else $('#file').click();
});

// ---------- 약 검색 (이름 · 각인 · 크기 · 모양 · 색 — 아는 것만 넣으면 된다) ----------
const filt = { shapes: [], colors: [], forms: [], formD: [], has: '', otc: '', line: '' };
$('#fLine').innerHTML = [['none', '분할선 없음'], ['-', '− 한 줄'], ['+', '+ 십자'], ['has', '있음(전체)']].map(([v, t]) => `<button class="chip" data-line="${v}">${t}</button>`).join('');
$('#fLine').addEventListener('click', (e) => { const b = e.target.closest('[data-line]'); if (!b) return; filt.line = filt.line === b.dataset.line ? '' : b.dataset.line; document.querySelectorAll('#fLine .chip').forEach((c) => c.classList.toggle('on', c.dataset.line === filt.line)); runFilter(); });
$('#fOtc').innerHTML = '<button class="chip" data-otc="일반">일반의약품만 (처방전 없이)</button><button class="chip" data-otc="전문">전문의약품만</button>';
$('#fOtc').addEventListener('click', (e) => { const b = e.target.closest('[data-otc]'); if (!b) return; filt.otc = filt.otc === b.dataset.otc ? '' : b.dataset.otc; document.querySelectorAll('#fOtc .chip').forEach((c) => c.classList.toggle('on', c.dataset.otc === filt.otc)); runFilter(); });
$('#fSort').addEventListener('change', runFilter);
$('#fTol').addEventListener('change', runFilter);
$('#fHas').innerHTML = '<button class="chip" data-has="has">각인 있음</button><button class="chip" data-has="none">각인 없음</button>';
$('#fHas').addEventListener('click', (e) => { const b = e.target.closest('[data-has]'); if (!b) return; filt.has = filt.has === b.dataset.has ? '' : b.dataset.has; document.querySelectorAll('#fHas .chip').forEach((c) => c.classList.toggle('on', c.dataset.has === filt.has)); runFilter(); });
$('#fFormD').innerHTML = Object.keys(M.FORM_DETAIL).map((s) => formTile(s, 'data-formd')).join('');
$('#fFormD').addEventListener('click', (e) => { const b = e.target.closest('[data-formd]'); if (!b) return; toggle(filt.formD, b.dataset.formd); b.classList.toggle('on'); runFilter(); });
$('#fForms').innerHTML = ['정제', '경질캡슐', '연질캡슐'].map((s) => formTile(s, 'data-form')).join('');
$('#fForms').addEventListener('click', (e) => { const b = e.target.closest('[data-form]'); if (!b) return; toggle(filt.forms, b.dataset.form); b.classList.toggle('on'); runFilter(); });
$('#fShapes').innerHTML = V.SHAPES.map((s) => shapeTile(s, 'data-shape')).join('');
$('#fColors').innerHTML = COLOR_LIST.map((c) => `<button class="chip" data-color="${c}"><span class="sw" style="background:${SWATCH[c]}"></span>${c}</button>`).join('');
const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
$('#fShapes').addEventListener('click', (e) => { const b = e.target.closest('[data-shape]'); if (!b) return; toggle(filt.shapes, b.dataset.shape); b.classList.toggle('on'); runFilter(); });
$('#fColors').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; toggle(filt.colors, b.dataset.color); b.classList.toggle('on'); runFilter(); });
let fRes = [], fShown = 0, fT;
for (const id of ['#q', '#fImprint', '#fL', '#fW', '#fT']) $(id).addEventListener('input', () => { clearTimeout(fT); fT = setTimeout(runFilter, 200); });
$('#fSimilar').addEventListener('change', runFilter);
$('#fReset').addEventListener('click', () => {
  filt.shapes = []; filt.colors = []; filt.forms = []; filt.formD = []; filt.has = ''; filt.otc = ''; filt.line = ''; $('#fSort').value = ''; $('#fTol').value = '0.06';
  for (const id of ['#q', '#fImprint', '#fL', '#fW', '#fT']) $(id).value = '';
  document.querySelectorAll('#pgSearch .on').forEach((c) => c.classList.remove('on'));
  runFilter();
});
const numOf = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return v > 0 ? v : 0; };
function runFilter() {
  const qn = $('#q').value.trim(), imprint = $('#fImprint').value.trim();
  const size = { L: numOf('#fL'), W: numOf('#fW'), T: numOf('#fT'), tol: Number($('#fTol').value) || 0.06 };
  $('#sumFormD').textContent = filt.formD.length ? '세부 제형 · ' + filt.formD.join(', ') : '세부 제형 (필름코팅·서방·장용…)';
  $('#sumShape').textContent = filt.shapes.length ? '모양 · ' + filt.shapes.join(', ') : '모양 (눌러서 고르기)';
  $('#sumColor').textContent = filt.colors.length ? '색 · ' + filt.colors.join(', ') : '색 (눌러서 고르기)';
  const any = qn || imprint || filt.otc || filt.has || filt.line || filt.formD.length || filt.forms.length || filt.shapes.length || filt.colors.length || size.L || size.W || size.T;
  if (!any) { fRes = []; $('#fList').innerHTML = ''; $('#fInfo').textContent = '아는 것만 넣어도 됩니다. 이름, 각인, 크기, 모양, 색 어느 것이든 좋아요.'; $('#fMore').classList.add('hidden'); return; }
  if (!data.ready) { $('#fInfo').textContent = '약 데이터가 없습니다.'; return; }
  const f = M.manualFilter({ shapes: filt.shapes, colors: filt.colors, forms: filt.forms, formD: filt.formD, has: filt.has, otc: filt.otc, line: filt.line, imprint, similarColors: $('#fSimilar').checked, size });
  // 이름을 넣었으면 이름 검색 순서를 유지하고, 아니면 각인 일치 → 크기가 가까운 순
  fRes = (qn ? M.searchName(data.db, qn, 3000) : data.db).filter(f);
  if (!qn) {
    const q = M.normImprint(imprint);
    const gap = (r) => ['L', 'W', 'T'].reduce((s, k) => s + (size[k] ? Math.abs((r[k] || 0) - size[k]) / size[k] : 0), 0);
    if (q || size.L || size.W || size.T) fRes.sort((a, b) => (q ? rankImp(b, q) - rankImp(a, q) : 0) || gap(a) - gap(b));
  }
  $('#sumShape').textContent = filt.shapes.length ? '모양 · ' + filt.shapes.join(', ') : '모양 (눌러서 고르기)';
  $('#sumColor').textContent = filt.colors.length ? '색 · ' + filt.colors.join(', ') : '색 (눌러서 고르기)';
  const cond = [qn && `"${qn}"`, imprint && `각인 ${imprint}`, filt.otc && `${filt.otc}의약품`, filt.has === 'has' && '각인 있음', filt.has === 'none' && '각인 없음', filt.line && ({ none: '분할선 없음', '-': '분할선 한 줄', '+': '분할선 십자', has: '분할선 있음' }[filt.line]), ...filt.forms, ...filt.formD, ...filt.shapes, ...filt.colors, size.L && `장축 ${size.L}`, size.W && `단축 ${size.W}`, size.T && `두께 ${size.T}`].filter(Boolean).join(' · ');
  if ($('#fSort').value === 'price') fRes = fRes.slice().sort((a, b) => (a.pr ?? 1e12) - (b.pr ?? 1e12));
  fShown = 0; $('#fList').innerHTML = '';
  $('#fInfo').textContent = fRes.length ? `${qn && fRes.length >= 3000 ? '3,000+' : fRes.length.toLocaleString()}개 · ${cond}` : `찾는 약이 없습니다. 조건을 줄여 보세요 (${cond})`;
  moreFilter();
}
const rankImp = (r, q) => M.imprintMatchScore(q, r);
function moreFilter() {
  const next = fRes.slice(fShown, fShown + 40);
  $('#fList').insertAdjacentHTML('beforeend', next.map((r, i) => card(r, { num: fShown + i + 1 })).join(''));
  fShown += next.length;
  $('#fMore').classList.toggle('hidden', fShown >= fRes.length);
}
$('#fMore').addEventListener('click', moreFilter);

// ---------- 상세 ----------
async function showItem(seq) {
  const r = data.bySeq.get(seq);
  const box = $('#item');
  if (!r) { box.innerHTML = `<div class="empty-msg">${data.ready ? '약 정보를 찾을 수 없습니다.' : '불러오는 중…'}</div>`; return; }
  document.title = `${r.n} — 필파인더`;
  const isFav = favs.includes(seq);
  const spec = [
    ['업체', r.e], ['구분', r.o], ['분류', r.cl], ['제형', r.f], ['모양', r.sh],
    ['색', M.dbColors(r).join(', ')], ['각인 앞', r.pf], ['각인 뒤', r.pb], ['마크', [r.mf, r.mb].filter(Boolean).join(' / ')],
    ['분할선', [r.lf && '앞 ' + r.lf, r.lb && '뒤 ' + r.lb].filter(Boolean).join(', ')],
    ['크기', r.L ? `장축 ${r.L}mm${r.W ? ` · 단축 ${r.W}mm` : ''}${r.T ? ` · 두께 ${r.T}mm` : ''}` : ''],
    ['주성분', r.in],
    ['보험 약가', r.pr ? `${won(r.pr)} / ${r.pu || '1개'}${r.pn ? ` (${r.pn})` : ''} — 건강보험 상한가, 실제 약국 가격·본인부담은 다를 수 있음` : (data.meta && data.meta.priced ? (M.isOtc(r) ? '공식 가격 없음 (일반의약품은 약국마다 가격이 다름)' : '약가 정보 없음') : '')],
    ['성상', r.ch], ['영문명', r.en], ['품목코드', r.s],
  ].filter(([, v]) => v);
  box.innerHTML = `
    <div class="detail-head">
      <div class="detail-img">${r.img ? `<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer">` : glyph(r).replace('width="92" height="66"', 'width="70%" height="70%"')}</div>
      <div>
        <div class="detail-name">${otcBadge(r)}${esc(r.n)}</div>
        <div class="row" style="flex-wrap:nowrap"><button class="fav ${isFav ? 'on' : ''}" id="favBtn">${isFav ? '내 약에 저장됨' : '내 약에 저장'}</button>
          <button class="fav" id="shareBtn">링크 복사</button>
          <button class="fav ${cmp.includes(seq) ? 'on' : ''}" id="cmpBtn">${cmp.includes(seq) ? '비교에 담김' : '비교에 담기'}</button></div>
        ${sides.length && sides[0].res.pill.desc ? `<button class="primary" id="confirmBtn" style="width:100%;margin-top:8px">${learned.some((e) => e.s === seq) ? '찍은 약을 이 약으로 한 번 더 기억하기' : '찍은 약이 이 약 맞아요 (기억하기)'}</button>
        <div class="hint" style="margin-top:4px">기억해 두면 다음에 같은 약을 찍을 때 맨 위에 나옵니다.</div>` : ''}
        <table class="spec">${spec.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}<tr id="ingrRow" class="hidden"><th>성분</th><td></td></tr></table>
      </div>
    </div>
    <div class="doc" id="doc"><div class="hint" style="padding:14px 0">효능·용법·주의사항 불러오는 중…</div></div>
    <div class="links">
      <a class="btn secondary" target="_blank" rel="noopener" href="https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(r.s)}">의약품안전나라 원문</a>
      <a class="btn secondary" target="_blank" rel="noopener" href="https://www.health.kr/searchResult?search_value=${encodeURIComponent(r.n.replace(/\(.*$/, ''))}">약학정보원에서 보기</a>
    </div>
    <div class="simbox">
      <h2>비슷한 약 찾기</h2>
      <div class="bar">
        <button class="chip on" data-sim="size">크기·제형·모양 (조제 테스트용)</button>
        <button class="chip" data-sim="look">생김새(색 포함)</button>
        <button class="chip" data-sim="ingr">같은 성분 약</button>
      </div>
      <div class="bar" id="simSizeOpt">
        <button class="chip on" id="simForm">제형 같게 (${esc(M.formGroup(r))})</button>
        <button class="chip on" id="simShape">모양 같게 (${esc(r.sh || '기타')})</button>
        <button class="chip on" id="simLine">분할선 같게 (${esc(lineTxt(r) ? '분할선 ' + lineTxt(r) : '없음')})</button>
      </div>
      <div class="bar">
        <button class="chip ${M.isOtc(r) ? '' : 'on'}" id="simOtc">처방전 없이 살 수 있는 일반의약품만</button>
        <select class="text" id="simSort"><option value="">${'닮은 순'}</option><option value="price">싼 순 (보험 약가)</option></select>
      </div>
      <div class="hint" id="simNote"></div>
      <div class="list wide" id="simList"></div>
    </div>
    <p class="disclaimer">사진·모양이 같은 다른 약이 있을 수 있습니다. 복용 전 약 봉투·포장의 이름을 확인하고, 궁금한 점은 약사·의사에게 물어보세요.</p>`;
  $('#favBtn').addEventListener('click', (e) => {
    const i = favs.indexOf(seq);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(seq);
    store.set('pf.favs', favs);
    e.target.classList.toggle('on', i < 0); e.target.textContent = i < 0 ? '내 약에 저장됨' : '내 약에 저장';
  });
  const cb = $('#confirmBtn');
  if (cb) cb.addEventListener('click', () => {
    // 각 면 사진의 기준 방향 지문 하나씩 저장(약 하나당 최대 4장, 전체 300장)
    for (const sd of sides) {
      const d = sd.res.pill.desc; if (!d) continue;
      learned.unshift({ s: seq, d: packDesc(Array.isArray(d) ? d[0] : d), t: Date.now() });
    }
    const per = {};
    learned = learned.filter((e) => (per[e.s] = (per[e.s] || 0) + 1) <= 4).slice(0, 300);
    learnedCache = null;
    store.set('pf.learned', learned);
    if (!favs.includes(seq)) { favs.unshift(seq); store.set('pf.favs', favs); }
    if (SH.enabled() && settings.share) {
      const dev = SH.deviceId(store);
      SH.upload(learned.filter((e) => e.s === seq).slice(0, sides.length).map((e) => ({ item_seq: seq, device: dev, d: e.d }))).then((ok) => { if (ok) toast('기억했고, 다른 사용자와도 공유했어요'); });
    }
    cb.textContent = '기억했습니다'; cb.disabled = true;
    toast('기억했습니다. 내 약에도 저장했어요');
  });
  // 비슷한 약: 생김새(크기·모양·색·제형) / 같은 성분, 일반의약품만, 싼 순
  const sim = { mode: 'size', otc: !M.isOtc(r), sort: '', form: true, shape: true, line: true };
  const mmd = (v) => { if (v === null) return ''; const x = Math.round(v * 100) / 100; return `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(2)}`; };
  const drawSim = () => {
    let list, note;
    $('#simSizeOpt').classList.toggle('hidden', sim.mode !== 'size');
    if (sim.mode === 'size') {
      list = M.sizeAlike(data.db, r, { otcOnly: sim.otc, sameForm: sim.form, sameShape: sim.shape, sameLine: sim.line, limit: 60 }).map((x) => ({
        r: x.r, score: x.score,
        note: `이 약과 차이 · 장축 ${mmd(x.d.L)}` + (x.d.W !== null ? ` · 단축 ${mmd(x.d.W)}` : '') + (x.d.T !== null ? ` · 두께 ${mmd(x.d.T)}` : r.T ? ' · 두께 자료 없음' : '') + 'mm',
      }));
      note = !r.L ? '이 약은 크기 자료가 없어 찾을 수 없습니다.'
        : `기준: ${sizeTxt(r)} · 색·각인은 보지 않고 크기가 가까운 ${sim.otc ? '일반의약품' : '약'} 순서입니다. 조제·분포 시험용 대체약을 고를 때 쓰세요(복용 대체 아님).`;
    } else if (sim.mode === 'look') {
      list = M.similarLook(data.db, r, { otcOnly: sim.otc, limit: 40 }).map((x) => ({ r: x.r, score: x.score }));
      note = `크기·모양·색·제형이 비슷한 ${sim.otc ? '일반의약품' : '약'}입니다. 생김새가 비슷하다고 효능이 같은 것은 아니에요.`;
    } else {
      list = M.sameIngredient(data.db, r, { otcOnly: sim.otc }).map((x) => ({ r: x.r, exact: x.exact }));
      note = !r.ig && !r.pg ? '이 약은 주성분 정보가 없어 같은 성분 약을 찾을 수 없습니다(데이터 갱신 후 다시 확인).'
        : `주성분이 같은 ${sim.otc ? '일반의약품' : '약'} ${list.length}개. 같은 성분이라도 함량·용법·첨가물이 다를 수 있으니, 바꿔 드시려면 약사와 상의하세요.`;
      const cheap = list.filter((x) => x.r.pr).sort((a, b) => a.r.pr - b.r.pr)[0];
      if (cheap && r.pr && cheap.r.pr < r.pr) note += ` 가장 싼 약은 ${cheap.r.n} (${won(cheap.r.pr)}/${cheap.r.pu || '개'}) — 이 약보다 ${won(r.pr - cheap.r.pr)} 저렴(보험 약가 기준).`;
    }
    if (sim.sort === 'price') list = list.slice().sort((a, b) => (a.r.pr ?? 1e12) - (b.r.pr ?? 1e12));
    $('#simNote').textContent = note;
    $('#simList').innerHTML = list.length ? list.slice(0, 40).map((x, i) => card(x.r, { num: i + 1, score: x.score, note: x.note })).join('') : `<div class="empty-msg">${sim.otc ? '조건에 맞는 일반의약품이 없습니다. "일반의약품만"을 끄고 보세요.' : '비슷한 약이 없습니다.'}</div>`;
  };
  $('#item').querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => { sim.mode = b.dataset.sim; $('#item').querySelectorAll('[data-sim]').forEach((c) => c.classList.toggle('on', c === b)); drawSim(); }));
  $('#simOtc').addEventListener('click', (e) => { sim.otc = !sim.otc; e.currentTarget.classList.toggle('on', sim.otc); drawSim(); });
  $('#simSort').addEventListener('change', (e) => { sim.sort = e.target.value; drawSim(); });
  for (const k of ['form', 'shape', 'line']) $('#sim' + k[0].toUpperCase() + k.slice(1)).addEventListener('click', (e) => { sim[k] = !sim[k]; e.currentTarget.classList.toggle('on', sim[k]); drawSim(); });
  setTimeout(drawSim, 0);
  $('#cmpBtn').addEventListener('click', (e) => { toggleCmp(seq); const on = cmp.includes(seq); e.currentTarget.classList.toggle('on', on); e.currentTarget.textContent = on ? '비교에 담김' : '비교에 담기'; });
  $('#shareBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('링크를 복사했습니다'); } catch { toast(location.href, 4000); }
  });
  const d = await detailOf(seq);
  if (location.hash !== '#/item/' + encodeURIComponent(seq)) return;
  const doc = $('#doc');
  if (!d) { doc.innerHTML = '<div class="hint" style="padding:14px 0">이 약의 효능·용법 정보가 데이터에 없습니다. 아래 원문 링크에서 확인하세요.</div>'; return; }
  if (d.ingr) { const row = $('#ingrRow'); row.classList.remove('hidden'); row.querySelector('td').textContent = d.ingr; }
  const sec = [['efcy', '효능·효과'], ['use', '용법·용량'], ['warn', '이 약을 쓰기 전 꼭 알아야 할 것'], ['atpn', '주의사항'], ['intrc', '같이 먹으면 안 되는 약·음식'], ['se', '부작용'], ['keep', '보관 방법'], ['keep2', '저장 방법'], ['valid', '사용 기한']];
  doc.innerHTML = sec.filter(([k]) => d[k]).map(([k, t]) => `<details><summary>${t}</summary><div class="txt">${esc(d[k])}</div></details>`).join('') +
    `<div class="hint" style="padding:10px 0">출처: 식약처 ${esc(d.src)}</div>`;
}

// ---------- 내 약 · 설정 ----------
// 내 약 목록: 번호 · 선택 삭제 · 공유
const mineMode = { fav: false, hist: false };
const mineSel = { fav: new Set(), hist: new Set() };
const histKey = (h) => 'hist:' + h.t;
function toggleSel(key) {
  const l = key.startsWith('hist:') ? 'hist' : 'fav';
  mineSel[l].has(key) ? mineSel[l].delete(key) : mineSel[l].add(key);
  showMine();
}
function shareText(seqs) {
  const lines = seqs.map((s, i) => { const r = data.bySeq.get(s); return r ? `${i + 1}. ${r.n} (${r.e || ''}) ${printTxt(r) ? '[' + printTxt(r) + '] ' : ''}${location.origin}${location.pathname}#/item/${encodeURIComponent(s)}` : null; }).filter(Boolean);
  return '필파인더 약 목록\n' + lines.join('\n');
}
async function shareSeqs(seqs) {
  if (!seqs.length) { toast('공유할 약이 없습니다'); return; }
  const text = shareText(seqs);
  try { if (navigator.share) { await navigator.share({ title: '필파인더 약 목록', text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('목록을 복사했습니다'); } catch { toast('복사하지 못했습니다'); }
}
function mineBar(l) {
  if (!(l === 'fav' ? favs.length : hist.length)) return '';
  if (!mineMode[l]) return `<button class="chip" data-m="${l}-on">선택</button><button class="chip" data-m="${l}-share">전체 공유</button>`;
  const n = mineSel[l].size;
  return `<button class="chip" data-m="${l}-all">전체 선택</button><button class="chip" data-m="${l}-share">공유${n ? ` (${n})` : ''}</button><button class="chip danger" data-m="${l}-del">삭제${n ? ` (${n})` : ''}</button><button class="chip" data-m="${l}-off">취소</button>`;
}
// 실제 크기(mm) 비율로 겹쳐 그린 윤곽 — 모양은 대략적인 표현
function overlaySvg(rs) {
  const cols = ['#facc15', '#22d3ee', '#f472b6'];
  const dim = rs.map((r) => ({ L: Math.max(r.L || 0, r.W || 0), W: Math.min(r.L || 0, r.W || r.L || 0), sh: r.sh || '' }));
  const maxL = Math.max(...dim.map((d) => d.L), 1), maxW = Math.max(...dim.map((d) => d.W), 1);
  const pad = 4, vw = maxL + pad * 2, vh = maxW + pad * 2 + 5, cx = vw / 2, cy = (maxW + pad * 2) / 2;
  const shape = (d, i) => {
    const a = `fill="${cols[i]}" fill-opacity=".18" stroke="${cols[i]}" stroke-width="${Math.max(0.25, maxL / 90)}" ${i === 1 ? 'stroke-dasharray="1.2 0.8"' : i === 2 ? 'stroke-dasharray="3 1"' : ''}`;
    if (!d.L) return '';
    if (/원형/.test(d.sh) && !/타원|반원/.test(d.sh)) return `<circle cx="${cx}" cy="${cy}" r="${d.L / 2}" ${a}/>`;
    if (/타원/.test(d.sh)) return `<ellipse cx="${cx}" cy="${cy}" rx="${d.L / 2}" ry="${d.W / 2}" ${a}/>`;
    const rx = /장방/.test(d.sh) ? d.W * 0.45 : d.W * 0.18;
    return `<rect x="${cx - d.L / 2}" y="${cy - d.W / 2}" width="${d.L}" height="${d.W}" rx="${rx}" ${a}/>`;
  };
  const bx = cx - 2.5, by = maxW + pad * 2 + 1.5, fs = Math.max(1.6, maxL / 12);
  return `<svg viewBox="0 0 ${vw} ${vh}" aria-label="두 약의 실제 크기 비교"><line x1="${bx}" y1="${by}" x2="${bx + 5}" y2="${by}" stroke="#94a3b8" stroke-width="${maxL / 120}"/><text x="${cx + 3.5}" y="${by + fs * 0.35}" font-size="${fs}" fill="#94a3b8" font-family="Pretendard,sans-serif">5mm</text>${dim.map(shape).join('')}</svg>`;
}
function showCmp(seqs) {
  const box = $('#cmp'), rs = seqs.map((s) => data.bySeq && data.bySeq.get(s));
  document.title = '약 비교 — 필파인더';
  if (rs.length < 2 || rs.some((r) => !r)) { box.innerHTML = `<div class="empty-msg">${data.ready ? '비교할 약을 찾을 수 없습니다. 약 카드의 "비교 +"로 2~3개를 고르세요.' : '불러오는 중…'}</div>`; return; }
  const n = rs.length, NUM = ['①', '②', '③'], COL = ['#facc15', '#22d3ee', '#f472b6'];
  box.style.setProperty('--n', n);
  const mm = (v) => (v ? `${v}mm` : '');
  const dd = (x, y) => { if (!x || !y) return ''; const d = Math.round((y - x) * 100) / 100; return d ? `<small>① 대비 ${d > 0 ? '+' : '−'}${Math.abs(d)}mm</small>` : '<small style="color:#86efac">① 과 같음</small>'; };
  const rows = [
    ['구분', (r) => r.o], ['제형', (r) => r.f], ['모양', (r) => r.sh], ['색', (r) => M.dbColors(r).join(', ')],
    ['각인 앞', (r) => r.pf], ['각인 뒤', (r) => r.pb], ['분할선', (r) => lineTxt(r) || '없음'],
    ['장축', (r) => mm(r.L), 'L'], ['단축', (r) => mm(r.W), 'W'], ['두께', (r) => mm(r.T), 'T'],
    ['업체', (r) => r.e], ['분류', (r) => r.cl], ['주성분', (r) => r.in],
    ['보험 약가', (r) => (r.pr ? `${won(r.pr)}/${r.pu || '개'}` : '')],
  ];
  const cells = rows.map(([k, f, key]) => {
    const vals = rs.map((r) => f(r) || '-'), diff = vals.some((v) => v !== vals[0]);
    const cls = (key ? 'sz ' : '') + (diff ? 'diff' : 'same');
    return `<div class="h">${k}</div>` + vals.map((v, i) => `<div class="${cls}">${esc(v)}${key && i ? dd(rs[0][key], rs[i][key]) : ''}</div>`).join('');
  }).join('');
  const head = (r, i) => `<div class="c"><div class="im">${r.img ? `<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer">` : glyph(r)}</div><span style="color:${COL[i]}">${NUM[i]}</span> ${otcBadge(r)}${esc(r.n.replace(/\(.*$/, ''))}</div>`;
  const ls = rs.map((r) => Math.max(r.L || 0, r.W || 0));
  const dl = rs.every((r) => r.L) ? Math.max(...ls) - Math.min(...ls) : null;
  box.innerHTML = `
    <h2 style="margin-top:4px">약 비교 (${n}개)</h2>
    <div class="heads"><div></div>${rs.map(head).join('')}</div>
    <div class="hint" style="margin:2px 0">노랑 칸은 서로 다른 항목입니다.${dl !== null ? ` 장축 차이(최대−최소) ${dl.toFixed(2)}mm.` : ''}</div>
    <div class="ovl">${rs.every((r) => r.L) ? overlaySvg(rs) : '<div class="hint">크기 자료가 없는 약이 있어 겹쳐 볼 수 없습니다.</div>'}<div class="hint" style="text-align:center">실제 크기 비율 겹쳐 보기 · ${rs.map((r, i) => `<span style="color:${COL[i]}">${NUM[i]} ${['실선', '점선', '긴 점선'][i]}</span>`).join(' · ')} (모양은 대략적인 표현)</div></div>
    <div class="grid3">${cells}</div>
    <div class="row" style="margin-top:12px">${rs.map((r, i) => `<a class="btn secondary" href="#/item/${encodeURIComponent(r.s)}">${NUM[i]} 상세 보기</a>`).join('')}</div>
    <p class="disclaimer">크기·모양이 같아도 다른 약일 수 있습니다. 복용 전에는 약 봉투·포장의 이름을 확인하세요.</p>`;
}
function showMine() {
  const fl = favs.map((s) => data.bySeq.get(s)).filter(Boolean);
  $('#favList').innerHTML = fl.length ? fl.map((r, i) => card(r, { num: i + 1, ...(mineMode.fav ? { key: r.s, checked: mineSel.fav.has(r.s) } : {}) })).join('') : '<div class="empty-msg">약 상세 화면에서 <b>내 약에 저장</b>을 누르면 여기에 모입니다.</div>';
  $('#histList').innerHTML = hist.length ? hist.map((h, i) => {
    const r = h.seq && data.bySeq.get(h.seq);
    const when = new Date(h.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const k = histKey(h), sel = mineMode.hist && mineSel.hist.has(k);
    return `<button class="card${sel ? ' sel' : ''}" data-hk="${esc(k)}" ${mineMode.hist ? `data-seq="${esc(h.seq || 'x')}" data-key="${esc(k)}"` : r ? `data-seq="${esc(r.s)}"` : ''}>${preCard({ num: i + 1, ...(mineMode.hist ? { key: k, checked: sel } : {}) })}<div class="img"><img src="${h.thumb}" alt=""></div>
      <div class="body"><div class="name">${r ? esc(r.n) : '찾지 못함'}</div><div class="sub">${when} · 1순위 후보</div></div></button>`;
  }).join('') : '<div class="empty-msg">아직 찍어서 찾은 약이 없습니다.</div>';
  $('#favBar').innerHTML = mineBar('fav'); $('#histBar').innerHTML = mineBar('hist');
  $('#sCoin').value = settings.coin;
  $('#sShare').checked = settings.share; $('#shareRow').classList.toggle('hidden', !SH.enabled());
  $('#sAi').checked = settings.ai; $('#aiBox').classList.toggle('hidden', !settings.ai);
  $('#sKey').value = settings.aiKey; $('#sModel').value = settings.aiModel;
}
// 카드를 꾹 누르면(0.5초) 선택 모드로 들어가며 그 약이 선택된다
let lp = null, lpFired = 0;
const lpCancel = () => { clearTimeout(lp); lp = null; };
$('#pgMine').addEventListener('pointerdown', (e) => {
  const c = e.target.closest('#favList .card, #histList .card'); if (!c || e.button > 0) return;
  const l = c.closest('#favList') ? 'fav' : 'hist';
  const key = l === 'fav' ? c.dataset.seq : c.dataset.hk; if (!key) return;
  lpCancel();
  lp = setTimeout(() => {
    lp = null; lpFired = Date.now();
    mineMode[l] = true; mineSel[l].add(key);
    if (navigator.vibrate) navigator.vibrate(30);
    showMine();
  }, 500);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) $('#pgMine').addEventListener(ev, (e) => { if (ev !== 'pointermove' || Math.abs(e.movementX) + Math.abs(e.movementY) > 6) lpCancel(); });
$('#pgMine').addEventListener('contextmenu', (e) => { if (e.target.closest('#favList .card, #histList .card')) e.preventDefault(); });
// 꾹 누른 직후 따라오는 click은 무시(상세 화면으로 넘어가거나 선택이 바로 풀리지 않게)
document.addEventListener('click', (e) => { if (Date.now() - lpFired < 600) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
$('#pgMine').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  const [l, act] = b.dataset.m.split('-');
  const keys = () => (l === 'fav' ? favs : hist.map(histKey));
  if (act === 'on') { mineMode[l] = true; mineSel[l].clear(); }
  else if (act === 'off') { mineMode[l] = false; mineSel[l].clear(); }
  else if (act === 'all') { mineSel[l].size === keys().length ? mineSel[l].clear() : (mineSel[l] = new Set(keys())); }
  else if (act === 'share') {
    const pick = mineMode[l] && mineSel[l].size ? mineSel[l] : null;
    const seqs = l === 'fav' ? favs.filter((s) => !pick || pick.has(s)) : hist.filter((h) => h.seq && (!pick || pick.has(histKey(h)))).map((h) => h.seq);
    shareSeqs(seqs); return;
  } else if (act === 'del') {
    const n = mineSel[l].size; if (!n) { toast('지울 약을 먼저 선택하세요'); return; }
    if (!confirm(`선택한 ${n}개를 지울까요?`)) return;
    if (l === 'fav') { favs = favs.filter((s) => !mineSel.fav.has(s)); store.set('pf.favs', favs); }
    else { hist = hist.filter((h) => !mineSel.hist.has(histKey(h))); store.set('pf.hist', hist); }
    mineSel[l].clear(); mineMode[l] = false; toast(`${n}개를 지웠습니다`);
  }
  showMine();
});
$('#sCoin').addEventListener('change', (e) => { settings.coin = e.target.value; saveSettings(); });
$('#sCardGuide').addEventListener('change', (e) => { settings.cardGuide = e.target.checked; saveSettings(); syncGuide(); });
function syncGuide() { $('#guideBox').style.display = settings.cardGuide ? 'none' : ''; $('#sCardGuide').checked = settings.cardGuide; }
syncGuide();
$('#sShare').addEventListener('change', (e) => { settings.share = e.target.checked; saveSettings(); if (settings.share) { shared.t = 0; syncShared(); } });
$('#sAi').addEventListener('change', (e) => { settings.ai = e.target.checked; saveSettings(); $('#aiBox').classList.toggle('hidden', !settings.ai); });
$('#sKey').addEventListener('change', (e) => { settings.aiKey = e.target.value.trim(); saveSettings(); toast('키를 이 기기에 저장했습니다'); });
$('#sModel').addEventListener('change', (e) => { settings.aiModel = e.target.value; saveSettings(); });

// ---------- 시작 ----------
$('#ver').textContent = 'v' + APP_VERSION;

// ---------- 앱 설치 · 전체화면 ----------
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const de = document.documentElement;
function syncTopBtns() {
  $('#btnInstall').classList.toggle('hidden', isStandalone());
  $('#btnFull').classList.toggle('hidden', !(de.requestFullscreen || de.webkitRequestFullscreen) || isIOS);
  $('#btnFull').textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? '전체화면 해제' : '전체화면';
}
$('#btnInstall').addEventListener('click', async () => {
  const ev = window.__bip;
  if (ev) { ev.prompt(); try { await ev.userChoice; } catch (e) { /* 무시 */ } window.__bip = null; syncTopBtns(); return; }
  toast(isIOS ? 'Safari 아래 공유 버튼 → "홈 화면에 추가"를 누르세요' : '브라우저 메뉴(≡ 또는 ⋮) → "앱 설치" 또는 "홈 화면에 추가"를 누르세요', 6000);
});
window.addEventListener('appinstalled', () => { window.__bip = null; toast('설치했습니다. 홈 화면에서 열어 보세요'); syncTopBtns(); });
$('#btnFull').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (de.requestFullscreen || de.webkitRequestFullscreen).call(de, { navigationUI: 'hide' });
  } catch (e) { toast('이 브라우저에서는 전체화면을 쓸 수 없습니다. 앱으로 설치하면 주소창 없이 열립니다', 4500); }
});
document.addEventListener('fullscreenchange', syncTopBtns);
document.addEventListener('webkitfullscreenchange', syncTopBtns);
matchMedia('(display-mode: standalone)').addEventListener?.('change', syncTopBtns);
syncTopBtns();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
loadData();
syncShared();
