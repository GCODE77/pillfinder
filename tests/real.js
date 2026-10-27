// 실제 사진 한 장 분석: node tests/real.js samples/xxx.png  (PNG → RGBA는 python PIL로)
'use strict';
const { execFileSync } = require('child_process');
const V = require('../vision.js');
const f = process.argv[2];
const raw = execFileSync('python', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())`, f], { maxBuffer: 1 << 28 });
const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
const r = V.analyze({ width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) }, { crop: true });
if (!r.ok) { console.log('없음', r.reason); process.exit(); }
const p = r.pill;
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + Math.round(v * 100)).join(' ');
console.log({ size: [w, h], th: r.th.toFixed(1), edge: r.usedEdge, bg: r.bg.lab.map((v) => v.toFixed(0)).join(','), objects: r.objects.length,
  shape: top(p.shape), aspect: p.aspect.toFixed(3), long: p.long.toFixed(1), short: p.short.toFixed(1), area: p.area,
  solidity: (p.area / (Math.PI / 4 * p.long * p.short)).toFixed(3), h: p.harmonics.slice(1).join(','), asym: p.asymV,
  color: top(p.colors[0].probs), lab: p.colors[0].lab.map((v) => v.toFixed(1)).join(','), cut: p.cut });
