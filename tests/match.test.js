// 매칭 회귀 테스트:  node tests/match.test.js   (가짜 품목만 씀 — 실제 약 정보 아님)
'use strict';
const M = require('../match.js');
const DB = [
  { s: '1', n: '테스트원형정', sh: '원형', c1: '하양', pf: 'AB', pb: '10', L: 8, W: 8 },
  { s: '2', n: '테스트원형정2', sh: '원형', c1: '하양', pf: 'XY', L: 8.1, W: 8.1 },
  { s: '3', n: '테스트장방형정', sh: '장방형', c1: '하양', pf: 'TY', pb: '500', L: 17.5, W: 7.2, T: 4.5 },
  { s: '4', n: '테스트타원정', sh: '타원형', c1: '분홍', pf: 'P5', L: 10, W: 6 },
  { s: '5', n: '테스트캡슐', sh: '장방형', c1: '빨강', c2: '노랑', pf: 'CAP', L: 19, W: 7 },
  { s: '6', n: '테스트노랑원형', sh: '원형', c1: '노랑', pf: 'AB', L: 8, W: 8 },
  { s: '7', n: '테스트큰원형', sh: '원형', c1: '하양', pf: 'AB', L: 12, W: 12 },
];
const one = (c, v = 0.9) => ({ probs: { [c]: v, 하양: c === '하양' ? v : 0.05 } });
let fail = 0;
const t = (name, cond) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`); if (!cond) fail++; };

let r = M.rank(DB, { shape: { 원형: 0.9 }, colors: [one('하양')], aspect: 1.0, imprints: [{ text: 'AB', conf: 0.8 }] });
t('각인 AB 흰 원형 → 1번 또는 7번이 위', ['1', '7'].includes(r[0].r.s));
r = M.rank(DB, { shape: { 원형: 0.9 }, colors: [one('하양')], aspect: 1.0, mm: { long: 8.1, short: 8 }, imprints: [{ text: 'AB', conf: 0.8 }] });
t('동전 크기 8mm → 1번(작은 원형)이 1등', r[0].r.s === '1');
r = M.rank(DB, { shape: { 원형: 0.9 }, colors: [one('하양')], aspect: 1.0, imprints: [{ text: '4B', conf: 0.5 }] });
t('오독(4B)도 AB 원형이 상위 3', r.slice(0, 3).some((x) => x.r.s === '1'));
r = M.rank(DB, { shape: { 타원형: 0.6, 장방형: 0.4 }, colors: [one('하양')], aspect: 2.4, imprints: [{ text: 'TY', conf: 0.7 }] });
t('장방형 TY → 3번', r[0].r.s === '3');
r = M.rank(DB, { shape: { 장방형: 0.8 }, colors: [{ probs: { 빨강: 0.8 } }, { probs: { 노랑: 0.8 } }], aspect: 2.7 });
t('두 색 캡슐 → 5번', r[0].r.s === '5');
r = M.rank(DB, { shape: { 원형: 0.9 }, colors: [{ probs: { 노랑: 0.9 } }], aspect: 1 });
t('노랑 원형 → 6번', r[0].r.s === '6');
t('각인 칩 필터 "TY5" 부분일치', DB.filter(M.manualFilter({ imprint: 'TY' })).map((x) => x.s).join() === '3');
t('색 계열 필터: 분홍 고르면 빨강 캡슐도', DB.filter(M.manualFilter({ colors: ['분홍'] })).map((x) => x.s).join() === '4,5');
t('이름 검색 초성 ㅌㅅㅌㅋ', M.searchName(DB, 'ㅌㅅㅌㅋ')[0].s === '5');
t('이름 검색 "캡슐"', M.searchName(DB, '캡슐')[0].s === '5');
t('각인 정규화', M.normImprint('ESOM 20 (분할선)') === 'ESOM20' && M.normImprint('마크') === '');
const ids = (f) => DB.filter(M.manualFilter(f)).map((x) => x.s).join();
t('크기: 장축 8만 넣으면 8mm 원형들(큰 원형·캡슐 제외)', ids({ size: { L: 8 } }) === '1,2,6');
t('크기: 장축 12 + 단축 12 → 큰 원형만', ids({ size: { L: 12, W: 12 } }) === '7');
t('크기: 두께만 4.5 → 장방형만(두께 모르는 약은 제외)', ids({ size: { T: 4.5 } }) === '3');
t('크기+모양+색 함께: 하양 원형 장축 8', ids({ shapes: ['원형'], colors: ['하양'], size: { L: 8 } }) === '1,2');
t('크기 오차 허용: 장축 8.5도 8~8.1mm 약이 걸림', ids({ size: { L: 8.5 } }) === '1,2,6');
console.log(fail ? `${fail}개 실패` : '모두 통과');
process.exit(fail ? 1 : 0);
