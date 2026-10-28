// 실제 사진·합성 색의 색 확률 비교: node tests/colors.js
'use strict';
const V = require('../vision.js');
const { execFileSync } = require('child_process');
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + Math.round(v * 100)).join(' ');
for (const f of ['capsule.png', 'finger.png', 'pac-palm.png', 'pac-full.png', 'kla.png', 'plain.png', 'three.png']) {
  const raw = execFileSync('python', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())`, 'samples/' + f], { maxBuffer: 1 << 28 });
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  const r = V.analyze({ width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) }, {});
  const p = r.pill; console.log(f.padEnd(14), 'lab', p.colors[0].lab.map((v) => v.toFixed(0)).join(','), '→', top(p.colors[0].probs));
}
// 합성: 연한 파랑 / 진짜 파랑 / 하늘색 약은 보정되면 안 됨
for (const [n, rgb] of [['흰(차가운 조명)', [225, 232, 242]], ['흰(따뜻한 조명)', [244, 238, 218]], ['진짜 연한 하늘색', [170, 205, 240]], ['파랑', [60, 110, 200]], ['연한 노랑', [246, 232, 150]], ['연한 분홍', [244, 204, 210]]]) console.log(n.padEnd(14), 'lab', V.rgb2lab(...rgb).map((v) => v.toFixed(0)).join(','), '→', top(V.colorProbs(V.rgb2lab(...rgb))));
