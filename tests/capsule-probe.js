// 합성 사진·실제 사진에서 경질캡슐 가능성(capsule.p)을 본다
'use strict';
const V = require('../vision.js'), { make } = require('./synth.js');
const WHITE = [235, 235, 230];
const cases = [
  ['캡슐 빨강/노랑 2.6', { type: 'capsule', long: 130, short: 50, color: [200, 50, 50], color2: [230, 200, 60] }],
  ['캡슐 흰색 한 색 2.8', { type: 'capsule', long: 140, short: 50, color: WHITE }],
  ['캡슐 한 색 3.2(파랑)', { type: 'capsule', long: 160, short: 50, color: [60, 90, 200] }],
  ['장방형 정제 1.9', { type: 'oblong', long: 95, short: 50, color: [240, 150, 170] }],
  ['장방형 정제 2.6', { type: 'oblong', long: 130, short: 50, color: [240, 150, 170] }],
  ['타원 정제 1.6', { type: 'ellipse', long: 100, short: 62, color: [235, 215, 90] }],
  ['타원 2.4(연질캡슐 모양)', { type: 'ellipse', long: 130, short: 54, color: [235, 215, 90] }],
  ['원형 정제', { type: 'circle', long: 80, short: 80, color: WHITE }],
];
for (const [name, o] of cases) {
  const img = make(640, 480, { bg: [46, 48, 54], objs: [{ cx: 320, cy: 240, angle: 0.3, ...o }] });
  const r = V.analyze(img, {});
  const p = r.pill;
  console.log(name.padEnd(22), '→', p.shapeTop, 'aspect', p.aspect.toFixed(2), 'end', p.capsule.end, 'p', p.capsule.p, '색', p.colorTop.join('/'));
}
