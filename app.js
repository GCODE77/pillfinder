// 필파인더 화면 로직
import { readImprint, warmUpOcr } from './ocr.js';

const APP_VERSION = '1.0.1';
const V = window.Vision, M = window.Match;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 저장(기기 안에만) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('저장 공간이 부족합니다'); } },
};
const settings = Object.assign({ auto: true, coin: '24', ai: false, aiKey: '', aiModel: 'claude-opus-5-5' }, store.get('pf.settings', {}));
const saveSettings = () => store.set('pf.settings', settings);
let favs = store.get('pf.favs', []);
let hist = store.get('pf.hist', []);

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
const sizeTxt = (r) => (r.L ? `${r.L}${r.W && r.W !== r.L ? '×' + r.W : ''}mm` : '');
const printTxt = (r) => [r.pf, r.pb].filter(Boolean).join(' / ');

function card(r, extra = {}) {
  const feat = [r.sh, M.dbColors(r).join('·'), printTxt(r) && `<b>${esc(printTxt(r))}</b>`, sizeTxt(r)].filter(Boolean);
  const why = extra.parts ? Object.entries(extra.parts).map(([k, v]) => `<span class="${v > 0.75 ? 'hi' : ''}">${{ shape: '모양', color: '색', aspect: '비율', size: '크기', imprint: '각인' }[k]} ${Math.round(v * 100)}</span>`).join('') : '';
  return `<button class="card" data-seq="${esc(r.s)}">
    <div class="img">${imgOf(r)}</div>
    <div class="body"><div class="name">${otcBadge(r)}${esc(r.n)}</div><div class="sub">${esc(r.e)}${r.cl ? ' · ' + esc(r.cl) : ''}</div>
      <div class="feat">${feat.map((f) => `<span>${f.startsWith('<b>') ? f : esc(f)}</span>`).join('')}</div>${why ? `<div class="why">${why}</div>` : ''}</div>
    ${extra.score !== undefined ? `<div class="score">${Math.round(extra.score * 100)}<small>일치</small></div>` : ''}
  </button>`;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('.card[data-seq]');
  if (c) location.hash = '#/item/' + encodeURIComponent(c.dataset.seq);
});

// ---------- 화면 이동 ----------
const PAGES = { cam: '#pgCam', search: '#pgSearch', shape: '#pgShape', item: '#pgItem', mine: '#pgMine' };
function route() {
  const [, page = 'cam', arg] = (location.hash || '#/cam').split('/');
  const key = PAGES[page] ? page : 'cam';
  if (key !== 'item') document.title = '필파인더 — 찍으면 무슨 약인지';
  for (const k in PAGES) $(PAGES[k]).classList.toggle('on', k === key);
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === key));
  if (key === 'cam') camEnter(); else camLeave();
  if (key === 'search') setTimeout(() => $('#q').focus(), 50);
  if (key === 'shape') runFilter();
  if (key === 'item') showItem(decodeURIComponent(arg || ''));
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
  try {
    video.srcObject = stream;
    await video.play();
  } catch (e) { /* 일부 기기는 play()가 늦게 끝남 — 영상은 그대로 나온다 */ }
  $('#camEmpty').classList.add('hidden');
  showStill(null);
  live = true; liveLoop();
  warmUpOcr();
}
function camStop() { live = false; if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
function camEnter() { if (!capturing && !$('#still').src) { if (store.get('pf.camOk', false)) camStart(); } }
function camLeave() { camStop(); }
$('#btnCamStart').addEventListener('click', () => { store.set('pf.camOk', true); camStart(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) camStop(); else if (location.hash.startsWith('#/cam') || !location.hash) camEnter(); });

// 화면 좌표 ↔ 영상 좌표 (object-fit: contain)
function fit(el, w, h) {
  const r = el.getBoundingClientRect();
  const s = Math.min(r.width / w, r.height / h);
  return { s, ox: (r.width - w * s) / 2, oy: (r.height - h * s) / 2, rw: r.width, rh: r.height };
}

function drawOverlay(res, sw, sh, srcW, srcH) {
  const r = ovl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (ovl.width !== Math.round(r.width * dpr)) { ovl.width = Math.round(r.width * dpr); ovl.height = Math.round(r.height * dpr); }
  const ctx = ovl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  if (!res || !res.ok) return;
  const f = fit(ovl, srcW, srcH), k = srcW / sw;
  const draw = (o, color, width, dash) => {
    ctx.beginPath();
    o.outline.forEach(([x, y], i) => { const X = f.ox + (x + 0.5) * k * f.s, Y = f.oy + (y + 0.5) * k * f.s; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.setLineDash(dash || []); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  };
  for (const o of res.objects) if (o !== res.pill && o !== res.coin) draw(o, 'rgba(203,213,225,.45)', 1.5, [5, 5]);
  if (res.coin) draw(res.coin, '#7dd3fc', 2.5, [8, 5]);
  if (res.pill) {
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6;
    draw(res.pill, '#facc15', 3);
    ctx.shadowBlur = 0;
    // 장축 표시
    const p = res.pill, ca = Math.cos(p.angle), sa = Math.sin(p.angle), h = p.long / 2;
    ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(250,204,21,.7)';
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
    const mm = (p.long / res.coin.long) * Number(settings.coin);
    tags.push(`<span class="pill-tag">동전 기준 <b>${mm.toFixed(1)}mm</b></span>`);
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
  if (!live) return;
  if (!liveBusy && video.readyState >= 2 && video.videoWidth) {
    liveBusy = true;
    const vwid = video.videoWidth, vhei = video.videoHeight;
    const sw = 320, sh = Math.round((vhei / vwid) * sw);
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(video, 0, 0, sw, sh);
    const img = sctx.getImageData(0, 0, sw, sh);
    const res = await vision(img, { seed, coin: true }, 4000);
    liveBusy = false;
    if (!live) return;
    lastLive = res;
    drawOverlay(res, sw, sh, vwid, vhei);
    liveTags(res, sw);
    // 윤곽이 멈춰 있으면(0.9초) 자동 촬영
    const good = res.ok && res.pill && !res.pill.cut && res.pill.contrast >= 10 && res.pill.long >= sw * 0.08;
    if (good) {
      const p = res.pill, cur = [p.cx / sw, p.cy / sh, p.long / sw, p.short / sw];
      hist6.push(cur); if (hist6.length > 6) hist6.shift();
      const steady = hist6.length >= 4 && hist6.every((h) => Math.abs(h[0] - cur[0]) < 0.02 && Math.abs(h[1] - cur[1]) < 0.02 && Math.abs(h[2] - cur[2]) / cur[2] < 0.06);
      if (steady) { if (!stableSince) stableSince = performance.now(); } else stableSince = 0;
    } else { hist6 = []; stableSince = 0; }
    const t = stableSince ? (performance.now() - stableSince) / 900 : 0;
    setRing(settings.auto ? t : 0);
    if (settings.auto && t >= 1 && !capturing) { stableSince = 0; hist6 = []; capture(); }
  }
  requestAnimationFrame(liveLoop);
}

$('#stage').addEventListener('click', (e) => {
  if (!live) return;
  const r = ovl.getBoundingClientRect();
  const f = fit(ovl, video.videoWidth, video.videoHeight);
  const x = (e.clientX - r.left - f.ox) / (video.videoWidth * f.s), y = (e.clientY - r.top - f.oy) / (video.videoHeight * f.s);
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { seed = { x, y }; hist6 = []; toast('이 약으로 찾습니다'); }
});

$('#btnAuto').classList.toggle('on', settings.auto);
$('#btnAuto').addEventListener('click', () => { settings.auto = !settings.auto; saveSettings(); $('#btnAuto').classList.toggle('on', settings.auto); toast(settings.auto ? '윤곽이 멈추면 자동으로 찍습니다' : '자동 촬영 끔'); });
$('#btnShoot').addEventListener('click', () => (stream ? capture() : $('#file').click()));
$('#btnLoad').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) fromBlob(f); });
window.addEventListener('paste', (e) => {
  const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (it) { location.hash = '#/cam'; fromBlob(it.getAsFile()); }
});
// PC: 사진을 끌어다 놓기
$('#stage').addEventListener('dragover', (e) => e.preventDefault());
$('#stage').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) fromBlob(f); });

async function fromBlob(blob) {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return toast('사진을 읽을 수 없습니다');
  const c = toCanvas(bmp, bmp.width, bmp.height);
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
  if (canvas) { im.src = canvas.toDataURL('image/jpeg', 0.85); im.classList.remove('hidden'); video.classList.add('hidden'); $('#guideBox').classList.add('hidden'); }
  else { im.removeAttribute('src'); im.classList.add('hidden'); video.classList.remove('hidden'); $('#guideBox').classList.remove('hidden'); }
}
function busy(on, text) { $('#busy').classList.toggle('on', !!on); if (text) $('#busyText').textContent = text; }

// ---------- 식별 ----------
// sides: 앞면/뒷면 사진마다 {thumb, res, reads, ai}
let sides = [], obsEdit = null, pendingBack = false;

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
  capturing = true;
  live = false;
  showStill(canvas);
  drawOverlay(null);
  $('#liveTags').innerHTML = ''; setRing(0);
  busy(true, '윤곽과 모양을 재는 중');
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const res = await vision(img, { seed, crop: true, coin: true });
    if (!res.ok || !res.pill) {
      busy(false);
      toast(res.reason === 'timeout' ? '분석이 너무 오래 걸립니다. 다시 찍어 주세요' : '약을 찾지 못했어요. 단색 바닥에 한 알만 두고 다시 찍어 주세요', 3800);
      if (!pendingBack) resetCam();
      return;
    }
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
    if (pendingBack && sides.length) sides[1] = side; else sides = [side];
    pendingBack = false;
    obsEdit = null;
    busy(false);
    renderResult(true);
  } finally {
    capturing = false;
  }
}
const stripRes = (r) => ({ pill: r.pill, coin: r.coin && { long: r.coin.long, short: r.coin.short }, bg: r.bg });

function resetCam() {
  sides = []; obsEdit = null; seed = null; pendingBack = false;
  $('#result').classList.add('hidden'); $('#resultIntro').classList.remove('hidden');
  showStill(null);
  if (stream) { live = true; liveLoop(); } else camEnter();
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
    const coin = Number(settings.coin);
    mm = {
      long: withCoin.reduce((a, s) => a + (s.res.pill.long / s.res.coin.long) * coin, 0) / withCoin.length,
      short: withCoin.reduce((a, s) => a + (s.res.pill.short / s.res.coin.long) * coin, 0) / withCoin.length,
    };
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
  return { shape, colors, aspect, mm, imprints };
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
  return o;
}

function fillSelect(sel, items, value, autoLabel) {
  sel.innerHTML = `<option value="">${autoLabel}</option>` + items.map((k) => `<option value="${k}" ${k === value ? 'selected' : ''}>${k}</option>`).join('');
}

function renderResult(fresh) {
  $('#resultIntro').classList.add('hidden');
  $('#result').classList.remove('hidden');
  const o = autoObs();
  const p0 = sides[0].res.pill;
  $('#thumbs').innerHTML = sides.map((s, i) => `<div style="text-align:center"><img src="${s.thumb}" alt=""><div class="hint">${i ? '뒷면' : '앞면'}</div></div>`).join('') +
    `<div class="hint" style="flex:1;margin-left:4px">영상 분석: <b>${esc(p0.shapeTop)}</b> ${Math.round(p0.shape[p0.shapeTop] * 100)}% · ${esc(p0.colorTop.join('/'))} · 비율 ${o.aspect.toFixed(2)}${o.mm ? ` · 동전 기준 ${o.mm.long.toFixed(1)}×${o.mm.short.toFixed(1)}mm` : ''}${sides.some((s) => s.ai) ? '<br>AI 판독 포함' : ''}</div>`;
  if (fresh) {
    const topShape = Object.keys(o.shape).reduce((a, b) => (o.shape[a] >= o.shape[b] ? a : b));
    fillSelect($('#oShape'), V.SHAPES, '', `자동 (${topShape})`);
    const cTop = (c) => c && Object.keys(c.probs).reduce((a, b) => (c.probs[a] >= c.probs[b] ? a : b));
    fillSelect($('#oColor'), COLOR_LIST, '', `자동 (${cTop(o.colors[0])})`);
    fillSelect($('#oColor2'), COLOR_LIST, '', o.colors[1] ? `자동 (${cTop(o.colors[1])})` : '없음');
    $('#oSize').value = o.mm ? `${o.mm.long.toFixed(1)} x ${o.mm.short.toFixed(1)}` : '';
    const best = o.imprints.slice().sort((a, b) => b.conf - a.conf);
    const front = best.find((r) => r.side === 0), back = best.find((r) => r.side === 1);
    $('#oImprint').value = [front && front.text, back && back.text].filter(Boolean).join(' ');
    $('#reads').innerHTML = best.length
      ? best.map((r) => `<button class="chip" data-read="${esc(r.text)}">${esc(r.text)} <span class="hint">${r.how === 'AI' ? 'AI' : Math.round(r.conf * 100) + '%'}</span></button>`).join('')
      : '<span class="hint">글자를 읽지 못했습니다. 각인이 있으면 위에 직접 넣어 주세요.</span>';
    $('#obsNote').textContent = sides[0].ai && sides[0].ai.note ? 'AI 메모: ' + sides[0].ai.note : '';
    $('#btnBack').textContent = sides.length > 1 ? '뒷면 다시 찍기' : '뒷면도 찍기';
  }
  rerank();
  if (fresh) saveHistory();
}

function rerank() {
  if (!data.ready) { $('#cands').innerHTML = '<div class="empty-msg">약 데이터가 없어 비교할 수 없습니다.</div>'; return; }
  const ranked = M.rank(data.db, currentObs(), { limit: 30 });
  $('#candTitle').textContent = `닮은 약 ${ranked.length ? '' : '— 없음'}`;
  $('#cands').innerHTML = ranked.map((x) => card(x.r, { score: x.score, parts: x.parts })).join('');
  rerank.top = ranked[0];
}

function saveHistory() {
  const top = rerank.top;
  hist.unshift({ t: Date.now(), thumb: sides[0].mini, seq: top ? top.r.s : null });
  hist = hist.slice(0, 30);
  store.set('pf.hist', hist);
}

const editObs = () => {
  const sz = $('#oSize').value.match(/([\d.]+)\s*[x×*]?\s*([\d.]+)?/);
  obsEdit = {
    shape: $('#oShape').value || undefined,
    color: $('#oColor').value || undefined,
    color2: $('#oColor2').value || ($('#oColor').value ? '' : undefined),
    imprint: $('#oImprint').value,
    mm: sz ? { long: Math.max(+sz[1], +(sz[2] || sz[1])), short: Math.min(+sz[1], +(sz[2] || sz[1])) } : null,
  };
  rerank();
};
['#oShape', '#oColor', '#oColor2'].forEach((s) => $(s).addEventListener('change', editObs));
let editT;
['#oImprint', '#oSize'].forEach((s) => $(s).addEventListener('input', () => { clearTimeout(editT); editT = setTimeout(editObs, 250); }));
$('#reads').addEventListener('click', (e) => { const c = e.target.closest('[data-read]'); if (c) { $('#oImprint').value = c.dataset.read; editObs(); } });
$('#btnRetake').addEventListener('click', resetCam);
$('#btnBack').addEventListener('click', () => {
  pendingBack = true; seed = null;
  toast('약을 뒤집어서 비춰 주세요');
  showStill(null);
  if (stream) { live = true; liveLoop(); } else if (store.get('pf.camOk', false)) camStart(); else $('#file').click();
});

// ---------- 이름 검색 ----------
let qRes = [], qShown = 0;
function runSearch() {
  const q = $('#q').value.trim();
  if (!q) { $('#qList').innerHTML = ''; $('#qInfo').textContent = '약국에서 받은 약 봉투의 이름을 그대로 넣어 보세요.'; $('#qMore').classList.add('hidden'); return; }
  if (!data.ready) { $('#qInfo').textContent = '약 데이터가 없습니다.'; return; }
  qRes = M.searchName(data.db, q, 300);
  qShown = 0;
  $('#qList').innerHTML = '';
  $('#qInfo').textContent = qRes.length ? `${qRes.length >= 300 ? '300+' : qRes.length}개` : '찾는 약이 없습니다. 띄어쓰기 없이, 또는 앞 글자만 넣어 보세요.';
  moreSearch();
}
function moreSearch() {
  const next = qRes.slice(qShown, qShown + 40);
  $('#qList').insertAdjacentHTML('beforeend', next.map((r) => card(r)).join(''));
  qShown += next.length;
  $('#qMore').classList.toggle('hidden', qShown >= qRes.length);
}
let qT;
$('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(runSearch, 160); });
$('#qMore').addEventListener('click', moreSearch);

// ---------- 모양으로 찾기 ----------
const filt = { shapes: [], colors: [] };
$('#fShapes').innerHTML = V.SHAPES.map((s) => `<button class="chip" data-shape="${s}">${s}</button>`).join('');
$('#fColors').innerHTML = COLOR_LIST.map((c) => `<button class="chip" data-color="${c}"><span class="sw" style="background:${SWATCH[c]}"></span>${c}</button>`).join('');
$('#fShapes').addEventListener('click', (e) => { const b = e.target.closest('[data-shape]'); if (!b) return; toggle(filt.shapes, b.dataset.shape); b.classList.toggle('on'); runFilter(); });
$('#fColors').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; toggle(filt.colors, b.dataset.color); b.classList.toggle('on'); runFilter(); });
const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
let fRes = [], fShown = 0, fT;
$('#fImprint').addEventListener('input', () => { clearTimeout(fT); fT = setTimeout(runFilter, 200); });
$('#fSimilar').addEventListener('change', runFilter);
$('#fReset').addEventListener('click', () => { filt.shapes = []; filt.colors = []; $('#fImprint').value = ''; document.querySelectorAll('#fShapes .chip,#fColors .chip').forEach((c) => c.classList.remove('on')); runFilter(); });
function runFilter() {
  const imprint = $('#fImprint').value.trim();
  if (!filt.shapes.length && !filt.colors.length && !imprint) { $('#fList').innerHTML = ''; $('#fInfo').textContent = '각인·모양·색 중 아는 것만 골라도 됩니다.'; $('#fMore').classList.add('hidden'); return; }
  if (!data.ready) { $('#fInfo').textContent = '약 데이터가 없습니다.'; return; }
  const f = M.manualFilter({ shapes: filt.shapes, colors: filt.colors, imprint, similarColors: $('#fSimilar').checked });
  const q = M.normImprint(imprint);
  fRes = data.db.filter(f);
  // 각인이 정확히 같은 것 → 앞부분 일치 → 나머지
  if (q) fRes.sort((a, b) => rankImp(b, q) - rankImp(a, q));
  fShown = 0; $('#fList').innerHTML = '';
  $('#fInfo').textContent = `${fRes.length.toLocaleString()}개`;
  moreFilter();
}
const rankImp = (r, q) => Math.max(...[r.pf, r.pb].map((t) => { const n = M.normImprint(t); return n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0; }));
function moreFilter() {
  const next = fRes.slice(fShown, fShown + 40);
  $('#fList').insertAdjacentHTML('beforeend', next.map((r) => card(r)).join(''));
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
    ['성상', r.ch], ['영문명', r.en], ['품목코드', r.s],
  ].filter(([, v]) => v);
  box.innerHTML = `
    <div class="detail-head">
      <div class="detail-img">${r.img ? `<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer">` : glyph(r).replace('width="92" height="66"', 'width="70%" height="70%"')}</div>
      <div>
        <div class="detail-name">${otcBadge(r)}${esc(r.n)}</div>
        <div class="row" style="flex-wrap:nowrap"><button class="fav ${isFav ? 'on' : ''}" id="favBtn">${isFav ? '내 약에 저장됨' : '내 약에 저장'}</button>
          <button class="fav" id="shareBtn">링크 복사</button></div>
        <table class="spec">${spec.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}<tr id="ingrRow" class="hidden"><th>성분</th><td></td></tr></table>
      </div>
    </div>
    <div class="doc" id="doc"><div class="hint" style="padding:14px 0">효능·용법·주의사항 불러오는 중…</div></div>
    <div class="links">
      <a class="btn secondary" target="_blank" rel="noopener" href="https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(r.s)}">의약품안전나라 원문</a>
      <a class="btn secondary" target="_blank" rel="noopener" href="https://www.health.kr/searchResult?search_value=${encodeURIComponent(r.n.replace(/\(.*$/, ''))}">약학정보원에서 보기</a>
    </div>
    <p class="disclaimer">사진·모양이 같은 다른 약이 있을 수 있습니다. 복용 전 약 봉투·포장의 이름을 확인하고, 궁금한 점은 약사·의사에게 물어보세요.</p>`;
  $('#favBtn').addEventListener('click', (e) => {
    const i = favs.indexOf(seq);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(seq);
    store.set('pf.favs', favs);
    e.target.classList.toggle('on', i < 0); e.target.textContent = i < 0 ? '내 약에 저장됨' : '내 약에 저장';
  });
  $('#shareBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('링크를 복사했습니다'); } catch { toast(location.href, 4000); }
  });
  const d = await detailOf(seq);
  if (location.hash !== '#/item/' + encodeURIComponent(seq)) return;
  const doc = $('#doc');
  if (!d) { doc.innerHTML = '<div class="hint" style="padding:14px 0">이 약의 효능·용법 정보가 데이터에 없습니다. 아래 원문 링크에서 확인하세요.</div>'; return; }
  if (d.ingr) { const row = $('#ingrRow'); row.classList.remove('hidden'); row.querySelector('td').textContent = d.ingr; }
  const sec = [['efcy', '효능·효과'], ['use', '용법·용량'], ['warn', '이 약을 쓰기 전 꼭 알아야 할 것'], ['atpn', '주의사항'], ['intrc', '같이 먹으면 안 되는 약·음식'], ['se', '부작용'], ['keep', '보관 방법'], ['keep2', '저장 방법'], ['valid', '사용 기한']];
  doc.innerHTML = sec.filter(([k]) => d[k]).map(([k, t], i) => `<details ${i < 2 ? 'open' : ''}><summary>${t}</summary><div class="txt">${esc(d[k])}</div></details>`).join('') +
    `<div class="hint" style="padding:10px 0">출처: 식약처 ${esc(d.src)}</div>`;
}

// ---------- 내 약 · 설정 ----------
function showMine() {
  const fl = favs.map((s) => data.bySeq.get(s)).filter(Boolean);
  $('#favList').innerHTML = fl.length ? fl.map((r) => card(r)).join('') : '<div class="empty-msg">약 상세 화면에서 <b>내 약에 저장</b>을 누르면 여기에 모입니다.</div>';
  $('#histList').innerHTML = hist.length ? hist.map((h) => {
    const r = h.seq && data.bySeq.get(h.seq);
    const when = new Date(h.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<button class="card" ${r ? `data-seq="${esc(r.s)}"` : ''}><div class="img"><img src="${h.thumb}" alt=""></div>
      <div class="body"><div class="name">${r ? esc(r.n) : '찾지 못함'}</div><div class="sub">${when} · 1순위 후보</div></div></button>`;
  }).join('') : '<div class="empty-msg">아직 찍어서 찾은 약이 없습니다.</div>';
  $('#sCoin').value = settings.coin;
  $('#sAi').checked = settings.ai; $('#aiBox').classList.toggle('hidden', !settings.ai);
  $('#sKey').value = settings.aiKey; $('#sModel').value = settings.aiModel;
}
$('#sCoin').addEventListener('change', (e) => { settings.coin = e.target.value; saveSettings(); });
$('#sAi').addEventListener('change', (e) => { settings.ai = e.target.checked; saveSettings(); $('#aiBox').classList.toggle('hidden', !settings.ai); });
$('#sKey').addEventListener('change', (e) => { settings.aiKey = e.target.value.trim(); saveSettings(); toast('키를 이 기기에 저장했습니다'); });
$('#sModel').addEventListener('change', (e) => { settings.aiModel = e.target.value; saveSettings(); });

// ---------- 시작 ----------
$('#ver').textContent = 'v' + APP_VERSION;
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
loadData();
