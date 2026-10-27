// 각인 글자 판독(온디바이스 OCR, Tesseract.js — vendor/tesseract, 오프라인 동작)
// vision.js가 장축을 가로로 눕혀 잘라 준 회색조 이미지 두 장(국소대비·원본)을
// 0°/180°(둥근 약은 90°/270°까지) 돌려 가며 읽고, 그럴듯한 글자만 돌려준다.

let workerP = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('OCR 모듈을 불러오지 못했습니다'));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      await loadScript('vendor/tesseract/tesseract.min.js');
      const base = new URL('vendor/tesseract/', location.href).href;
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
        workerBlobURL: false,
      });
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
        tessedit_pageseg_mode: '7', // 한 줄
        user_defined_dpi: '300',
      });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

// 미리 받아 두기(카메라 화면에 들어오면 호출)
export function warmUpOcr() { getWorker().catch(() => {}); }

function toCanvas(gray, w, h, rot, invert, bgv = 255) {
  const pad = 24, scale = 1.4;
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  const id = sctx.createImageData(w, h);
  for (let i = 0; i < gray.length; i++) {
    const v = invert ? 255 - gray[i] : gray[i];
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);
  const rad = (rot * Math.PI) / 180;
  const vertical = Math.abs(Math.sin(rad)) > 0.7;
  const c = document.createElement('canvas');
  c.width = (vertical ? sh : sw) + pad * 2; c.height = (vertical ? sw : sh) + pad * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${bgv},${bgv},${bgv})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  return c;
}

const clean = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');

// crop: {w,h,detail,raw}, aspect: 장단축비. 반환: [{text, conf(0~1), how}]
export async function readImprint(crop, aspect, onProgress) {
  if (!crop) return [];
  const w = await getWorker();
  // 둥근 약: 획 분포로 잰 글자 줄 방향으로 먼저 세워 보고, 안 되면 90° 단위로
  const ta = Math.round((-(crop.textAngle || 0) * 180) / Math.PI);
  const useTa = crop.textElong > 1.5 && Math.abs(ta) > 8;
  const rots = aspect < 1.15 ? [...(useTa ? [ta, ta + 180] : []), 0, 180, 90, 270] : [0, 180, ...(useTa ? [ta, ta + 180] : [])];
  const jobs = [];
  for (const rot of rots) {
    jobs.push({ g: crop.detail, rot, inv: false, how: '음각' });
    jobs.push({ g: crop.raw, rot, inv: false, how: '인쇄' });
    if (crop.relief) jobs.push({ g: crop.relief, rot, inv: false, how: '윤곽' });
  }
  const reads = [];
  let i = 0;
  for (const j of jobs) {
    onProgress && onProgress(++i / jobs.length);
    const c = toCanvas(j.g, crop.w, crop.h, j.rot, j.inv, j.g[0]);
    try {
      const { data } = await w.recognize(c);
      const text = clean(data.text);
      if (text.length >= 1 && text.length <= 12 && data.confidence >= 15) reads.push({ text, conf: data.confidence / 100, how: `${j.how} ${j.rot}°` });
    } catch (e) { /* 한 장 실패는 무시 */ }
  }
  // 같은 글자는 신뢰도 높은 것 하나로, 여러 번 읽히면 가산
  const by = new Map();
  for (const r of reads) {
    const cur = by.get(r.text);
    if (!cur) by.set(r.text, { ...r, n: 1 });
    else { cur.n++; if (r.conf > cur.conf) { cur.conf = r.conf; cur.how = r.how; } }
  }
  return [...by.values()]
    .map((r) => ({ text: r.text, conf: Math.min(0.95, r.conf * (1 + 0.1 * (r.n - 1)) * (r.text.length === 1 ? 0.6 : 1)), how: r.how }))
    .sort((a, b) => b.conf - a.conf)
    .slice(0, 4);
}
