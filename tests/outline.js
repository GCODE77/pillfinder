// 분석한 윤곽을 사진 위에 그려 PNG로 저장: node tests/outline.js in.png out.png x y
'use strict';
const { execFileSync } = require('child_process');
const V = require('../vision.js');
const [f, out, sx, sy] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5]];
const raw = execFileSync('python', ['-c', `import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())`, f], { maxBuffer: 1 << 28 });
const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
const r = V.analyze({ width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) }, { crop: true, seed: { x: sx, y: sy } });
const pts = r.pill.outline.map(([x, y]) => [Math.round(x), Math.round(y)]);
execFileSync('python', ['-c', `import sys,json;from PIL import Image,ImageDraw;im=Image.open(sys.argv[1]).convert('RGB');d=ImageDraw.Draw(im);p=json.loads(sys.argv[3]);d.line([tuple(q) for q in p]+[tuple(p[0])],fill=(255,0,0),width=2);im.save(sys.argv[2])`, f, out, JSON.stringify(pts)]);
console.log('saved', out, pts.length);
