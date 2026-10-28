// 임시: DUR·회수 API 시험(활용신청 후). 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const B = 'https://apis.data.go.kr/1471000';
const cand = [];
for (const op of ['getUsjntTabooInfoList03', 'getPwnmTabooInfoList03', 'getSpcifyAgrdeTabooInfoList03', 'getCpctyAtentInfoList03', 'getMdctnPdAtentInfoList03', 'getOdsnAtentInfoList03', 'getEfcyDplctInfoList03', 'getSeobangjeongPartitnAtentInfoList03'])
  cand.push(`DURPrdlstInfoService03/${op}`);
for (const v of ['', '01', '02', '03', '04'])
  for (const op of ['Item', 'List', 'Info'])
    for (const sfx of ['', '01', '02', '03', '04'])
      cand.push(`MdcinRtrvlSleStpgeInfoService${v}/getMdcinRtrvlSleStpge${op}${sfx}`);
for (const u of cand) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '2', type: 'json' });
  try {
    const r = await fetch(`${B}/${u}?${q}`);
    const t = await r.text();
    if (r.status === 404 || /NO_OPENAPI_SERVICE_ERROR/.test(t)) continue;
    console.log('★', u, 'HTTP', r.status, t.replace(/\s+/g, ' ').slice(0, 900));
  } catch (e) { console.log('실패', u, e.message); }
}
console.log('끝');
