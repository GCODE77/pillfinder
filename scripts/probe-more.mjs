// 임시: 남은 승인 API 엔드포인트 이름 찾기. 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const cand = [];
const add = (base, svcs, vers, ops) => { for (const s of svcs) for (const v of vers) for (const o of ops) for (const ov of vers) cand.push(`${base}/${s}${v}/${o}${ov}`); };
const V = ['', '1', '2', '3', '01', '02', '03', '04', '05'];
const B = 'https://apis.data.go.kr/1471000';
add(B, ['SafeStadDrugService'], V, ['getSafeStadDrugInq']);
add(B, ['QdrgPrdtPrmsnInfoService'], V, ['getQdrgPrdtPrmsnInq', 'getQdrgPrdtPrmsnDtlInq']);
add(B, ['MdcinSafeLetterInfoService', 'DrugSafeLetterInfoService', 'MdcinSafetyLetterService', 'DrbSafeLetterService'], V, ['getMdcinSafeLetterList', 'getDrugSafeLetterList', 'getSafeLetterList']);
add(B, ['HbMdcinRtrvlSleStpgeInfoService', 'HerbMdcinRtrvlSleStpgeInfoService', 'MdcinHerbRtrvlSleStpgeInfoService'], V, ['getHbMdcinRtrvlSleStpgeItem', 'getHerbMdcinRtrvlSleStpgeItem']);
const NM = 'https://apis.data.go.kr/B552657';
for (const s of ['ErmctInsttInfoInqireService', 'PharmacyInfoService', 'ParmacyInfoService'])
  for (const o of ['getParmacyListInfoInqire', 'getParmacyLcinfoInqire', 'getParmacyFullDown', 'getPharmacyListInfoInqire']) cand.push(`${NM}/${s}/${o}`);
let n = 0;
for (const u of cand) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '2', type: 'json', _type: 'json', Q0: '서울특별시', Q1: '강남구' });
  try {
    const r = await fetch(`${u}?${q}`, { signal: AbortSignal.timeout(20000) });
    const t = await r.text(); n++;
    if (r.status === 404 || /NO_OPENAPI_SERVICE_ERROR|SERVICE_NOT_FOUND|Unexpected errors|HTTP ROUTING ERROR/i.test(t)) continue;
    console.log('★', u.replace('https://apis.data.go.kr/', ''), 'HTTP', r.status, t.replace(/\s+/g, ' ').slice(0, 700));
  } catch (e) { console.log('실패', u.slice(-50), e.message); }
}
console.log('끝', n, '/', cand.length);
