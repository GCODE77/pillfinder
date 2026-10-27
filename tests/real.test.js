// 실제 사진 회귀 테스트:  node tests/real.test.js   (samples/는 저장소에 안 올림 — 없으면 건너뜀)
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const V = require('../vision.js');
const load = (f) => {
  const raw = execFileSync('python', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())`, f], { maxBuffer: 1 << 28 });
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  return { width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) };
};
// [파일, 터치 위치(없으면 자동), 기대 모양, 기대 색]  — 사용자가 알려 준 정답: 모두 흰색 원형
const CASES = [
  ['pac-palm.png', null, '원형', '하양'], ['pac-full.png', null, '원형', '하양'],
  ['kla.png', null, '원형', '하양'], ['plain.png', null, '원형', '하양'],
  ['three.png', { x: 0.35, y: 0.27 }, '원형', '하양'], ['three.png', { x: 0.71, y: 0.48 }, '원형', '하양'], ['three.png', { x: 0.34, y: 0.78 }, '원형', '하양'],
];
let fail = 0, run = 0;
for (const [f, seed, shape, color] of CASES) {
  const p = path.join(__dirname, '..', 'samples', f);
  if (!fs.existsSync(p)) { console.log('건너뜀', f); continue; }
  run++;
  const r = V.analyze(load(p), { seed });
  const o = r.pill, ok = o && o.shapeTop === shape && o.colorTop[0] === color;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${f}${seed ? ` 터치(${seed.x},${seed.y})` : ''} → ${o ? `${o.shapeTop} ${o.colorTop.join('/')} 비율 ${o.aspect.toFixed(2)} 중심 ${(o.cx / r.W).toFixed(2)},${(o.cy / r.H).toFixed(2)}` : r.reason}`);
}
console.log(`${run - fail}/${run} 통과`);
process.exit(fail ? 1 : 0);
