// 임시: 허가정보 구분 필드 값 분포. 키는 환경변수로만
const KEY = process.env.SERVICE_KEY;
const U = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnDtlInq08';
const pills = await (await fetch('https://gcode77.github.io/pillfinder/data/pills.json')).json();
const have = new Set(pills.map((p) => p.s));
const rows = [];
let total = 0;
for (let page = 1; page <= 40; page++) {
  const q = new URLSearchParams({ serviceKey: KEY, pageNo: String(page), numOfRows: '100', type: 'json' });
  try {
    const j = JSON.parse(await (await fetch(`${U}?${q}`)).text());
    total = j.body.totalCount; const it = j.body.items || [];
    rows.push(...(Array.isArray(it) ? it : [it.item || it].flat()));
  } catch (e) { console.log('page', page, '실패', e.message); }
}
console.log('전체 건수', total, '표본', rows.length);
const tally = (k) => { const m = {}; for (const r of rows) { const v = r[k] ?? '(없음)'; m[v] = (m[v] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x.join(':')).join(' | '); };
for (const k of ['PERMIT_KIND_NAME', 'INDUTY_TYPE', 'GBN_NAME', 'MAKE_MATERIAL_FLAG', 'CANCEL_NAME', 'NARCOTIC_KIND_CODE', 'RARE_DRUG_YN', 'ETC_OTC_CODE', 'CNSGN_MANUF'].slice(0, 9)) console.log(k, '→', tally(k));
console.log('CANCEL_DATE 있음', rows.filter((r) => r.CANCEL_DATE).length, '/ 낱알DB에 있음', rows.filter((r) => have.has(String(r.ITEM_SEQ))).length);
const imp = rows.filter((r) => /수입/.test(r.PERMIT_KIND_NAME || '') || /수입/.test(r.GBN_NAME || '') || /수입/.test(r.INDUTY_TYPE || ''));
console.log('수입 표본', imp.length, '그중 낱알DB에 있음', imp.filter((r) => have.has(String(r.ITEM_SEQ))).length);
console.log('수입 예:', imp.slice(0, 5).map((r) => `${r.ITEM_NAME}/${r.ENTP_NAME}/${r.PERMIT_KIND_NAME}/${r.GBN_NAME}/${r.INDUTY_TYPE}`).join(' ;; '));
const canc = rows.filter((r) => r.CANCEL_DATE);
console.log('취소 예:', canc.slice(0, 4).map((r) => `${r.ITEM_NAME}/${r.CANCEL_DATE}/${r.CANCEL_NAME}/낱알DB:${have.has(String(r.ITEM_SEQ))}`).join(' ;; '));
