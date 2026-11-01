// 임시: 의약외품·안전성서한·한약 회수 오퍼레이션 이름 찾기. 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const B = 'https://apis.data.go.kr/1471000';
const cand = [];
const SUF = ['', '01', '02', '03', '04', '05'];
const gen = (svc, names, kinds) => { for (const n of names) for (const k of kinds) for (const s of SUF) cand.push(`${svc}/get${n}${k}${s}`); };
gen('QdrgPrdtPrmsnInfoService03', ['QdrgPrdtPrmsn', 'QdrgPrdtPrmsnDtl', 'QdrgPrmsn', 'QuasiDrugPrmsn', 'QdrgPrdt', 'Qdrg'], ['Inq', 'DtlInq', 'List', 'InfoList', 'Info', 'Item']);
gen('DrugSafeLetterService02', ['DrugSafeLetter', 'SafeLetter', 'DrugSafeLetterInfo', 'MdcinSafeLetter', 'SafeLetterInfo', 'DrugSfletr', 'Sfletr'], ['List', 'Inq', 'Info', 'InfoList', 'Item', 'Dtl']);
gen('HerbRtrvlSleStpgeInfo', ['HerbRtrvlSleStpge', 'HerbMdcinRtrvlSleStpge', 'HerbRtrvlSleStpgeInfo', 'HerbRecall'], ['Item', 'List', 'Inq', 'Info', 'InfoList']);
let hits = 0;
for (const u of cand) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '2', type: 'json' });
  try {
    const r = await fetch(`${B}/${u}?${q}`, { signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    if (r.status === 404 || /NO_OPENAPI_SERVICE_ERROR|SERVICE_NOT_FOUND|HTTP ROUTING ERROR/i.test(t)) continue;
    hits++; console.log('★', u, 'HTTP', r.status, t.replace(/\s+/g, ' ').slice(0, 900));
  } catch (e) { console.log('실패', u, e.message); }
}
console.log('끝', cand.length, '후보, 응답 있음', hits);
