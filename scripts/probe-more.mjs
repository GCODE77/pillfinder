// 임시: 회수·판매중지 API 시험. 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const U = 'https://apis.data.go.kr/1471000/MdcinRtrvlSleStpgeInfoService05/getMdcinRtrvlSleStpgeItem05';
for (const rows of ['3', '100', '500', '1000']) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: rows, type: 'json' });
  const t = await (await fetch(`${U}?${q}`)).text();
  let info = '';
  try { const j = JSON.parse(t); const it = j.body?.items ?? []; info = `items=${(Array.isArray(it) ? it : [it]).length} total=${j.body?.totalCount} code=${j.header?.resultCode}`;
    if (rows === '3') { const a = Array.isArray(it) ? it : (it.item ? [].concat(it.item) : [it]); console.log('필드', Object.keys(a[0] || {}).join(',')); console.log('샘플', JSON.stringify(a.slice(0, 2)).slice(0, 1800)); } } catch { info = t.slice(0, 300); }
  console.log('rows', rows, info);
}
