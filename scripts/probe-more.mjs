// 임시: 회수·판매중지 API 재시험. 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const B = 'https://apis.data.go.kr/1471000';
const cand = ['MdcinRtrvlSleStpgeInfoService04/getMdcinRtrvlSleStpgeItem03'];
for (const u of cand) {
  for (const rows of ['2', '1000']) {
    const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: rows, type: 'json' });
    const t = await (await fetch(`${B}/${u}?${q}`)).text();
    let n = ''; try { const j = JSON.parse(t); n = ` items=${(j.body.items || []).length} total=${j.body.totalCount}`; } catch {}
    console.log('★', u, 'rows', rows, n, t.replace(/\s+/g, ' ').slice(0, rows === '2' ? 1800 : 200));
  }
}
// DUR: numOfRows 상한 확인
for (const rows of ['100', '500', '1000', '5000']) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: rows, type: 'json' });
  const j = JSON.parse(await (await fetch(`${B}/DURPrdlstInfoService03/getPwnmTabooInfoList03?${q}`)).text());
  console.log('DUR rows', rows, '→ items', (j.body.items || []).length);
}
const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '2', type: 'json' });
const j = JSON.parse(await (await fetch(`${B}/DURPrdlstInfoService03/getUsjntTabooInfoList03?${q}`)).text());
console.log('병용 필드', Object.keys(j.body.items[0]).join(','));
console.log('병용 샘플', JSON.stringify(j.body.items[0]).slice(0, 1500));
