// 임시: 약국 FullDown 응답 확인. 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const U = 'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyFullDown';
for (const rows of ['2', '1000', '3000', '5000']) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: rows, _type: 'json' });
  const t0 = Date.now();
  const t = await (await fetch(`${U}?${q}`, { signal: AbortSignal.timeout(90000) })).text();
  let info = '';
  try { const j = JSON.parse(t); const b = j.response.body; let it = b.items?.item ?? []; if (!Array.isArray(it)) it = [it]; info = `items=${it.length} total=${b.totalCount} code=${j.response.header.resultCode}`;
    if (rows === '2') { console.log('필드', Object.keys(it[0]).join(',')); console.log('샘플', JSON.stringify(it[0])); }
    if (rows === '1000') { const k = {}; for (const p of it) for (const f of Object.keys(p)) k[f] = (k[f] || 0) + 1; console.log('필드별 건수(1000건 중)', JSON.stringify(k)); } }
  catch { info = t.slice(0, 300); }
  console.log('rows', rows, info, Date.now() - t0, 'ms');
}
