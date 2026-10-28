// 식약처 안전 정보(DUR 품목정보)를 받아 앱이 읽는 data/dur.json 을 만든다.
//
//   병용금기(79만 건)는 받으면서 '성분 ↔ 성분'으로 묶어 용량을 줄인다.
//   임부금기·특정연령대금기·노인주의·용량주의·투여기간주의·효능군중복·분할주의는 성분(또는 품목)별 한 줄로 남긴다.
//
// 실행:  SERVICE_KEY=<인증키> node scripts/build-safety.mjs     (먼저 build-data.mjs 로 data/pills.json 이 있어야 함)
//   LIMIT=n   각 API를 n페이지까지만 (테스트용)
// 공공데이터포털에서 '의약품안전사용서비스(DUR)품목정보' 활용신청이 되어 있어야 한다. 안 되어 있으면 건너뛴다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data');
let KEY = (process.env.SERVICE_KEY || '').trim();
if (KEY.includes('%')) KEY = decodeURIComponent(KEY);
const LIMIT = Number(process.env.LIMIT || 0);
const ROWS = 500;   // 이 API는 500건까지(1000부터는 0건)
const BASE = 'https://apis.data.go.kr/1471000/DURPrdlstInfoService03';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(op, pageNo) {
  const q = new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: String(pageNo), numOfRows: String(ROWS) });
  const waits = [2000, 5000, 10000, 20000];
  for (let a = 0; ; a++) {
    try {
      const res = await fetch(`${BASE}/${op}?${q}`, { signal: AbortSignal.timeout(60000) });
      const j = JSON.parse(await res.text());
      const eh = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (eh) throw new Error(`API 오류: ${eh.returnAuthMsg || eh.errMsg}`);
      if (j.header?.resultCode && j.header.resultCode !== '00') throw new Error(`resultCode ${j.header.resultCode} ${j.header.resultMsg ?? ''}`);
      let items = j.body?.items ?? [];
      if (!Array.isArray(items)) items = items.item ?? [items];
      return { items, total: Number(j.body?.totalCount || 0) };
    } catch (e) {
      if (/등록되지 않은|SERVICE_KEY/.test(e.message) || a >= waits.length) throw new Error(`${op} page ${pageNo}: ${e.message}`);
      console.warn(`  재시도 ${a + 1} (${op} page ${pageNo}): ${e.message}`);
      await sleep(waits[a]);
    }
  }
}

// 페이지마다 fn(items)로 접어 넣고 버린다(병용금기는 통째로 들고 있기엔 너무 큼)
async function eachPage(name, op, fn, concurrency = 6) {
  const first = await getPage(op, 1);
  let pages = Math.ceil(first.total / ROWS) || 1;
  if (LIMIT) pages = Math.min(pages, LIMIT);
  console.log(`${name}: ${first.total}건, ${pages}페이지`);
  fn(first.items);
  let next = 2, done = 1;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next <= pages) {
      const p = next++;
      fn((await getPage(op, p)).items);
      if (++done % 100 === 0) console.log(`  ${name} ${done}/${pages}`);
    }
  }));
}

const clip = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function main() {
  if (!KEY) throw new Error('SERVICE_KEY가 없습니다');
  const pj = resolve(OUT, 'pills.json');
  if (!existsSync(pj)) throw new Error('data/pills.json이 없습니다(build-data.mjs를 먼저)');
  const mine = new Set(JSON.parse(readFileSync(pj, 'utf8')).map((p) => p.s));
  const t0 = Date.now();

  const ing = new Map();   // 성분코드 → {n, co: Map(상대코드 → [이름, 이유들]), pw, ag, od, cp, md, ef}
  const item = new Map();  // 품목코드 → Set(성분코드)
  const sp = {};           // 분할주의 품목 → 내용
  const I = (code, name) => { let o = ing.get(code); if (!o) ing.set(code, (o = { n: name || '' })); if (!o.n && name) o.n = name; return o; };
  const link = (seq, code) => { if (!mine.has(seq)) return; let s = item.get(seq); if (!s) item.set(seq, (s = new Set())); s.add(code); };
  const addText = (o, k, v) => { const t = clip(v) || '1'; const cur = o[k] ? o[k].split(' / ') : []; if (!cur.includes(t) && cur.length < 3) cur.push(t); o[k] = cur.join(' / '); };

  // 병용금기: 성분 ↔ 성분(이유는 성분 쌍마다 하나 이상)
  await eachPage('병용금기', 'getUsjntTabooInfoList03', (rows) => {
    for (const r of rows) {
      const a = r.INGR_CODE, b = r.MIXTURE_INGR_CODE; if (!a || !b) continue;
      const o = I(a, r.INGR_KOR_NAME); I(b, r.MIXTURE_INGR_KOR_NAME);
      if (!o.co) o.co = new Map();
      let e = o.co.get(b); if (!e) o.co.set(b, (e = [r.MIXTURE_INGR_KOR_NAME || b, []]));
      const why = clip(r.PROHBT_CONTENT, 60); if (why && !e[1].includes(why) && e[1].length < 2) e[1].push(why);
      link(String(r.ITEM_SEQ || ''), a);
    }
  });
  const simple = [
    ['임부금기', 'getPwnmTabooInfoList03', 'pw'],
    ['특정연령대금기', 'getSpcifyAgrdeTabooInfoList03', 'ag'],
    ['노인주의', 'getOdsnAtentInfoList03', 'od'],
    ['용량주의', 'getCpctyAtentInfoList03', 'cp'],
    ['투여기간주의', 'getMdctnPdAtentInfoList03', 'md'],
  ];
  for (const [name, op, k] of simple) {
    await eachPage(name, op, (rows) => {
      for (const r of rows) { if (!r.INGR_CODE) continue; addText(I(r.INGR_CODE, r.INGR_NAME), k, r.PROHBT_CONTENT); link(String(r.ITEM_SEQ || ''), r.INGR_CODE); }
    });
  }
  await eachPage('효능군중복', 'getEfcyDplctInfoList03', (rows) => {
    for (const r of rows) { if (!r.INGR_CODE) continue; const o = I(r.INGR_CODE, r.INGR_NAME); if (r.EFFECT_NAME) o.ef = clip(r.EFFECT_NAME, 30); link(String(r.ITEM_SEQ || ''), r.INGR_CODE); }
  });
  await eachPage('분할주의', 'getSeobangjeongPartitnAtentInfoList03', (rows) => {
    for (const r of rows) { const s = String(r.ITEM_SEQ || ''); if (mine.has(s)) sp[s] = clip(r.PROHBT_CONTENT, 60) || '분할 주의'; }
  });

  // 내 낱알 DB에 있는 약의 성분만 남긴다
  const used = new Set(); for (const s of item.values()) for (const c of s) used.add(c);
  const ingOut = {}, usedCo = new Set();
  for (const c of used) {
    const o = ing.get(c); if (!o) continue;
    const e = { n: o.n };
    for (const k of ['pw', 'ag', 'od', 'cp', 'md', 'ef']) if (o[k]) e[k] = o[k];
    if (o.co && o.co.size) {
      e.co = [...o.co.entries()].map(([b, [n, why]]) => [b, n, why.join(' / ')]).sort((x, y) => x[1].localeCompare(y[1], 'ko'));
    }
    ingOut[c] = e;
  }
  const itemOut = {};
  for (const [seq, s] of item) { const cs = [...s].filter((c) => ingOut[c]).sort(); if (cs.length) itemOut[seq] = cs.join(','); }
  const out = { at: new Date().toISOString().slice(0, 10), ing: ingOut, item: itemOut, sp };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'dur.json'), JSON.stringify(out));
  const pairs = Object.values(ingOut).reduce((n, e) => n + (e.co ? e.co.length : 0), 0);
  console.log(`DUR 완료: 성분 ${Object.keys(ingOut).length}, 품목 ${Object.keys(itemOut).length}, 병용금기 쌍 ${pairs}, 분할주의 ${Object.keys(sp).length} (${Math.round((Date.now() - t0) / 1000)}초)`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
