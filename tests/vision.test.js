// 영상 엔진 회귀 테스트:  node tests/vision.test.js
// 모양·색·비율이 사진 속 크기(거리)와 기울기에 상관없이 같게 나오는지 본다.
'use strict';
const V = require('../vision.js');
const { make } = require('./synth.js');

const WHITE = [238, 238, 234], YELLOW = [236, 206, 70], PINK = [236, 160, 182], ORANGE = [234, 140, 60];
const BLUE = [60, 104, 196], RED = [196, 50, 50], BROWN = [140, 92, 56], GREEN = [52, 150, 80];

// [이름, 모양, 장축, 단축, 색, 기대 모양(들), 기대 색, 두번째 색]
const CASES = [
  ['흰 원형', 'circle', 1, 1, WHITE, ['원형'], '하양'],
  ['노랑 타원', 'ellipse', 1.6, 1, YELLOW, ['타원형'], '노랑'],
  ['분홍 장방형 정제', 'oblong', 1.9, 1, PINK, ['장방형'], '분홍'],
  ['캡슐 빨강/노랑', 'capsule', 2.6, 1, RED, ['장방형'], '빨강', YELLOW],
  ['주황 삼각형', 'poly-3', 1, 1, ORANGE, ['삼각형'], '주황'],
  ['파랑 육각형', 'poly-6', 1, 1, BLUE, ['육각형'], '파랑'],
  ['흰 팔각형', 'poly-8', 1, 1, WHITE, ['팔각형', '원형'], '하양'],
  ['초록 오각형', 'poly-5', 1, 1, GREEN, ['오각형'], '초록'],
  ['갈색 마름모', 'rhombus', 1.5, 1, BROWN, ['마름모형'], '갈색'],
  ['노랑 반원형', 'semi', 2, 1, YELLOW, ['반원형'], '노랑'],
  ['흰 사각형', 'square', 1, 1, WHITE, ['사각형', '마름모형'], '하양'],
];

let fail = 0, total = 0;
const rows = [];
for (const [name, type, lr, sr, color, expShape, expColor, color2] of CASES) {
  for (const [size, angle, bg] of [[110, 0.3, [52, 54, 60]], [60, 1.2, [40, 42, 48]], [170, -0.7, [205, 205, 200]]]) {
    // 흰 약은 흰 바닥에서 빼고(안내 대상), 어두운 약은 어두운 바닥에서 뺀다
    if (bg[0] > 150 && color[0] > 200 && color[1] > 200) continue;
    const long = size * lr / Math.max(lr, sr) * (lr >= sr ? 1 : 1), short = long * sr / lr;
    const img = make(480, 360, { bg, objs: [{ type, cx: 240 + 10, cy: 180 - 6, long, short, angle, color, color2 }], seed: size });
    const r = V.analyze(img, { crop: true });
    total++;
    const p = r.pill;
    const okShape = p && expShape.includes(p.shapeTop);
    const okColor = p && p.colorTop[0] === expColor && (!color2 || p.colorTop[1] === '노랑');
    // 정다각형은 축 방향이 정해지지 않아 비율이 원래 애매하다(식약처 장·단축도 마찬가지)
    const tol = /poly/.test(type) ? 0.15 : 0.08;
    const okAspect = p && Math.abs(p.aspect - lr / sr) / (lr / sr) < tol;
    const ok = okShape && okColor && okAspect;
    if (!ok) fail++;
    rows.push(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(14)} size=${String(size).padStart(3)} bg=${bg[0]} → ${p ? `${p.shapeTop}(${(p.shape[p.shapeTop] * 100).toFixed(0)}%) ${p.colorTop.join('/')} 비율 ${p.aspect.toFixed(2)}(기대 ${(lr / sr).toFixed(2)}) asym=${p.asymV} h=${p.harmonics.slice(1).map((v) => v.toFixed(3)).join(',')}` : r.reason}`);
  }
}

// 동전 기준 크기: 100원(24mm) 옆에 장축 11mm 약
{
  total++;
  const pxPerMm = 6.2;
  const img = make(640, 480, {
    bg: [46, 48, 54],
    objs: [
      { type: 'circle', cx: 200, cy: 240, long: 24 * pxPerMm, short: 24 * pxPerMm, angle: 0, color: [190, 190, 186] },
      { type: 'oblong', cx: 450, cy: 230, long: 11 * pxPerMm, short: 5.5 * pxPerMm, angle: 0.5, color: WHITE },
    ],
  });
  const r = V.analyze(img, {});
  const mm = r.coin ? (r.pill.long / r.coin.long) * 24 : 0;
  const ok = r.coin && Math.abs(mm - 11) < 0.6;
  if (!ok) fail++;
  rows.push(`${ok ? 'OK  ' : 'FAIL'} 동전 기준 크기      → 동전 ${r.coin ? '찾음' : '못 찾음'}, 약 장축 ${mm.toFixed(2)}mm (기대 11)`);
}

// 빈 바닥: 아무것도 찾으면 안 됨
{
  total++;
  const r = V.analyze(make(480, 360, { bg: [70, 72, 78], objs: [] }), {});
  const ok = !r.ok;
  if (!ok) fail++;
  rows.push(`${ok ? 'OK  ' : 'FAIL'} 빈 바닥             → ${r.ok ? '잘못 찾음 ' + r.pill.shapeTop : '없음'}`);
}

console.log(rows.join('\n'));
console.log(`\n${total - fail}/${total} 통과`);
process.exit(fail ? 1 : 0);
