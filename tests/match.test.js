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
  { s: '8', n: '테스트경질약', sh: '장방형', c1: '하양', pf: 'ZZ', L: 18, W: 6.5, f: '경질캡슐제, 산제', o: '전문의약품', ig: 'M000001', pr: 500, pu: '캡슐' },
  { s: '12', n: '테스트일반캡슐', sh: '장방형', c1: '하양', pf: 'QQ', L: 18.2, W: 6.6, f: '경질캡슐제, 과립제', o: '일반의약품', ig: 'M000001', pr: 300, pu: '캡슐' },
  { s: '9', n: '테스트필름약', sh: '장방형', c1: '하양', pf: 'ZZ', L: 18, W: 6.5, f: '필름코팅정' },
  { s: '11', n: '테스트무각인약', sh: '삼각형', c1: '초록', pf: '', pb: '', L: 14, W: 14, f: '나정' },
  { s: '10', n: '테스트연질약', sh: '타원형', c1: '노랑', pf: 'ZZ', L: 18, W: 9, f: '연질캡슐제, 액상' },
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
const topOf = (obs) => M.rank(DB.filter((x) => ['8', '9'].includes(x.s)), obs)[0].r.s;
const base = { shape: { 장방형: 0.9 }, colors: [one('하양')], aspect: 2.7 };
t('제형: 사진이 경질캡슐 같으면(p 0.9) 같은 모양의 캡슐(8)이 정제(9)보다 위', topOf({ ...base, form: { hard: 0.9 } }) === '8');
t('제형: 사진이 캡슐 아니면(p 0.05) 정제(9)가 캡슐(8)보다 위', topOf({ ...base, form: { hard: 0.05 } }) === '9');
t('제형: 사용자가 정제를 고르면 정제(9)', topOf({ ...base, form: { pick: '정제' } }) === '9');
t('제형: 사용자가 경질캡슐을 고르면 8', topOf({ ...base, form: { pick: '경질캡슐' } }) === '8');
t('제형: 애매하면(p 0.5) 순위에 영향 없음(점수 같음)', (() => { const a = M.scoreOne(DB.find((x) => x.s === '8'), { ...base, form: { hard: 0.5 } }).score, b = M.scoreOne(DB.find((x) => x.s === '9'), { ...base, form: { hard: 0.5 } }).score; return Math.abs(a - b) < 1e-9; })());
t('제형 필터: 경질캡슐만 → 8, 12', ids({ forms: ['경질캡슐'] }) === '8,12');
t('제형 필터: 연질캡슐만 → 10', ids({ forms: ['연질캡슐'] }) === '10');
t('제형 묶음: 필름코팅정=정제, 서방성캡슐제=경질캡슐', M.formGroup({ f: '필름코팅정' }) === '정제' && M.formGroup({ f: '서방성캡슐제, 펠렛' }) === '경질캡슐');
t('세부 제형: 필름코팅정 → 9', ids({ formD: ['필름코팅정'] }) === '9');
t('세부 제형: 나정 → 11', ids({ formD: ['나정'] }) === '11');
t('각인 없음 조건 → 각인이 없는 약만(11)', ids({ has: 'none' }) === '11');
t('각인 있음 조건 → 11 제외', !ids({ has: 'has' }).split(',').includes('11') && ids({ has: 'has' }).split(',').length === DB.filter(M.hasImprint).length);
t('보이는 글자만: Y5 → TY500(3)', ids({ imprint: 'Y5' }) === '3');
t('모르는 글자 ?: T?5 → TY500(3)을 찾고 AB 계열은 제외', ids({ imprint: 'T?5' }).split(',').includes('3') && !ids({ imprint: 'T?5' }).split(',').includes('1'));
t('모르는 글자 ?: ?Y → TY(3)와 XY(2)', ['2', '3'].every((s) => ids({ imprint: '?Y' }).split(',').includes(s)));
t('각인 유사 정렬 점수: TY500에 대해 Y5(0.83) > AB(0.2 미만)', M.imprintMatchScore('Y5', DB[2]) > 0.8 && M.imprintMatchScore('Y5', DB[0]) < 0.4);
r = M.rank(DB.filter((x) => ['3', '11'].includes(x.s)), { shape: { 장방형: 0.5, 삼각형: 0.5 }, has: 'has' });
t('각인 있음(글자는 모름) → 각인 없는 약(11)이 아래', r[0].r.s === '3');
r = M.rank(DB.filter((x) => ['3', '11'].includes(x.s)), { shape: { 장방형: 0.5, 삼각형: 0.5 }, has: 'none' });
t('각인 없음 → 각인 없는 약(11)이 위', r[0].r.s === '11');
{
  // 모양·색이 딱 맞는 '각인 있는' 약(3)과 어중간한 '각인 없는' 약(11): 각인 없음을 고르면 후자가 위, 아무것도 안 고르면 전자가 위
  const pool = DB.filter((q) => ['3', '11'].includes(q.s));
  const o0 = { shape: { 장방형: 0.95 }, colors: [one('하양')], aspect: 2.4 };
  t('각인 없음을 고르면 모양이 더 맞는 각인 있는 약(3)보다 각인 없는 약(11)이 위', M.rank(pool, { ...o0, has: 'none' })[0].r.s === '11');
  t('각인 유무를 안 고르면 모양이 맞는 약(3)이 위', M.rank(pool, o0)[0].r.s === '3');
  t('각인 있음을 고르면 각인 없는 약(11)이 아래', M.rank(pool, { ...o0, has: 'has' })[0].r.s === '3');
}
t('비슷한 약: 전문 캡슐(8)과 생김새가 가장 비슷한 일반의약품 → 12', M.similarLook(DB, DB.find((x) => x.s === '8'), { otcOnly: true })[0].r.s === '12');
t('비슷한 약: 같은 크기라도 제형이 같은 캡슐(12)이 필름정(9)보다 위', (() => { const l = M.similarLook(DB, DB.find((x) => x.s === '8')).map((x) => x.r.s); return l.indexOf('12') < l.indexOf('9'); })());
t('비슷한 약: 자기 자신은 빠진다', !M.similarLook(DB, DB.find((x) => x.s === '8')).some((x) => x.r.s === '8'));
t('같은 성분 약: 8 → 12(일반의약품)', M.sameIngredient(DB, DB.find((x) => x.s === '8')).map((x) => x.r.s).join() === '12');
t('같은 성분 약: 주성분 정보 없으면 빈 목록', M.sameIngredient(DB, DB[0]).length === 0);
t('구분 필터: 일반의약품만 → 12', ids({ otc: '일반' }) === '12');
console.log(fail ? `${fail}개 실패` : '모두 통과');
process.exit(fail ? 1 : 0);
