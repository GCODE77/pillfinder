// 합성 약 사진 생성기 (테스트 전용). 조명 기울기·노이즈·그림자를 넣어 실제 사진처럼 만든다.
'use strict';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function regular(n, rot = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => [Math.cos(rot + (2 * Math.PI * i) / n), Math.sin(rot + (2 * Math.PI * i) / n)]);
}
function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// u,v: 약 중심 기준, 장축 방향 u (픽셀). 반환: 안이면 true
function insideFn(o) {
  const a = o.long / 2, b = o.short / 2;
  switch (o.type) {
    case 'circle': case 'ellipse': return (u, v) => (u / a) ** 2 + (v / b) ** 2 <= 1;
    case 'capsule': return (u, v) => { const cu = Math.max(-(a - b), Math.min(a - b, u)); return (u - cu) ** 2 + v * v <= b * b; };
    case 'oblong': { // 모서리 둥근 직사각형 정제
      const r = b * 0.45;
      return (u, v) => { const qu = Math.max(0, Math.abs(u) - (a - r)), qv = Math.max(0, Math.abs(v) - (b - r)); return Math.abs(u) <= a && Math.abs(v) <= b && qu * qu + qv * qv <= r * r; };
    }
    case 'rhombus': return (u, v) => Math.abs(u) / a + Math.abs(v) / b <= 1;
    case 'square': return (u, v) => Math.abs(u) <= a && Math.abs(v) <= b;
    case 'semi': return (u, v) => v >= -b / 2 && u * u + (v + b / 2) ** 2 <= a * a; // 지름이 장축
    default: { // poly-n
      const n = Number(o.type.split('-')[1]);
      const P = regular(n).map(([x, y]) => [x * a, y * a]);
      return (u, v) => inPoly(u, v, P);
    }
  }
}

function make(w, h, { bg = [60, 62, 68], objs = [], noise = 6, light = 0.18, seed = 7 } = {}) {
  const R = rng(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  const fns = objs.map((o) => ({ o, f: insideFn(o), ca: Math.cos(o.angle || 0), sa: Math.sin(o.angle || 0) }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const shade = 1 + light * ((x / w - 0.5) + 0.5 * (y / h - 0.5));
    let col = bg.map((c) => c * shade);
    // 그림자(오른쪽 아래)
    for (const { o, f, ca, sa } of fns) {
      const dx = x - o.cx - 3, dy = y - o.cy - 4;
      if (f(dx * ca + dy * sa, -dx * sa + dy * ca)) col = col.map((c) => c * 0.8);
    }
    for (const { o, f, ca, sa } of fns) {
      let cov = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const dx = x + ox - 0.5 - o.cx, dy = y + oy - 0.5 - o.cy;
        if (f(dx * ca + dy * sa, -dx * sa + dy * ca)) cov += 0.25;
      }
      if (!cov) continue;
      const dx = x - o.cx, dy = y - o.cy, u = dx * ca + dy * sa;
      const c0 = o.color2 && u > 0 ? o.color2 : o.color;
      // 약 위 입체감: 가장자리로 갈수록 살짝 어둡게
      const rr = Math.min(1, Math.hypot(dx, dy) / (o.long / 2));
      const pc = c0.map((c) => c * shade * (1 - 0.12 * rr * rr));
      col = col.map((c, i) => c * (1 - cov) + pc[i] * cov);
    }
    const j = (y * w + x) * 4;
    for (let i = 0; i < 3; i++) data[j + i] = col[i] + (R() - 0.5) * 2 * noise;
    data[j + 3] = 255;
  }
  return { width: w, height: h, data };
}

module.exports = { make };
