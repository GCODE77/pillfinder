// 필파인더 영상 분석 엔진 — 사진 한 장에서 약(과 기준 동전)의 윤곽·모양·색·비율을 뽑는다.
// Web Worker(vision-worker.js)와 Node 테스트(tests/)에서 같이 쓴다. DOM을 쓰지 않는다.
//
// 거리마다 사진 속 크기가 달라지므로 식별에는 거리와 무관한 값만 쓴다:
//   모양(윤곽을 단위원으로 정규화한 뒤 반지름 곡선의 고조파), 장단축 비율, 색, 각인.
// 실제 크기(mm)는 같은 평면에 놓인 동전이 보일 때만 동전 지름을 기준으로 계산한다.
(function (root) {
  'use strict';

  const SHAPES = ['원형', '타원형', '장방형', '반원형', '삼각형', '사각형', '마름모형', '오각형', '육각형', '팔각형', '기타'];

  // 식약처 COLOR_CLASS 분류와 대표색(sRGB). 실제 약 사진(낱알 이미지)의 평균색을 보고 잡은 값.
  const COLOR_PROTOS = [
    ['하양', [236, 236, 232]], ['하양', [222, 224, 226]],
    ['노랑', [238, 214, 92]], ['노랑', [246, 232, 150]],
    ['주황', [238, 150, 70]], ['주황', [242, 186, 120]],
    ['분홍', [238, 168, 186]], ['분홍', [244, 204, 210]],
    ['빨강', [196, 48, 52]], ['빨강', [220, 90, 80]],
    ['갈색', [140, 92, 56]], ['갈색', [176, 128, 86]],
    ['연두', [176, 210, 100]], ['연두', [206, 226, 150]],
    ['초록', [48, 148, 78]], ['초록', [110, 176, 120]],
    ['청록', [40, 160, 160]], ['청록', [120, 196, 190]],
    ['파랑', [60, 110, 200]], ['파랑', [140, 178, 228]],
    ['남색', [36, 46, 110]],
    ['자주', [150, 46, 112]], ['자주', [196, 110, 160]],
    ['보라', [124, 86, 170]], ['보라', [172, 150, 210]],
    ['회색', [150, 150, 150]], ['회색', [110, 112, 114]],
    ['검정', [40, 40, 42]],
  ];
  const COLORS = [...new Set(COLOR_PROTOS.map((c) => c[0]))];
  // 식약처 낱알식별 25,461품목의 색 분포(2026-10). 애매할 때 드문 색(청록·자주 등)으로 쏠리지 않게 약하게 반영
  const COLOR_PRIOR = { 하양: 9470, 분홍: 3720, 노랑: 3210, 주황: 2590, 갈색: 1480, 파랑: 1440, 연두: 1270, 초록: 950, 빨강: 680, 회색: 200, 보라: 130, 청록: 120, 자주: 60, 검정: 55, 남색: 50 };

  // ---------- 색 공간 ----------
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  function rgb2lab(r, g, b) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const fx = fLab(x), fy = fLab(y), fz = fLab(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  const PROTO_LAB = COLOR_PROTOS.map(([n, c]) => [n, rgb2lab(c[0], c[1], c[2])]);

  function toLab(img) {
    const n = img.width * img.height, d = img.data;
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = rgb2lab(d[j], d[j + 1], d[j + 2]);
      L[i] = v[0]; A[i] = v[1]; B[i] = v[2];
    }
    return { L, A, B };
  }

  // 색 분류 확률. 밝기 차는 조명 탓이 커서 가볍게, 색상·채도 차는 무겁게 본다.
  function colorProbs(lab0) {
    let [L, a, b] = lab0;
    // 밝고 채도가 낮은 약은 폰 자동 화이트밸런스·차갑거나 따뜻한 조명 때문에 흰색이 푸르거나 누렇게 찍히기 쉽다.
    // 채도가 낮을수록(진짜 하늘색·연노랑 약은 채도가 높다) 색 쏠림으로 보고 중립 쪽으로 당긴다. 푸른/초록 쏠림이 더 흔해서 더 세게
    if (L > 80) {
      const C0 = Math.hypot(a, b);
      const cool = b < 0 || (a < -6 && b < 20);          // 푸르거나 초록빛 쏠림(가장 흔함)
      const warm = !cool && b >= 0 && a < 6;              // 누런 쏠림(분홍처럼 a가 큰 색은 건드리지 않는다)
      const k = cool ? 0.8 : warm ? 0.4 : 0;
      if (k) { const s = 1 - k * Math.exp(-((C0 / 28) ** 2)); a *= s; b *= s; }
    }
    const best = {};
    // 무채색(하양·회색·검정)은 밝기로만 갈리므로 채도가 낮을수록 밝기 차를 무겁게 본다
    const wL = 0.3 + 0.7 * Math.exp(-Math.hypot(a, b) / 10);
    for (const [name, p] of PROTO_LAB) {
      const d2 = wL * (L - p[0]) ** 2 + (a - p[1]) ** 2 + (b - p[2]) ** 2;
      if (best[name] === undefined || d2 < best[name]) best[name] = d2;
    }
    const sigma2 = 2 * 10 * 10;
    let sum = 0;
    const out = {};
    // 밝고 옅은 색(L>78, 채도<32)은 조명·화이트밸런스로 색이 틀어지기 쉬워, 식약처에서 훨씬 흔한 색(하양)에 사전 비중을 더 준다
    const pale = L > 78 && Math.hypot(a, b) < 32;
    for (const k of COLORS) { out[k] = Math.exp(-best[k] / sigma2) * Math.pow((COLOR_PRIOR[k] || 50) / 9470, pale ? 0.4 : 0.25); sum += out[k]; }
    // 아주 밝고 옅은 색(L>80, 채도<32)은 조명에 따라 하양으로 분류된 약일 수 있다
    const C = Math.hypot(a, b);
    if (L > 80 && C < 32) { const add = sum * 0.6 * Math.exp(-C / 14) * Math.min(1, (L - 80) / 8); out['하양'] += add; sum += add; }
    for (const k of COLORS) out[k] /= sum || 1;
    return out;
  }
  const topKey = (o) => Object.keys(o).reduce((a, b) => (o[a] >= o[b] ? a : b));

  // ---------- 작은 도구 ----------
  function kmeans(pts, k, iters = 12) {
    // pts: [[L,a,b],...]
    if (pts.length <= k) return pts.map((p) => ({ c: p.slice(), n: 1 }));
    const cs = [pts[0].slice()];
    while (cs.length < k) {
      // k-means++ 비슷하게: 가장 먼 점
      let bi = 0, bd = -1;
      for (let i = 0; i < pts.length; i += Math.max(1, (pts.length / 400) | 0)) {
        let m = Infinity;
        for (const c of cs) m = Math.min(m, d2(pts[i], c));
        if (m > bd) { bd = m; bi = i; }
      }
      cs.push(pts[bi].slice());
    }
    let asg = new Int32Array(pts.length);
    for (let it = 0; it < iters; it++) {
      const sum = cs.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < pts.length; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < cs.length; j++) { const d = d2(pts[i], cs[j]); if (d < bd) { bd = d; bj = j; } }
        asg[i] = bj;
        const s = sum[bj]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++;
      }
      for (let j = 0; j < cs.length; j++) if (sum[j][3]) cs[j] = [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]];
    }
    const n = cs.map(() => 0);
    for (let i = 0; i < pts.length; i++) n[asg[i]]++;
    return cs.map((c, j) => ({ c, n: n[j], asg }));
  }
  function d2(p, q) { return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; }

  function otsu(vals, maxV) {
    const bins = 128, h = new Float64Array(bins);
    for (let i = 0; i < vals.length; i++) h[Math.min(bins - 1, (vals[i] / maxV * bins) | 0)]++;
    let total = vals.length, sum = 0;
    for (let i = 0; i < bins; i++) sum += i * h[i];
    let sB = 0, wB = 0, best = 0, th = 0;
    for (let i = 0; i < bins; i++) {
      wB += h[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += i * h[i];
      const mB = sB / wB, mF = (sum - sB) / wF;
      const v = wB * wF * (mB - mF) ** 2;
      if (v > best) { best = v; th = i; }
    }
    return (th + 0.5) / bins * maxV;
  }

  function erode(m, W, H) {
    const o = new Uint8Array(m.length);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; o[i] = m[i] & m[i - 1] & m[i + 1] & m[i - W] & m[i + W];
    }
    return o;
  }
  function dilate(m, W, H) {
    const o = new Uint8Array(m.length);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; o[i] = m[i] | m[i - 1] | m[i + 1] | m[i - W] | m[i + W];
    }
    return o;
  }
  const rep = (f, m, W, H, n) => { for (let i = 0; i < n; i++) m = f(m, W, H); return m; };

  // 테두리와 이어지지 않은 구멍(각인 글자, 반사)을 메운다
  function fillHoles(m, W, H) {
    const out = new Uint8Array(m.length);
    const st = [];
    const push = (i) => { if (!m[i] && !out[i]) { out[i] = 1; st.push(i); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
      if (y > 0) push(i - W); if (y < H - 1) push(i + W);
    }
    for (let i = 0; i < m.length; i++) out[i] = out[i] ? 0 : 1;
    return out;
  }

  function label(m, W, H) {
    const lab = new Int32Array(m.length);
    const comps = [];
    const st = [];
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || lab[s]) continue;
      const id = comps.length + 1;
      const c = { id, area: 0, sx: 0, sy: 0, x0: W, y0: H, x1: 0, y1: 0, edge: 0, start: s };
      lab[s] = id; st.push(s);
      while (st.length) {
        const i = st.pop(), x = i % W, y = (i / W) | 0;
        c.area++; c.sx += x; c.sy += y;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.edge++;
        if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = id; st.push(i - 1); }
        if (x < W - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = id; st.push(i + 1); }
        if (y > 0 && m[i - W] && !lab[i - W]) { lab[i - W] = id; st.push(i - W); }
        if (y < H - 1 && m[i + W] && !lab[i + W]) { lab[i + W] = id; st.push(i + W); }
      }
      c.cx = c.sx / c.area; c.cy = c.sy / c.area;
      comps.push(c);
    }
    return { lab, comps };
  }

  // 무어 이웃 추적으로 바깥 윤곽(시계 방향 점 목록)
  function traceContour(lab, id, W, H, start) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === id;
    const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
    let sx = start % W, sy = (start / W) | 0; // 가장 위·왼쪽 픽셀(라벨링 시작점)
    const pts = [[sx, sy]];
    let x = sx, y = sy, dir = 7;
    for (let guard = 0; guard < W * H * 4; guard++) {
      let found = false;
      for (let k = 0; k < 8; k++) {
        const d = (dir + 6 + k) % 8; // 왼쪽 뒤부터 시계 방향으로 훑기
        const nx = x + dx[d], ny = y + dy[d];
        if (inside(nx, ny)) { x = nx; y = ny; dir = d; found = true; break; }
      }
      if (!found || (x === sx && y === sy)) break;
      pts.push([x, y]);
    }
    return pts;
  }

  function simplify(pts, eps) {
    // 닫힌 곡선용 Douglas–Peucker (가장 먼 두 점에서 나눠 두 번)
    if (pts.length < 8) return pts.slice();
    let far = 0, fd = -1;
    for (let i = 1; i < pts.length; i++) {
      const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
      if (d > fd) { fd = d; far = i; }
    }
    const dp = (arr) => {
      if (arr.length < 3) return arr;
      const [a, b] = [arr[0], arr[arr.length - 1]];
      const vx = b[0] - a[0], vy = b[1] - a[1], len = Math.hypot(vx, vy) || 1;
      let mi = 0, md = -1;
      for (let i = 1; i < arr.length - 1; i++) {
        const d = Math.abs(vy * (arr[i][0] - a[0]) - vx * (arr[i][1] - a[1])) / len;
        if (d > md) { md = d; mi = i; }
      }
      if (md <= eps) return [a, b];
      const l = dp(arr.slice(0, mi + 1)), r = dp(arr.slice(mi));
      return l.slice(0, -1).concat(r);
    };
    const a = dp(pts.slice(0, far + 1));
    const b = dp(pts.slice(far).concat([pts[0]]));
    return a.slice(0, -1).concat(b.slice(0, -1));
  }

  // ---------- 모양 특징 ----------
  // 1) 2차 모멘트(PCA)로 축 방향  2) 윤곽을 축에 투영해 장·단축 길이
  // 3) 장·단축을 1로 맞춰 늘린 윤곽의 반지름 곡선 r(θ) → 고조파 크기 h[k]
  //    타원·캡슐을 늘리면 원·둥근 사각형이 되므로, 남는 고조파가 모서리 개수를 알려 준다.
  function shapeFeatures(maskPx, contour) {
    let mx = 0, my = 0;
    for (const [x, y] of maskPx) { mx += x; my += y; }
    mx /= maskPx.length; my /= maskPx.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of maskPx) { const u = x - mx, v = y - my; sxx += u * u; syy += v * v; sxy += u * v; }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    const uv = contour.map(([x, y]) => {
      const u = (x + 0.5 - mx) * ca + (y + 0.5 - my) * sa, v = -(x + 0.5 - mx) * sa + (y + 0.5 - my) * ca;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      return [u, v];
    });
    const long = u1 - u0 + 1, short = v1 - v0 + 1;
    // 단축 방향 비대칭(반원형·삼각형은 무게중심이 한쪽으로 치우친다)
    const asymV = Math.max(-v0, v1) / Math.max(0.5, Math.min(-v0, v1)) - 1;
    // 정규화 반지름 곡선 (64칸, 칸마다 최대 반지름)
    const N = 64, r = new Float64Array(N).fill(-1);
    const hu = long / 2, hv = short / 2;
    for (const [u, v] of uv) {
      const x = u / hu, y = v / hv;
      const k = ((Math.round((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) * N) % N) + N) % N;
      const rr = Math.hypot(x, y);
      if (rr > r[k]) r[k] = rr;
    }
    for (let k = 0; k < N; k++) if (r[k] < 0) { // 빈 칸은 이웃 평균
      let a = 1, b = 1;
      while (r[(k - a + N) % N] < 0 && a < N) a++;
      while (r[(k + b) % N] < 0 && b < N) b++;
      r[k] = (r[(k - a + N) % N] + r[(k + b) % N]) / 2;
    }
    let mean = 0;
    for (let k = 0; k < N; k++) mean += r[k];
    mean /= N;
    const h = [0], ph = [0];
    for (let m = 1; m <= 8; m++) {
      let re = 0, im = 0;
      for (let k = 0; k < N; k++) { const t = (2 * Math.PI * m * k) / N; re += (r[k] / mean) * Math.cos(t); im += (r[k] / mean) * Math.sin(t); }
      h.push((2 * Math.hypot(re, im)) / N);
      ph.push(Math.atan2(im, re));
    }
    // 4차 고조파의 위상: 꼭짓점이 축 위(0°)면 마름모, 대각선(45°)이면 사각·장방
    // r(θ)의 칸 0은 θ=-π. 꼭짓점 각 φ에서 cos(4(θ-φ)) 최대 → 위상 = 4(φ+π) mod 2π
    const p4 = ph[4];
    const diamond = Math.cos(p4) > 0 ? Math.cos(p4) : 0; // φ=0 → p4=0 → cos 1
    const corner45 = Math.cos(p4) < 0 ? -Math.cos(p4) : 0;
    return { cx: mx, cy: my, angle, long, short, aspect: long / Math.max(1, short), h, diamond, corner45, asymV };
  }

  function shapeProbs(f, areaPx) {
    // 해상도가 낮으면 픽셀 계단 때문에 고조파 바닥값이 올라간다
    // 실제 사진은 테두리가 거칠어 고조파 바닥값이 0.01~0.02까지 올라온다
    const noise = Math.max(0.008, Math.min(0.03, 0.6 / Math.sqrt(Math.max(areaPx, 1))));
    const z = (k, thr) => Math.max(0, (f.h[k] - noise) / thr);
    // 길쭉한 정도 0~1. 폰을 비스듬히 들면 원형 약도 1.1배 정도 길어 보이므로 1.15까지는 원형으로 본다
    const e = Math.min(1, Math.max(0, (f.aspect - 1.15) / 0.12));
    const z1 = z(1, 0.06), z3 = z(3, 0.07), z4 = z(4, 0.035), z5 = z(5, 0.035), z6 = z(6, 0.028);
    let z8 = z(8, 0.018);
    z8 = Math.max(0, z8 - 0.7 * z4); // 사각형의 2배음은 팔각형이 아님
    const z6f = Math.max(0, z6 - 0.6 * z3);
    const clamp = (t) => Math.min(1, Math.max(0, t));
    // 반원형: 길쭉하고 단축 방향으로 치우침(0.36 근처). 삼각형은 치우침이 더 크고(≈1) 길쭉하지 않다.
    const semi = e * clamp((f.asymV - 0.12) / 0.14) * (1 - clamp((f.asymV - 0.75) / 0.3));
    const corner = Math.min(1, Math.max(z3 * (1 - semi), z4 * (1 - semi), z5, z6f, z8, z1, semi));
    const smooth = 1 - corner;
    const raw = {
      원형: (1 - e) * smooth * 1.2,
      타원형: e * smooth * (1 - Math.min(1, z4)) * 1.1,
      장방형: e * (1 - semi) * (Math.min(1, z4) * (0.4 + f.corner45) + 0.25 * smooth),
      반원형: Math.max(Math.min(1, z1), semi) * 1.1,
      삼각형: Math.min(1, z3) * (1 - 0.8 * semi),
      사각형: (1 - e * 0.6) * Math.min(1, z4) * (0.3 + f.corner45),
      마름모형: Math.min(1, z4) * f.diamond,
      오각형: Math.min(1, z5) * (1 - e * 0.5),
      육각형: Math.min(1, z6f) * (1 - e * 0.3),
      팔각형: Math.min(1, z8) * (1 - e * 0.5),
      기타: 0.06,
    };
    let s = 0;
    for (const k of SHAPES) s += raw[k] * raw[k];
    const out = {};
    for (const k of SHAPES) out[k] = (raw[k] * raw[k]) / (s || 1);
    return out;
  }

  // ---------- 메인 ----------
  // img: {width,height,data:RGBA}, opts: {seed:{x,y} (0~1), crop:true(각인 판독용 잘라내기), coin:true}
  let TH_CAP = 40;
  function analyze(img, opts = {}) {
    if (opts.thCap) TH_CAP = opts.thCap;
    const W = img.width, H = img.height, n = W * H;
    const { L, A, B } = toLab(img);

    // 1) 바닥색: 사진 가장자리 띠에서 군집 3개
    const band = Math.max(2, Math.round(Math.min(W, H) * 0.04));
    const samples = [];
    const stepB = Math.max(1, Math.round(Math.sqrt((2 * band * (W + H)) / 1500)));
    for (let y = 0; y < H; y += stepB) for (let x = 0; x < W; x += stepB) {
      if (x >= band && x < W - band && y >= band && y < H - band) continue;
      const i = y * W + x; samples.push([L[i], A[i], B[i]]);
    }
    // 가장자리에 다른 약이 살짝 걸려 있어도 그 색을 바닥으로 배우지 않게, 주된 색(20% 이상)만 바닥으로
    const bgCl = kmeans(samples, 3).filter((c) => c.n >= samples.length * 0.2);
    const bgMain = bgCl.reduce((a, b) => (a.n >= b.n ? a : b));

    // 2) 바닥과의 색차 → 문턱(Otsu, 너무 낮거나 높지 않게)
    const dist = new Float32Array(n);
    let maxD = 1;
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (const c of bgCl) {
        // 그림자: 바닥과 색은 같고 조금(30 이내) 어두운 곳 → 밝기 차를 거의 안 본다. 검은 약처럼 아주 어두우면 그대로
        const dL = L[i] - c.c[0];
        const wL = dL < 0 && dL > -30 ? 0.12 : 0.6;
        const d = wL * dL * dL + (A[i] - c.c[1]) ** 2 + (B[i] - c.c[2]) ** 2;
        if (d < m) m = d;
      }
      dist[i] = Math.sqrt(m);
      if (dist[i] > maxD) maxD = dist[i];
    }
    // 진한 물건(포장지 등)이 문턱을 끌어올려 옅은 약이 묻히지 않게, 큰 차이는 40으로 눌러 Otsu
    const capped = new Float32Array(n);
    for (let i = 0; i < n; i++) capped[i] = Math.min(dist[i], 40);
    const th = Math.min(TH_CAP, Math.max(9, otsu(capped, 40)));
    let mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = dist[i] > th ? 1 : 0;
    const k = Math.max(1, Math.round(Math.min(W, H) / 320));
    mask = rep(dilate, rep(erode, mask, W, H, k), W, H, k); // 잡티 제거
    mask = rep(erode, rep(dilate, mask, W, H, k * 2), W, H, k * 2); // 틈 메우기
    mask = fillHoles(mask, W, H);

    let { lab, comps } = label(mask, W, H);
    const minArea = n * 0.0015;
    let cands = comps.filter((c) => c.area >= minArea && c.area < n * 0.85);

    // 2-1) 큰 진한 물체(검은 카드·손 등)가 Otsu 문턱을 끌어올려 옅은 흰 약이 묻히는 경우:
    //      큰 물체 둘레는 그대로 두고, 그 밖의 영역만 따로 구한 낮은 문턱으로 다시 찾는다
    if (th > 13 && opts.lowPass !== false) {
      const strongIds = new Set(comps.filter((c) => c.area >= n * 0.02 && c.area < n * 0.85).map((c) => c.id));
      if (strongIds.size) {
        let ex = new Uint8Array(n);
        for (let i = 0; i < n; i++) if (strongIds.has(lab[i])) ex[i] = 1;
        ex = rep(dilate, ex, W, H, Math.max(3, Math.round(Math.min(W, H) / 60)));
        const vals = [];
        for (let i = 0; i < n; i++) if (!ex[i]) vals.push(Math.min(dist[i], 24));
        const th2 = Math.max(9, Math.min(th * 0.75, otsu(Float32Array.from(vals), 24)));
        if (th2 < th * 0.85) {
          let m2 = new Uint8Array(n);
          for (let i = 0; i < n; i++) m2[i] = dist[i] > (ex[i] ? th : th2) ? 1 : 0;
          m2 = rep(dilate, rep(erode, m2, W, H, k), W, H, k);
          m2 = rep(erode, rep(dilate, m2, W, H, k * 2), W, H, k * 2);
          m2 = fillHoles(m2, W, H);
          const r2 = label(m2, W, H);
          const c2 = r2.comps.filter((c) => c.area >= minArea && c.area < n * 0.85);
          if (c2.length) { lab = r2.lab; comps = r2.comps; cands = c2; }
        }
      }
    }

    // 3) 색차로 못 찾으면(흰 약 + 흰 종이 등) 밝기 경계로 다시
    let usedEdge = false;
    if (!cands.length) {
      const g = new Float32Array(n);
      const vals = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W];
        g[i] = Math.hypot(gx, gy);
        if ((i & 7) === 0) vals.push(g[i]);
      }
      vals.sort((a, b) => a - b);
      const gt = Math.max(4, vals[(vals.length * 0.9) | 0] || 4);
      let em = new Uint8Array(n);
      for (let i = 0; i < n; i++) em[i] = g[i] > gt ? 1 : 0;
      em = rep(dilate, em, W, H, k * 2);
      em = fillHoles(em, W, H);
      em = rep(erode, em, W, H, k * 2);
      ({ lab, comps } = label(em, W, H));
      cands = comps.filter((c) => c.area >= minArea && c.area < n * 0.85);
      usedEdge = true;
    }
    if (!cands.length) return { ok: false, reason: 'none', W, H, th };

    // 4) 대상 고르기: 터치한 곳 > 화면 가운데 큰 것. 사진 밖으로 잘린 것은 감점.
    const diag = Math.hypot(W, H);
    // 경계 선명도: 약은 둘레가 또렷하고, 빛 반사 얼룩·그림자는 경계가 번져 있다(밝기 기울기 평균)
    const sharpOf = (c) => {
      const ct = traceContour(lab, c.id, W, H, c.start), st = Math.max(1, Math.floor(ct.length / 160));
      let s = 0, k = 0;
      for (let i = 0; i < ct.length; i += st) {
        const [x, y] = ct[i];
        if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) continue;
        const j = y * W + x;
        s += (Math.abs(L[j + 3] - L[j - 3]) + Math.abs(L[j + 3 * W] - L[j - 3 * W])) / 6; k++;
      }
      return k ? s / k : 0;
    };
    const sharpMap = new Map(cands.map((c) => [c.id, sharpOf(c)]));
    const maxSharp = Math.max(1, ...cands.filter((c) => c.area >= n * 0.003).map((c) => sharpMap.get(c.id)));
    const scoreOf = (c) => {
      const dc = Math.hypot(c.cx - W / 2, c.cy - H / 2) / diag;
      // 가장자리에 걸친 것(포장지·손가락·물건)은 크게 감점, 많이 걸칠수록 더
      const edgeFrac = c.edge / Math.max(1, (c.x1 - c.x0 + c.y1 - c.y0 + 2) * 2);
      const mg = Math.max(2, Math.min(W, H) * 0.015);
      const near = c.x0 <= mg || c.y0 <= mg || c.x1 >= W - 1 - mg || c.y1 >= H - 1 - mg;
      const cut = c.edge > 0 || near ? 0.15 * Math.max(0.1, 1 - edgeFrac * 4) : 1;
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      const elong = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      const shapeOk = elong > 3.5 ? 0.15 : 1;                 // 알약은 장단축비가 대개 3 이하
      // 가까이 찍으면 약이 화면의 절반을 넘기도 한다. 다만 가장자리에 걸치면서 큰 것은 바닥·손일 가능성
      const sizeOk = c.area > n * 0.7 || (c.area > n * 0.3 && c.edge > 0) ? 0.2 : 1;
      const fill = c.area / (bw * bh);                         // 속이 빈 테두리·선 모양 제외
      // 번진 경계(반사 얼룩·그림자)는 크게 감점: 절대 선명도(약≈3~4, 얼룩≈1~2.3)와 같은 사진 안 가장 또렷한 후보 대비 비율 중 큰 쪽
      const sv = sharpMap.get(c.id);
      const sharp = Math.max(Math.max(0.1, Math.min(1, (sv - 2) / 2)), Math.max(0.03, Math.min(1, (sv / maxSharp) ** 3)));
      return c.area * (1 - dc) * cut * shapeOk * sizeOk * sharp * (fill < 0.45 ? 0.3 : 1);
    };
    let order = cands.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
    if (opts.seed) {
      const sx = opts.seed.x * W, sy = opts.seed.y * H;
      const hit = lab[Math.min(H - 1, Math.max(0, Math.round(sy))) * W + Math.min(W - 1, Math.max(0, Math.round(sx)))];
      const near = (c) => (c.id === hit ? -1 : Math.hypot(c.cx - sx, c.cy - sy));
      order = cands.slice().sort((a, b) => near(a) - near(b));
    }
    order = order.slice(0, 6);

    if (!usedEdge && opts.tighten !== false) for (const c of order) tighten(c, lab, dist, L, bgMain.c[0], W, H, th);
    const objects = order.map((c) => { const o = describe(c, lab, W, H, L, A, B, bgMain.c, opts); o.pre = scoreOf(c); o.sharp = +sharpOf(c).toFixed(2); return o; });
    // 약다운 정도: 볼록하고(손가락·그림자 조각은 0.7대) 모양이 어느 한 종류로 뚜렷한 것(조각은 0.4대). 터치로 고른 경우는 그대로 둔다
    if (!opts.seed) {
      const pillness = (o) => Math.max(0.1, Math.min(1, (o.convex - 0.8) / 0.15)) * Math.max(0.15, Math.min(1, (Math.max(...Object.values(o.shape)) - 0.35) / 0.35));
      objects.sort((a, b) => b.pre * pillness(b) - a.pre * pillness(a));
    }

    // 5) 기준 동전: 약보다 크고, 동그랗고, 은색/구리색인 것
    let coin = null, pill = objects[0];
    // 카드(신용·교통카드 85.6×54mm): 약보다 훨씬 크고, 모서리 둥근 직사각형이고, 가로세로비 1.58 안팎. 동전보다 우선(두 변으로 크기를 재서 더 정확)
    if (opts.coin !== false && objects.length >= 2) {
      const isCardLike = (o) => !o.cut && o.aspect > 1.45 && o.aspect < 1.75 && o.area / (o.long * o.short) > 0.9 && o.short > 0 && o.long / Math.max(1, Math.sqrt(W * H)) > 0.2;
      const cardC = objects.filter(isCardLike).sort((x, y) => y.area - x.area)[0];
      if (cardC) {
        const p = objects.filter((o) => o !== cardC)[0];   // 순위가 가장 높은(약다운) 나머지 물체
        if (p && cardC.area > p.area * 2.5 && !p.cut) { coin = Object.assign(cardC, { kind: 'card', mmLong: 85.6, mmShort: 53.98 }); pill = opts.seed ? (objects[0] === cardC ? p : objects[0]) : p; }
      }
    }
    if (!coin && opts.coin !== false && objects.length >= 2) {
      // 동전: 둥글고, 금속색(은색은 흰 약보다 어둡다, 구리색 10원은 갈색 계열)
      const isCoinLike = (o) => o.aspect < 1.08 && o.shape.원형 > 0.45 && o.chroma < 26 && o.colors[0].lab[0] < 80;
      const cc = objects.filter(isCoinLike).sort((a, b) => b.area - a.area)[0];
      if (cc) {
        const others = objects.filter((o) => o !== cc);
        const p = others[0];
        if (p && cc.area > p.area * 1.15 && p.area > cc.area * 0.08 && !p.cut) { coin = cc; pill = opts.seed ? (objects[0] === cc ? p : objects[0]) : p; }
      }
    }

    let crop = null;
    if (opts.crop && pill) crop = imprintCrop(pill, lab, W, H, L);
    // 분할선·각인 유무(면 특징): 고른 약만, 흐린 밝기에서
    if (pill && opts.face !== false) Object.assign(pill, faceFeatures(pill, L, W, H));
    if (opts.faceAll) for (const o of objects) Object.assign(o, faceFeatures(o, L, W, H));
    // 각인 지문: opts.desc=true면 모든 물체, 'pill'이면 고른 약만. opts.rots>1이면 회전별 지문 여러 장
    if (opts.desc) for (const o of opts.desc === 'pill' ? [pill] : objects) if (o) {
      // 표면 질감을 지우려고 약 크기에 비례해 흐린 밝기에서 잰다
      const rb = Math.max(1, Math.round(o.short / 45));
      const Lb = rb > 0 ? boxBlur(L, W, H, rb) : L;
      o.desc = descriptor(o, Lb, W, H, opts.rots || 1);
    }

    return {
      ok: true, W, H, th, usedEdge, bgs: bgCl.map((c) => ({ lab: c.c, n: c.n / samples.length })),
      bg: { lab: bgMain.c, chroma: Math.hypot(bgMain.c[1], bgMain.c[2]) },
      pill, coin, objects,
      contrast: pill ? pill.contrast : 0,
      crop,
    };
  }

  // 경계 조이기: 문턱(th)이 낮으면 약 둘레의 그림자·반사 조각이 같이 잡힌다.
  // 약 몸통이 바닥과 얼마나 다른지(하위 30% 값)의 절반이 진짜 경계이므로, 그보다 낮은 문턱으로 잡힌 곳만 다시 다듬는다.
  let TIGHT = 0.55;
  const SGN_MARGIN = -6; // 바닥보다 6 이상 어두운 조각만 그림자로 본다(약 자체의 그늘진 아랫면은 남김)
  function tighten(c, lab, dist, L, bgL, W, H, th) {
    const vals = [], dls = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.id) { vals.push(dist[y * W + x]); dls.push(L[y * W + x] - bgL); }
    if (vals.length < 80) return;
    vals.sort((a, b) => a - b); dls.sort((a, b) => a - b);
    if (vals[Math.floor(vals.length / 2)] > 32) return; // 대비가 큰 약은 경계가 이미 뚜렷하다(모서리를 깎지 않게 건너뜀)
    const t2 = TIGHT * vals[Math.floor(vals.length * 0.3)];
    // 몸통이 바닥보다 확실히 밝으면(어두우면) 바닥보다 어두운(밝은) 조각은 그림자·반사이므로 뗀다
    const medDL = dls[Math.floor(dls.length / 2)];
    const sgn = Math.abs(medDL) > 8 ? Math.sign(medDL) : 0;
    const useDist = t2 > th * 1.2;
    if (!useDist && !sgn) return;
    const pad = 2, bw = c.x1 - c.x0 + 1 + pad * 2, bh = c.y1 - c.y0 + 1 + pad * 2;
    let m = new Uint8Array(bw * bh);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * W + x;
      if (lab[i] === c.id && (!useDist || dist[i] > t2) && (!sgn || sgn * (L[i] - bgL) > SGN_MARGIN)) m[(y - c.y0 + pad) * bw + (x - c.x0 + pad)] = 1;
    }
    const k = Math.max(1, Math.round(Math.sqrt(c.area) / 60));
    m = rep(dilate, rep(erode, m, bw, bh, k), bw, bh, k);
    m = rep(erode, rep(dilate, m, bw, bh, k * 2), bw, bh, k * 2);
    m = fillHoles(m, bw, bh);
    const { lab: l2, comps } = label(m, bw, bh);
    const big = comps.sort((a, b) => b.area - a.area)[0];
    if (!big || big.area < c.area * 0.55) return; // 너무 많이 깎이면 원래대로
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const i = y * W + x;
      if (lab[i] === c.id) lab[i] = 0;
    }
    let area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, edge = 0, start = -1;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (l2[y * bw + x] !== big.id) continue;
      const X = x + c.x0 - pad, Y = y + c.y0 - pad;
      lab[Y * W + X] = c.id;
      if (start < 0) start = Y * W + X;
      area++; sx += X; sy += Y;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      if (X === 0 || Y === 0 || X === W - 1 || Y === H - 1) edge++;
    }
    Object.assign(c, { area, sx, sy, cx: sx / area, cy: sy / area, x0, y0, x1, y1, edge, start });
  }

  // 덩어리에 가늘게 붙은 것(그림자 꼬리, 손금, 바닥 무늬)을 열림 연산으로 떼고 가장 큰 몸통만 남긴다
  function cleanBlob(c, lab, W, H) {
    const pad = 2, bw = c.x1 - c.x0 + 1 + pad * 2, bh = c.y1 - c.y0 + 1 + pad * 2;
    let m = new Uint8Array(bw * bh);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.id) m[(y - c.y0 + pad) * bw + (x - c.x0 + pad)] = 1;
    const r = Math.max(1, Math.round(Math.sqrt(c.area) * 0.045));
    const op = rep(dilate, rep(erode, m, bw, bh, r), bw, bh, r);
    const { lab: l2, comps } = label(op, bw, bh);
    const big = comps.sort((a, b) => b.area - a.area)[0];
    if (!big || big.area < c.area * 0.6) return null; // 너무 많이 깎이면 원래대로
    const px = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (l2[y * bw + x] === big.id) px.push([x + c.x0 - pad, y + c.y0 - pad]);
    const contour = traceContour(l2, big.id, bw, bh, big.start).map(([x, y]) => [x + c.x0 - pad, y + c.y0 - pad]);
    return { px, contour };
  }
  function hull(pts) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // 볼록 껍질을 촘촘한 점으로(반지름 곡선 칸이 비지 않게)
  function densify(poly, step = 1) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  }

  // 볼록도: 면적 / 볼록 껍질 면적 (약·동전·카드는 0.9 이상, 손가락·그림자 조각은 낮다)
  function convexity(area, poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; }
    s = Math.abs(s) / 2;
    return s > 0 ? Math.min(1, +(area / s).toFixed(3)) : 0;
  }
  // 몸통 밝기 편차(L): 약은 한 색이라 작고, 피부·바닥 조각은 크다 (중심부 표본 기준)
  function stdL(pts) {
    if (pts.length < 10) return 0;
    let m = 0; for (const p of pts) m += p[0]; m /= pts.length;
    let v = 0; for (const p of pts) v += (p[0] - m) ** 2;
    return +Math.sqrt(v / pts.length).toFixed(2);
  }
  // 경질캡슐 판별 특징: 캡슐은 양 끝이 반원(끝에서 0.5b 안쪽의 폭이 b의 0.84~0.87배), 타원은 더 뾰족(≈0.6), 모서리 둥근 정제는 끝이 평평(≈1.0).
  // 장단축비 2 이상이면서 두 가지 색이면 가능성이 더 커진다. 결과는 0~1 (사용자가 제형을 직접 고르면 그 값이 우선)
  function capsuleFeature(poly, f, twoTone) {
    const ca = Math.cos(f.angle), sa = Math.sin(f.angle), a = f.long / 2, b = f.short / 2;
    if (!(a > 0 && b > 0) || a / b < 1.5) return { end: 0, p: 0.02 };
    const q = poly.map(([x, y]) => [(x - 0.5 - f.cx) * ca + (y - 0.5 - f.cy) * sa, -(x - 0.5 - f.cx) * sa + (y - 0.5 - f.cy) * ca]);
    const halfW = (u) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < q.length; i++) {
        const p0 = q[i], p1 = q[(i + 1) % q.length];
        if ((p0[0] - u) * (p1[0] - u) <= 0 && p0[0] !== p1[0]) { const s = (u - p0[0]) / (p1[0] - p0[0]), v = p0[1] + s * (p1[1] - p0[1]); if (v < lo) lo = v; if (v > hi) hi = v; }
      }
      return hi > lo ? (hi - lo) / 2 : 0;
    };
    const at = a - 0.5 * b;
    const end = (halfW(at) + halfW(-at)) / 2 / b;
    const asp = a / b;
    const endFit = Math.exp(-(((end - 0.84) / 0.08) ** 2) / 2);
    const aspOk = asp < 1.7 ? 0 : asp < 2.0 ? (asp - 1.7) / 0.3 : asp <= 4.2 ? 1 : 0.5;
    const z = -3.0 + 4.0 * endFit * aspOk + (twoTone ? 1.8 : 0);
    return { end: +end.toFixed(3), p: +(1 / (1 + Math.exp(-z))).toFixed(3) };
  }

  function describe(c, lab, W, H, L, A, B, bgLab, opts) {
    let px = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.id) px.push([x, y]);
    let contour = traceContour(lab, c.id, W, H, c.start);
    const cl = cleanBlob(c, lab, W, H);
    if (cl) { px = cl.px; contour = cl.contour; }
    // 약은 거의 볼록하다 → 모양은 볼록 껍질로 판정(그림자·각인 때문에 생긴 오목한 홈 무시)
    const shapeOutline = densify(hull(contour.map(([x, y]) => [x + 0.5, y + 0.5])));
    const f = shapeFeatures(px, shapeOutline.map(([x, y]) => [x - 0.5, y - 0.5]));
    const shape = shapeProbs(f, c.area);
    // 색: 가장자리 그림자·반사를 피하려고 중심부(축 70%)만
    const ca = Math.cos(f.angle), sa = Math.sin(f.angle);
    const pts = [];
    const stride = Math.max(1, Math.round(Math.sqrt(px.length / 3000)));
    for (let i = 0; i < px.length; i += stride) {
      const [x, y] = px[i];
      const u = (x - f.cx) * ca + (y - f.cy) * sa, v = -(x - f.cx) * sa + (y - f.cy) * ca;
      if ((u / (f.long * 0.35)) ** 2 + (v / (f.short * 0.35)) ** 2 > 1) continue;
      const j = y * W + x;
      pts.push([L[j], A[j], B[j], u]);
    }
    // 흰 종이·회색 바닥이면 그 색 틀어짐만큼 화이트밸런스 보정
    const bgC = Math.hypot(bgLab[1], bgLab[2]);
    // 손바닥·나무 같은 색 있는 바닥을 기준으로 삼으면 약 색이 반대로 틀어진다 → 거의 무채색일 때만
    const wb = bgC < 7 && bgLab[0] > 35 ? [bgLab[1] * 0.8, bgLab[2] * 0.8] : [0, 0];
    const lp = pts.map((p) => [p[0], p[1] - wb[0], p[2] - wb[1], p[3]]); // [L,a,b,장축 위치]
    // 반짝이는 반사(아주 밝고 무채색)는 약 전체가 그렇지 않은 한 뺀다
    const noGlare = lp.filter((p) => !(p[0] > 92 && Math.hypot(p[1], p[2]) < 6));
    const usePts = noGlare.length > lp.length * 0.5 ? noGlare : lp;
    const med = (arr, k) => { const s = arr.map((p) => p[k]).sort((a, b) => a - b); return s[(s.length / 2) | 0] ?? 0; };
    const labMed = [med(usePts, 0), med(usePts, 1), med(usePts, 2)];
    let colors = [{ lab: labMed, probs: colorProbs(labMed), part: 1 }];
    // 두 가지 색(캡슐 등): 두 군집이 충분히 다르고 장축 방향으로 갈라져 있을 때
    if (usePts.length > 40) {
      const km = kmeans(usePts, 2, 10); // 거리는 앞 3개(L,a,b)만 본다
      if (km.length === 2) {
        const [g0, g1] = km;
        const dE = Math.sqrt(0.6 * (g0.c[0] - g1.c[0]) ** 2 + (g0.c[1] - g1.c[1]) ** 2 + (g0.c[2] - g1.c[2]) ** 2);
        const frac = Math.min(g0.n, g1.n) / usePts.length;
        let u0 = 0, u1 = 0;
        for (let i = 0; i < usePts.length; i++) { if (g0.asg[i] === 0) u0 += usePts[i][3]; else u1 += usePts[i][3]; }
        u0 /= g0.n || 1; u1 /= g1.n || 1;
        const split = Math.abs(u0 - u1) / f.long;
        if (dE > 22 && frac > 0.22 && split > 0.18) {
          const first = u0 <= u1 ? g0 : g1, second = first === g0 ? g1 : g0;
          colors = [
            { lab: first.c, probs: colorProbs(first.c), part: first.n / usePts.length },
            { lab: second.c, probs: colorProbs(second.c), part: second.n / usePts.length },
          ];
        }
      }
    }
    // 바닥 대비(낮으면 안내 문구)
    const contrast = Math.sqrt(0.6 * (labMed[0] - bgLab[0]) ** 2 + (labMed[1] - bgLab[1]) ** 2 + (labMed[2] - bgLab[2]) ** 2);
    const outline = simplify(contour, Math.max(0.8, Math.sqrt(c.area) / 60));
    return {
      id: c.id, area: c.area, bbox: [c.x0, c.y0, c.x1 - c.x0 + 1, c.y1 - c.y0 + 1], cut: c.edge > 0,
      cx: f.cx, cy: f.cy, angle: f.angle, long: f.long, short: f.short, aspect: f.aspect,
      harmonics: f.h.map((v) => +v.toFixed(4)), asymV: +f.asymV.toFixed(3),
      shape, shapeTop: topKey(shape),
      colors, colorTop: colors.map((c2) => topKey(c2.probs)),
      chroma: Math.hypot(labMed[1], labMed[2]), contrast,
      capsule: capsuleFeature(shapeOutline, f, colors.length > 1),
      convex: convexity(px.length, shapeOutline), lstd: stdL(pts),
      outline,
    };
  }

  // ---------- 각인 판독용 잘라내기 ----------
  // 장축을 가로로 눕혀 잘라내고, 음각 각인(그림자)이 잘 보이게 국소 대비를 키운다.
  function imprintCrop(o, lab, W, H, L) {
    const targetH = 160;
    const s = targetH / Math.max(8, o.short * 1.08);
    const cw = Math.max(16, Math.round(o.long * 1.08 * s)), ch = Math.max(16, Math.round(o.short * 1.08 * s));
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    const g = new Float32Array(cw * ch), inm = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const u = (x - cw / 2) / s, v = (y - ch / 2) / s;
      const sx = o.cx + u * ca - v * sa, sy = o.cy + u * sa + v * ca;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
      const fx = sx - x0, fy = sy - y0, i = y0 * W + x0;
      g[y * cw + x] = L[i] * (1 - fx) * (1 - fy) + L[i + 1] * fx * (1 - fy) + L[i + W] * (1 - fx) * fy + L[i + W + 1] * fx * fy;
      // 약 안쪽(윤곽에서 조금 들어온 곳)만 쓴다 — 가장자리 그림자·반사가 글자로 읽히지 않게
      const ix = Math.round(sx), iy = Math.round(sy), mrg = Math.max(2, Math.round(o.short * 0.06));
      const inside = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && lab[yy * W + xx] === o.id;
      inm[y * cw + x] = inside(ix, iy) && inside(ix - mrg, iy) && inside(ix + mrg, iy) && inside(ix, iy - mrg) && inside(ix, iy + mrg) ? 1 : 0;
    }
    // 국소 대비: 약 안쪽만으로 흐린 값(정규화 합성곱)을 빼서 조명 기울기 제거
    const r = Math.max(4, Math.round(ch / 6));
    const gm = new Float32Array(cw * ch), mm = new Float32Array(cw * ch);
    for (let i = 0; i < gm.length; i++) { gm[i] = inm[i] ? g[i] : 0; mm[i] = inm[i]; }
    const bg = boxBlur(gm, cw, ch, r), bm = boxBlur(mm, cw, ch, r);
    const det = new Float32Array(cw * ch);
    const vals = [];
    for (let i = 0; i < det.length; i++) if (inm[i]) { det[i] = g[i] - bg[i] / Math.max(1e-3, bm[i]); vals.push(det[i]); }
    vals.sort((a, b) => a - b);
    // 각인(어두운 홈)이 검게, 바탕이 희게: 아래쪽 꼬리를 늘린다
    const lo = vals[(vals.length * 0.02) | 0] ?? -1, hi = vals[(vals.length * 0.6) | 0] ?? 1;
    const out = new Uint8ClampedArray(cw * ch);
    // 약 바깥은 흰색이 아니라 약 바탕 밝기로 채운다(테두리가 글자 모양으로 읽히지 않게)
    const detBg = Math.max(0, Math.min(255, ((0 - lo) / (hi - lo || 1)) * 255));
    for (let i = 0; i < det.length; i++) {
      out[i] = inm[i] ? Math.max(0, Math.min(255, ((det[i] - lo) / (hi - lo || 1)) * 255)) : detBg;
    }
    // 원래 밝기(인쇄 각인용)
    const raw = new Uint8ClampedArray(cw * ch);
    const gv = [];
    for (let i = 0; i < g.length; i++) if (inm[i]) gv.push(g[i]);
    gv.sort((a, b) => a - b);
    const glo = gv[(gv.length * 0.02) | 0] ?? 0, ghi = gv[(gv.length * 0.98) | 0] ?? 100;
    const gmed = gv[(gv.length * 0.5) | 0] ?? 50;
    const rawBg = Math.max(0, Math.min(255, ((gmed - glo) / (ghi - glo || 1)) * 255));
    for (let i = 0; i < g.length; i++) raw[i] = inm[i] ? Math.max(0, Math.min(255, ((g[i] - glo) / (ghi - glo || 1)) * 255)) : rawBg;
    // 음각 윤곽(그림자+밝은 테두리)은 글자 안이 바탕과 같아 OCR이 못 읽는다 →
    // 밝기 기울기가 큰 곳을 글자 획으로 보고, 닫힘 연산으로 획을 채운다.
    const gr = new Float32Array(cw * ch), gvals = [];
    for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x;
      if (!inm[i] || !inm[i - 1] || !inm[i + 1] || !inm[i - cw] || !inm[i + cw]) continue;
      const gx = g[i - cw + 1] + 2 * g[i + 1] + g[i + cw + 1] - g[i - cw - 1] - 2 * g[i - 1] - g[i + cw - 1];
      const gy = g[i + cw - 1] + 2 * g[i + cw] + g[i + cw + 1] - g[i - cw - 1] - 2 * g[i - cw] - g[i - cw + 1];
      gr[i] = Math.hypot(gx, gy); gvals.push(gr[i]);
    }
    gvals.sort((a, b) => a - b);
    const gth = Math.max(6, gvals[(gvals.length * 0.88) | 0] || 6);
    let st = new Uint8Array(cw * ch);
    for (let i = 0; i < st.length; i++) st[i] = gr[i] > gth ? 1 : 0;
    const kk = Math.max(1, Math.round(ch / 70));
    st = rep(erode, rep(dilate, st, cw, ch, kk * 2), cw, ch, kk * 2);
    const relief = new Uint8ClampedArray(cw * ch);
    for (let i = 0; i < st.length; i++) relief[i] = st[i] ? 0 : 255;
    // 글자 줄의 방향: 획 픽셀 분포의 주축(둥근 약은 글자가 아무 방향으로나 찍힌다)
    let n0 = 0, mx = 0, my = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (st[y * cw + x]) { n0++; mx += x; my += y; }
    let textAngle = 0, textElong = 1;
    if (n0 > 30) {
      mx /= n0; my /= n0;
      let sxx = 0, syy = 0, sxy = 0;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (st[y * cw + x]) { const u = x - mx, v = y - my; sxx += u * u; syy += v * v; sxy += u * v; }
      textAngle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const tr = sxx + syy, det2 = Math.sqrt(Math.max(0, (sxx - syy) ** 2 + 4 * sxy * sxy));
      textElong = Math.sqrt((tr + det2) / Math.max(1e-6, tr - det2));
    }
    return { w: cw, h: ch, detail: out, raw, relief, textAngle, textElong };
  }

  // ---------- 면 특징: 분할선, 각인 유무 ----------
  // 분할선 = 약 중심을 지나 지름 대부분을 가로지르는 곧은 홈. 각도마다 그 방향 선분 위 평균 밝기 단면을 만들고,
  // 가운데(±5%)에서 양옆(±12%)과 확 다른 좁은 골·마루가 있으면 분할선. 십자는 수직인 두 방향이 모두 강할 때.
  function faceFeatures(o, L, W, H) {
    const R = o.short / 2;
    const rb = Math.max(1, Math.round(R / 40));
    const x0 = Math.max(0, Math.floor(o.cx - o.long / 2 - 2)), y0 = Math.max(0, Math.floor(o.cy - o.long / 2 - 2));
    const x1 = Math.min(W - 1, Math.ceil(o.cx + o.long / 2 + 2)), y1 = Math.min(H - 1, Math.ceil(o.cy + o.long / 2 + 2));
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const sub = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) sub[y * bw + x] = L[(y + y0) * W + x + x0];
    const B = boxBlur(sub, bw, bh, rb);
    const at = (x, y) => {
      const xi = Math.round(x - x0), yi = Math.round(y - y0);
      return xi >= 0 && yi >= 0 && xi < bw && yi < bh ? B[yi * bw + xi] : NaN;
    };
    const ca0 = Math.cos(o.angle), sa0 = Math.sin(o.angle);
    // 단위원 좌표(u,v) → 사진 좌표 (장축 방향으로 늘림)
    const P = (u, v) => [o.cx + u * (o.long / 2) * ca0 - v * (o.short / 2) * sa0, o.cy + u * (o.long / 2) * sa0 + v * (o.short / 2) * ca0];
    const NOFF = 25, offs = Array.from({ length: NOFF }, (_, i) => -0.36 + (0.72 * i) / (NOFF - 1));
    let best = { s: 0, th: 0 }, perTh = [];
    for (let k = 0; k < 36; k++) {
      const th = (Math.PI * k) / 36, tx = Math.cos(th), ty = Math.sin(th), nx = -ty, ny = tx;
      const prof = offs.map((d) => {
        let sum = 0, c = 0;
        for (let t = -0.62; t <= 0.62; t += 0.04) {
          const u = d * nx + t * tx, v = d * ny + t * ty;
          if (u * u + v * v > 0.7) continue;
          const val = at(...P(u, v)); if (!Number.isNaN(val)) { sum += val; c++; }
        }
        return c ? sum / c : NaN;
      });
      const mid = (NOFF - 1) / 2;
      // 가운데 근처(±2칸)의 골/마루 세기 vs 단면 전체의 들쭉날쭉함
      let peak = 0;
      for (let i = mid - 2; i <= mid + 2; i++) {
        const side = (prof[i - 4] + prof[i + 4]) / 2;
        if (!Number.isNaN(side)) peak = Math.max(peak, Math.abs(prof[i] - side));
      }
      const diffs = [];
      for (let i = 1; i < NOFF; i++) if (!Number.isNaN(prof[i]) && !Number.isNaN(prof[i - 1])) diffs.push(Math.abs(prof[i] - prof[i - 1]));
      diffs.sort((a, b) => a - b);
      const noise = (diffs[(diffs.length / 2) | 0] || 0.3) + 0.25;
      const sc = peak / noise;
      perTh.push(sc);
      if (sc > best.s) best = { s: sc, th };
    }
    const kb = Math.round((best.th * 36) / Math.PI), kp = (kb + 18) % 36;
    const cross = Math.min(best.s, Math.max(perTh[kp], perTh[(kp + 1) % 36], perTh[(kp + 35) % 36]));
    // 각인 유무: 약 안쪽(r<0.65)의 세밀한 밝기 변화량(질감 흐림 후) / 바깥 띠
    let e = 0, c = 0;
    for (let v = -0.65; v <= 0.65; v += 0.05) for (let u = -0.65; u <= 0.65; u += 0.05) {
      if (u * u + v * v > 0.42) continue;
      const [x, y] = P(u, v), [x2, y2] = P(u + 0.05, v), [x3, y3] = P(u, v + 0.05);
      const a = at(x, y), b = at(x2, y2), d = at(x3, y3);
      if ([a, b, d].some(Number.isNaN)) continue;
      e += Math.abs(a - b) + Math.abs(a - d); c++;
    }
    return { lineScore: +best.s.toFixed(2), lineAngle: best.th, crossScore: +cross.toFixed(2), markEnergy: +(c ? e / c : 0).toFixed(3) };
  }

  // ---------- 각인 지문 ----------
  // 약을 장·단축 1로 편 단위원 위의 32×32 격자에서 밝기 기울기(새김 윤곽)를 잰다.
  // 크기·거리와 무관하고, 가장자리 띠(r>0.8)는 그림자·테두리라 뺀다. 평균 0, 분산 1로 정규화.
  const DN = 32;
  function descriptor(o, L, W, H, rots) {
    const out = [];
    const step = Math.max(1, o.short / 64);
    const gL = (x, y) => {
      const xi = Math.min(W - 2, Math.max(1, Math.round(x))), yi = Math.min(H - 2, Math.max(1, Math.round(y)));
      const s2 = Math.max(1, Math.round(step));
      const xa = Math.min(W - 1, xi + s2), xb = Math.max(0, xi - s2), ya = Math.min(H - 1, yi + s2), yb = Math.max(0, yi - s2);
      return Math.hypot(L[yi * W + xa] - L[yi * W + xb], L[ya * W + xi] - L[yb * W + xi]);
    };
    for (let k = 0; k < rots; k++) {
      const ang = o.angle + (2 * Math.PI * k) / rots;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const d = new Float32Array(DN * DN);
      let m = 0, cnt = 0;
      for (let gy = 0; gy < DN; gy++) for (let gx = 0; gx < DN; gx++) {
        const u = ((gx + 0.5) / DN) * 2 - 1, v = ((gy + 0.5) / DN) * 2 - 1;
        if (u * u + v * v > 0.64) continue;
        const pu = u * (o.long / 2), pv = v * (o.short / 2);
        const x = o.cx + pu * ca - pv * sa, y = o.cy + pu * sa + pv * ca;
        const val = gL(x, y);
        d[gy * DN + gx] = val; m += val; cnt++;
      }
      // 작은 위치 어긋남을 허용하도록 격자를 한 번 부드럽게
      const sm = new Float32Array(DN * DN);
      for (let gy = 0; gy < DN; gy++) for (let gx = 0; gx < DN; gx++) {
        let a = 0, c2 = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = gx + dx, Y = gy + dy;
          if (X >= 0 && Y >= 0 && X < DN && Y < DN) { a += d[Y * DN + X]; c2++; }
        }
        sm[gy * DN + gx] = a / c2;
      }
      m = 0;
      for (let gy = 0; gy < DN; gy++) for (let gx = 0; gx < DN; gx++) {
        const u = ((gx + 0.5) / DN) * 2 - 1, v = ((gy + 0.5) / DN) * 2 - 1;
        if (u * u + v * v > 0.64) { d[gy * DN + gx] = 0; continue; }
        d[gy * DN + gx] = sm[gy * DN + gx]; m += sm[gy * DN + gx];
      }
      m /= cnt || 1;
      let sd = 0;
      for (let gy = 0; gy < DN; gy++) for (let gx = 0; gx < DN; gx++) {
        const u = ((gx + 0.5) / DN) * 2 - 1, v = ((gy + 0.5) / DN) * 2 - 1;
        if (u * u + v * v > 0.64) continue;
        const i = gy * DN + gx; d[i] -= m; sd += d[i] * d[i];
      }
      sd = Math.sqrt(sd / (cnt || 1)) || 1;
      for (let i = 0; i < d.length; i++) d[i] /= sd;
      out.push(d);
    }
    return rots === 1 ? out[0] : out;
  }
  // 두 지문의 상관(-1~1). a가 회전별 배열이면 가장 잘 맞는 회전
  function descSim(a, b) {
    const one = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * b[i]; return s / x.length; };
    if (Array.isArray(a)) { let best = -1; for (const x of a) best = Math.max(best, one(x)); return best; }
    return one(a);
  }

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0, cnt = 0;
      for (let x = -r; x < w + r; x++) {
        if (x + r < w && x + r >= 0) { acc += src[y * w + x + r]; cnt++; }
        if (x - r - 1 >= 0 && x - r - 1 < w) { acc -= src[y * w + x - r - 1]; cnt--; }
        if (x >= 0 && x < w) tmp[y * w + x] = acc / cnt;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0, cnt = 0;
      for (let y = -r; y < h + r; y++) {
        if (y + r < h && y + r >= 0) { acc += tmp[(y + r) * w + x]; cnt++; }
        if (y - r - 1 >= 0 && y - r - 1 < h) { acc -= tmp[(y - r - 1) * w + x]; cnt--; }
        if (y >= 0 && y < h) out[y * w + x] = acc / cnt;
      }
    }
    return out;
  }

  const api = { analyze, colorProbs, rgb2lab, descSim, SHAPES, COLORS, DN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Vision = api;
})(typeof self !== 'undefined' ? self : this);
