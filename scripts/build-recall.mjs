// 식약처 의약품 회수·판매중지 정보를 받아 앱이 읽는 data/recall.json 을 만든다.
//   회수 정보는 하루가 달라도 바뀌므로 낱알 데이터와 따로, 배포할 때마다 새로 받는다(전체 1천 건 안팎이라 몇 초).
//
// 실행:  SERVICE_KEY=<인증키> node scripts/build-recall.mjs     (먼저 build-data.mjs 로 data/pills.json 이 있어야 함)
// 공공데이터포털에서 '식품의약품안전처_의약품 회수·판매중지 정보' 활용신청이 되어 있어야 한다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data');
let KEY = (process.env.SERVICE_KEY || '').trim();
if (KEY.includes('%')) KEY = decodeURIComponent(KEY);
const ROWS = 500;   // 500건까지(1000부터는 0건)
const URL_ = 'https://apis.data.go.kr/1471000/MdcinRtrvlSleStpgeInfoService05/getMdcinRtrvlSleStpgeItem05';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function getPage(pageNo) {
  const q = new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: String(pageNo), numOfRows: String(ROWS) });
  const waits = [2000, 5000, 10000];
  for (let a = 0; ; a++) {
    try {
      const j = JSON.parse(await (await fetch(`${URL_}?${q}`, { signal: AbortSignal.timeout(60000) })).text());
      const eh = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (eh) throw new Error(`API 오류: ${eh.returnAuthMsg || eh.errMsg}`);
      if (j.header?.resultCode && j.header.resultCode !== '00') throw new Error(`resultCode ${j.header.resultCode} ${j.header.resultMsg ?? ''}`);
      let items = j.body?.items ?? [];
      if (!Array.isArray(items)) items = items.item ? [].concat(items.item) : [items];
      return { items: items.map((x) => x.item ?? x), total: Number(j.body?.totalCount || 0) };
    } catch (e) {
      if (/등록되지 않은|SERVICE_KEY/.test(e.message) || a >= waits.length) throw new Error(`page ${pageNo}: ${e.message}`);
      await sleep(waits[a]);
    }
  }
}

async function main() {
  if (!KEY) throw new Error('SERVICE_KEY가 없습니다');
  const pj = resolve(OUT, 'pills.json');
  if (!existsSync(pj)) throw new Error('data/pills.json이 없습니다(build-data.mjs를 먼저)');
  const mine = new Set(JSON.parse(readFileSync(pj, 'utf8')).map((p) => p.s));
  const first = await getPage(1);
  const pages = Math.ceil(first.total / ROWS) || 1;
  let rows = [...first.items];
  for (let p = 2; p <= pages; p++) rows.push(...(await getPage(p)).items);
  const items = {};
  for (const r of rows) {
    const seq = String(r.ITEM_SEQ || '');
    if (!seq || !mine.has(seq)) continue;
    const d = String(r.RECALL_COMMAND_DATE || r.RTRVL_CMMND_DT || '');
    (items[seq] ||= []).push([/^\d{8}$/.test(d) ? d : '', clip(r.RTRVL_RESN, 120), clip(r.MNFCTUR_NO, 40)]);
  }
  for (const k of Object.keys(items)) items[k] = items[k].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'recall.json'), JSON.stringify({ at: new Date().toISOString().slice(0, 10), total: rows.length, items }));
  console.log(`회수·판매중지: 전체 ${rows.length}건 중 낱알 약 ${Object.keys(items).length}개`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
