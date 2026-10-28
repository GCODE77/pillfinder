// 임시: DUR·회수 API 시험. 키는 환경변수로만, 출력엔 찍지 않는다
const KEY = process.env.SERVICE_KEY;
const B = 'https://apis.data.go.kr/1471000';
const cand = [];
for (const svc of ['DURPrdlstInfoService03', 'DURIrdntInfoService03'])
  for (const op of ['getUsjntTabooInfoList03', 'getPwnmTabooInfoList03', 'getSpcifyAgrdeTabooInfoList03', 'getCpctyAtentInfoList03', 'getMdctnPdAtentInfoList03', 'getOdsnAtentInfoList03', 'getEfcyDplctInfoList03', 'getSeobangjeongPartitnAtentInfoList03'])
    cand.push(`${B}/${svc}/${op}`);
for (const svc of ['MdcinRtrvlSleStpgeInfoService03', 'MdcinRtrvlSleStpgeInfoService02', 'MdcinRtrvlSleStpgeInfoService01', 'MdcinRtrvlSleStpgeInfoService', 'MdcinRecallSttemntInfoService', 'MdcinRtrvlSleStpgeInfoService04'])
  for (const op of ['getMdcinRtrvlSleStpgeList', 'getMdcinRtrvlSleStpgeList03', 'getMdcinRtrvlSleStpgeList02', 'getMdcinRtrvlSleStpgeList01', 'getMdcinRtrvlSleStpgeList04'])
    cand.push(`${B}/${svc}/${op}`);
for (const u of cand) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '2', type: 'json' });
  try {
    const r = await fetch(`${u}?${q}`);
    const t = await r.text();
    const short = u.replace(B + '/', '');
    if (r.status === 404 || /NO_OPENAPI_SERVICE_ERROR/.test(t)) { console.log('없음', short); continue; }
    console.log('★', short, 'HTTP', r.status, t.replace(/\s+/g, ' ').slice(0, 700));
  } catch (e) { console.log('실패', u, e.message); }
}
// 허가정보 항목 이름(수입 구분 필드 확인)
try {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '1', type: 'json', item_name: '타이레놀' });
  const t = await (await fetch(`${B}/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnDtlInq08?${q}`)).text();
  const j = JSON.parse(t); const it = (j.body.items || [])[0] || (j.body.items && j.body.items.item);
  console.log('허가 필드:', Object.keys(it || {}).join(','));
  console.log('허가 샘플:', JSON.stringify(it).slice(0, 600));
} catch (e) { console.log('허가 실패', e.message); }
