// 사진 한 장을 지정한 위치(seed)의 물체로 분석: node tests/seedtest.js samples/x.png 0.42 0.50
'use strict';
const { execFileSync } = require('child_process');
const V = require('../vision.js');
const [f, sx, sy] = [process.argv[2], +process.argv[3], +process.argv[4]];
const raw = execFileSync('python', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())`, f], { maxBuffer: 1 << 28 });
const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
const r = V.analyze({ width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) }, { crop: true, seed: sx ? { x: sx, y: sy } : null });
if (!r.ok) { console.log('없음', r.reason); process.exit(); }
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + Math.round(v * 100)).join(' ');
console.log('th', r.th.toFixed(1), 'objects', r.objects.length, r.objects.map((o) => `[${o.cx | 0},${o.cy | 0} ${o.long.toFixed(0)}x${o.short.toFixed(0)} ${o.shapeTop}]`).join(' '));
const p = r.pill;
console.log({ shape: top(p.shape), aspect: p.aspect.toFixed(2), long: p.long.toFixed(0), short: p.short.toFixed(0), solidity: (p.area / (Math.PI / 4 * p.long * p.short)).toFixed(3), h: p.harmonics.slice(1).join(','), asymV: p.asymV, color: top(p.colors[0].probs) });
