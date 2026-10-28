// 약가 API 시험(임시): 어떤 조건에서 목록이 오는지 확인. 키는 환경변수로만, 출력엔 찍지 않는다
const KEY = process.env.SERVICE_KEY;
const U = 'https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList';
const pills = await (await fetch('https://gcode77.github.io/pillfinder/data/pills.json')).json();
const arr = Array.isArray(pills) ? pills : pills.items || pills.pills || pills.db;
const withEd = arr.filter((p) => p.ed).slice(0, 3);
const tests = [
  ['키만', {}],
  ['type=json', { type: 'json' }],
  ['numOfRows=1000', { numOfRows: '1000' }],
  ['itmNm=타이레놀', { itmNm: '타이레놀' }],
  ['mnfEntpNm=한국얀센', { mnfEntpNm: '한국얀센' }],
  ['mnfEntpNm=(주)유한양행', { mnfEntpNm: '유한양행' }],
  ['adtStaDd=20240101', { adtStaDd: '20240101' }],
  ['itmNm=정', { itmNm: '정' }],
  ...withEd.flatMap((p) => p.ed.split(',').slice(0, 1).map((cd) => [`mdsCd=${cd} (${p.n.slice(0, 8)})`, { mdsCd: cd }])),
];
for (const [name, extra] of tests) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: '1', numOfRows: '3', ...extra });
  try {
    const r = await fetch(`${U}?${q}`);
    const t = await r.text();
    const tot = (t.match(/<totalCount>(\d+)/) || [])[1], code = (t.match(/<resultCode>(\w+)/) || [])[1];
    const it = (t.match(/<item>([\s\S]*?)<\/item>/) || [])[1] || '';
    console.log(`${name}: HTTP ${r.status} code=${code} total=${tot}`, it.replace(/\s+/g, ' ').slice(0, 260));
  } catch (e) { console.log(name, '실패', e.message); }
}
