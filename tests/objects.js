// 사진 한 장의 모든 후보 물체와 선택 결과: node tests/objects.js samples/x.png
'use strict';
const { execFileSync } = require('child_process');
const V = require('../vision.js');
const raw = execFileSync('python', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())`, process.argv[2]], { maxBuffer: 1 << 28 });
const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
const r = V.analyze({ width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) }, { crop: true });
console.log('크기', w, h, 'th', r.th.toFixed(1), 'bg', r.bg.lab.map((v) => v.toFixed(0)).join(','));
for (const o of r.objects) console.log(o === r.pill ? '★약 ' : o === r.coin ? '◆기준' : '    ', `중심(${(o.cx / w).toFixed(2)},${(o.cy / h).toFixed(2)}) ${o.long.toFixed(0)}x${o.short.toFixed(0)} 면적${(o.area / (w * h) * 100).toFixed(1)}% ${o.shapeTop} 색${o.colorTop.join('/')} lab(${o.colors[0].lab.map((v) => v.toFixed(0)).join(',')}) cut=${o.cut} kind=${o.kind || ''}`);
