// 화면 테스트용 가짜 데이터(tests/demo/) 생성:  node tests/make-demo.js
// 실제 약이 아님 — 이름은 모두 "데모"로 시작한다. index.html?demo 로 열면 이 데이터를 쓴다.
'use strict';
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'demo');
fs.mkdirSync(path.join(out, 'details'), { recursive: true });
const shapes = ['원형', '타원형', '장방형', '반원형', '삼각형', '사각형', '마름모형', '오각형', '육각형', '팔각형'];
const colors = ['하양', '노랑', '주황', '분홍', '빨강', '갈색', '연두', '초록', '파랑', '보라'];
let seed = 3; const R = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(R() * a.length)];
const pills = [];
for (let i = 0; i < 400; i++) {
  const sh = pick(shapes);
  const L = +(6 + R() * 12).toFixed(1);
  const ratio = { 원형: 1, 타원형: 1.6, 장방형: 2.1, 반원형: 2, 마름모형: 1.5 }[sh] || 1;
  const p = { s: String(900000000 + i), n: `데모${pick(['아세', '로사', '메트', '아모', '세티', '이부'])}${pick(['정', '정10mg', '캡슐', '서방정'])}${i}`, e: `데모제약${i % 7}`,
    sh, c1: pick(colors), pf: pick(['AB', 'TY', 'DM', 'K5', 'P10', 'HG', '']) + (i % 3 ? '' : String(i % 50)), pb: i % 4 ? '' : pick(['10', '500', '분할선']),
    L, W: +(L / ratio).toFixed(1), o: i % 3 ? '전문의약품' : '일반의약품', cl: '데모 분류', f: sh === '장방형' && i % 2 ? '경질캡슐제' : '필름코팅정' };
  if (p.f.includes('캡슐') && i % 2) p.c2 = pick(colors);
  pills.push(p);
}
// 테스트 사진과 맞출 확실한 기준 품목
pills.push({ s: '900001000', n: '데모흰장방형정', e: '데모제약', sh: '장방형', c1: '하양', pf: 'TY', pb: '500', L: 17.5, W: 8.8, o: '일반의약품', cl: '해열진통제(데모)', f: '필름코팅정' });
fs.writeFileSync(path.join(out, 'pills.json'), JSON.stringify(pills));
const shards = Array.from({ length: 100 }, () => ({}));
for (const p of pills.slice(-30)) shards[Number(p.s.slice(-2))][p.s] = { src: '데모', efcy: '데모 효능 문장입니다. 실제 약 정보가 아닙니다.', use: '데모 용법: 1회 1정.', atpn: '데모 주의사항.' };
shards.forEach((s, i) => fs.writeFileSync(path.join(out, 'details', String(i).padStart(2, '0') + '.json'), JSON.stringify(s)));
fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ updated: new Date().toISOString(), pills: pills.length, details: 30, demo: true }));
console.log('demo', pills.length);
