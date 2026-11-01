// 국립중앙의료원 전국 약국 정보를 받아 앱이 읽는 data/ph/*.json 을 만든다.
//
//   약국 약 2만 5천 곳을 위·경도 0.2도(약 20km) 격자로 나눠 파일 하나씩 → 앱은 내 주변 격자 몇 개만 읽는다.
//   data/ph/index.json   {at, n, cell, lat0, lon0}
//   data/ph/<iy>_<ix>.json   [[이름, 주소, 전화, 위도, 경도, 영업시간], …]
//   영업시간: 월~일·공휴일 8칸을 쉼표로, 칸마다 "0900-1800" 또는 빈칸(휴무·정보 없음)
//
// 실행:  SERVICE_KEY=<인증키> node scripts/build-pharmacy.mjs
// 공공데이터포털에서 '국립중앙의료원_전국 약국 정보 조회 서비스' 활용신청이 되어 있어야 한다.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'ph');
let KEY = (process.env.SERVICE_KEY || '').trim();
if (KEY.includes('%')) KEY = decodeURIComponent(KEY);
const ROWS = 3000;   // 5000까지 응답함을 확인(여유 있게 3000)
const URL_ = 'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyFullDown';
const CELL = 0.2, LAT0 = 33, LON0 = 124.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(pageNo) {
  const q = new URLSearchParams({ serviceKey: KEY, _type: 'json', pageNo: String(pageNo), numOfRows: String(ROWS) });
  const waits = [3000, 8000, 15000];
  for (let a = 0; ; a++) {
    try {
      const j = JSON.parse(await (await fetch(`${URL_}?${q}`, { signal: AbortSignal.timeout(120000) })).text());
      const eh = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (eh) throw new Error(`API 오류: ${eh.returnAuthMsg || eh.errMsg}`);
      const code = j.response?.header?.resultCode;
      if (code && code !== '00') throw new Error(`resultCode ${code} ${j.response?.header?.resultMsg ?? ''}`);
      let items = j.response?.body?.items?.item ?? [];
      if (!Array.isArray(items)) items = [items];
      return { items, total: Number(j.response?.body?.totalCount || 0) };
    } catch (e) {
      if (/등록되지 않은|SERVICE_KEY/.test(e.message) || a >= waits.length) throw new Error(`page ${pageNo}: ${e.message}`);
      await sleep(waits[a]);
    }
  }
}

const hhmm = (v) => String(v ?? '').replace(/\D/g, '').padStart(4, '0');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function main() {
  if (!KEY) throw new Error('SERVICE_KEY가 없습니다');
  const first = await getPage(1);
  const pages = Math.ceil(first.total / ROWS) || 1;
  console.log(`약국: ${first.total}곳, ${pages}페이지`);
  const rows = [...first.items];
  for (let p = 2; p <= pages; p++) rows.push(...(await getPage(p)).items);
  const seen = new Set(), cells = new Map();
  let n = 0;
  for (const r of rows) {
    const lat = Number(r.wgs84Lat), lon = Number(r.wgs84Lon), id = r.hpid || `${r.dutyName}${r.dutyAddr}`;
    if (!(lat > 32 && lat < 39.5 && lon > 124 && lon < 132) || seen.has(id) || !r.dutyName) continue;   // 좌표가 이상하거나 중복
    seen.add(id);
    const hours = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => (r[`dutyTime${d}s`] && r[`dutyTime${d}c`] ? `${hhmm(r[`dutyTime${d}s`])}-${hhmm(r[`dutyTime${d}c`])}` : '')).join(',');
    const rec = [clean(r.dutyName), clean(r.dutyAddr), clean(r.dutyTel1), Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, hours.replace(/^,+$/, '')];
    const key = `${Math.floor((lat - LAT0) / CELL)}_${Math.floor((lon - LON0) / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(rec);
    n++;
  }
  if (n < 10000) throw new Error(`약국이 ${n}곳뿐입니다 — 응답을 확인하세요`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [k, v] of cells) writeFileSync(resolve(OUT, `${k}.json`), JSON.stringify(v));
  writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ at: new Date().toISOString().slice(0, 10), n, cell: CELL, lat0: LAT0, lon0: LON0 }));
  console.log(`약국 완료: ${n}곳, 격자 ${cells.size}개`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
