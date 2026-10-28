// 식약처 공공데이터를 받아 앱이 읽는 정적 데이터 파일을 만든다.
//
//   data/pills.json        낱알식별 전체(모양·색·각인·크기·사진) — 카메라 식별과 이름 검색에 씀
//   data/details/NN.json   품목별 효능·용법·주의 (품목기준코드 끝 2자리로 100개로 나눔, 상세 화면에서만 읽음)
//   data/meta.json         건수·갱신일
//
// 실행:  SERVICE_KEY=<공공데이터포털 인증키> node scripts/build-data.mjs
//   PERMIT=0  허가 상세(전문약 효능·용법·주의) 생략 — 빠름(약 3분). 기본은 포함(20분 이상 걸릴 수 있음)
//   LIMIT=n   각 API를 n페이지까지만 (테스트용)
//
// 인증키는 GitHub Actions Secret(SERVICE_KEY)으로만 넣는다. 앱(브라우저)에는 절대 싣지 않는다.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data');

let KEY = (process.env.SERVICE_KEY || '').trim();
// 포털의 "Encoding" 키를 넣어도 이중 인코딩되지 않게 한 번 풀어 둔다.
if (KEY.includes('%')) KEY = decodeURIComponent(KEY);
const WITH_PERMIT = process.env.PERMIT !== '0';
const WITH_PRICE = process.env.PRICE !== '0';
const LIMIT = Number(process.env.LIMIT || 0);
const ROWS = 100;

// 2026-10 기준 살아있는 버전 (다른 버전 번호는 NO_OPENAPI_SERVICE_ERROR)
const BASE = 'https://apis.data.go.kr/1471000';
const EP = {
  pill: `${BASE}/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03`,
  easy: `${BASE}/DrbEasyDrugInfoService/getDrbEasyDrugList`,
  permit: `${BASE}/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnDtlInq08`,
  // 건강보험심사평가원 약가기준정보(보험 상한가). 공공데이터포털에서 따로 활용신청(자동승인) 필요 — 없으면 건너뜀
  price: 'https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 심평원 API는 XML로 온다: <item>…</item> 목록을 평범한 객체로
function xmlItems(text) {
  const items = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    items.push(o);
  }
  return items;
}

async function getPage(endpoint, pageNo, timeout = 30000, extra = {}) {
  const q = new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: String(pageNo), numOfRows: String(ROWS), ...extra });
  const waits = [2000, 5000, 10000, 20000];
  for (let a = 0; ; a++) {
    try {
      const res = await fetch(`${endpoint}?${q}`, { signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      if (text.trimStart().startsWith('<') && /<resultCode>\s*00\s*<\/resultCode>/.test(text)) {
        return { items: xmlItems(text), total: Number((text.match(/<totalCount>(\d+)/) || [])[1] || 0) };
      }
      if (text.trimStart().startsWith('<')) {
        // 인증 오류 등은 JSON 요청에도 XML로 온다
        const msg = (text.match(/<returnAuthMsg>([^<]*)/) || text.match(/<resultMsg>([^<]*)/) || [])[1] || text.slice(0, 200);
        throw new Error(`API 오류: ${msg}`);
      }
      const j = JSON.parse(text);
      // 인증 오류는 JSON으로도 온다: {OpenAPI_ServiceResponse:{cmmMsgHeader:{errMsg,returnAuthMsg}}}
      const eh = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
      if (eh) throw new Error(`API 오류: ${eh.returnAuthMsg || eh.errMsg}`);
      const body = j.body ?? j.response?.body;
      const code = j.header?.resultCode ?? j.response?.header?.resultCode;
      if (code && code !== '00') throw new Error(`resultCode ${code} ${j.header?.resultMsg ?? ''}`);
      let items = body?.items ?? [];
      if (items && !Array.isArray(items)) items = items.item ?? items;
      if (!Array.isArray(items)) items = items ? [items] : [];
      return { items, total: Number(body?.totalCount || 0) };
    } catch (e) {
      // 키 자체가 틀린 경우는 재시도해도 소용없다
      if (/SERVICE_KEY|SERVICE KEY|등록되지 않은/.test(e.message) || a >= waits.length) throw new Error(`page ${pageNo}: ${e.message}`);
      console.warn(`  재시도 ${a + 1} (page ${pageNo}): ${e.message}`);
      await sleep(waits[a]);
    }
  }
}

async function fetchAll(name, endpoint, { concurrency = 6, timeout, extra } = {}) {
  const first = await getPage(endpoint, 1, timeout, extra);
  let pages = Math.ceil(first.total / ROWS) || 1;
  if (LIMIT) pages = Math.min(pages, LIMIT);
  console.log(`${name}: ${first.total}건, ${pages}페이지`);
  const out = [...first.items];
  let next = 2;
  let done = 1;
  async function worker() {
    while (next <= pages) {
      const p = next++;
      const { items } = await getPage(endpoint, p, timeout, extra);
      out.push(...items);
      if (++done % 20 === 0) console.log(`  ${name} ${done}/${pages}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// 허가사항 문서(XML)와 e약은요 본문의 태그를 걷어 읽을 수 있는 평문으로
export function plain(s, clip = 0) {
  if (typeof s !== 'string' || !s.trim()) return undefined;
  let t = s
    .replace(/<!\[CDATA\[|\]\]>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(article|section|paragraph|title|table|tr|li|p|div)\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<article[^>]*title="([^"]*)"[^>]*>/gi, '\n$1\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·')
    .replace(/&quot;/g, '"').replace(/&#x?[0-9a-f]+;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!t) return undefined;
  if (clip && t.length > clip) t = t.slice(0, clip).replace(/\s+\S*$/, '') + ' …(이하 생략, 원문 참고)';
  return t;
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function compactPill(r) {
  const o = { s: String(r.ITEM_SEQ ?? ''), n: r.ITEM_NAME ?? '', e: r.ENTP_NAME ?? '' };
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') o[k] = v; };
  put('sh', r.DRUG_SHAPE);
  put('c1', r.COLOR_CLASS1);
  put('c2', r.COLOR_CLASS2);
  put('pf', r.PRINT_FRONT);
  put('pb', r.PRINT_BACK);
  put('lf', r.LINE_FRONT);
  put('lb', r.LINE_BACK);
  put('L', num(r.LENG_LONG));
  put('W', num(r.LENG_SHORT));
  put('T', num(r.THICK));
  put('img', r.ITEM_IMAGE);
  put('f', r.FORM_CODE_NAME);
  put('o', r.ETC_OTC_NAME);
  put('cl', r.CLASS_NAME);
  put('ch', r.CHART);
  put('mf', r.MARK_CODE_FRONT_ANAL);
  put('mb', r.MARK_CODE_BACK_ANAL);
  put('en', r.ITEM_ENG_NAME);
  // 보험코드(EDI): 약가(심평원)와 잇는 열쇠. 여러 개면 앞의 3개까지
  const ed = String(r.EDI_CODE || '').split(/[,\s]+/).filter((x) => /^\d{9}$/.test(x)).slice(0, 3).join(',');
  put('ed', ed);
  return o;
}

const pick = (r, ...keys) => { for (const k of keys) if (r[k]) return r[k]; return undefined; };

async function main() {
  if (!KEY) throw new Error('SERVICE_KEY가 없습니다. 공공데이터포털에서 받은 인증키를 넣어 실행하세요.');
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();

  // 1) 낱알식별
  const rawPills = await fetchAll('낱알식별', EP.pill);
  const seen = new Set();
  const pills = [];
  for (const r of rawPills) {
    const p = compactPill(r);
    if (!p.s || seen.has(p.s)) continue;
    seen.add(p.s);
    pills.push(p);
  }
  if (!LIMIT && pills.length < 1000) throw new Error(`낱알식별이 ${pills.length}건뿐입니다 — 응답 형식이나 인증키를 확인하세요`);
  pills.sort((a, b) => a.n.localeCompare(b.n, 'ko'));

  // 2) 상세 — e약은요(일반약, 쉬운 말) 우선, 없으면 허가사항(전문약 포함)
  const details = new Map(); // seq → 상세
  const easy = await fetchAll('e약은요', EP.easy);
  for (const r of easy) {
    const seq = String(r.itemSeq ?? '');
    if (!seq) continue;
    details.set(seq, {
      src: 'e약은요',
      n: r.itemName,
      efcy: plain(r.efcyQesitm),
      use: plain(r.useMethodQesitm),
      warn: plain(r.atpnWarnQesitm),
      atpn: plain(r.atpnQesitm),
      intrc: plain(r.intrcQesitm),
      se: plain(r.seQesitm),
      keep: plain(r.depositMethodQesitm),
      img: r.itemImage || undefined,
    });
  }

  if (WITH_PERMIT) {
    // 허가 상세는 페이지마다 문서 전문이 실려 무겁다 → 동시 요청 수를 낮추고 오래 기다린다.
    let permit = [];
    try { permit = await fetchAll('허가상세', EP.permit, { concurrency: 4, timeout: 90000 }); }
    catch (e) { console.warn(`::warning::허가상세를 건너뜁니다(전문약 효능·용법 없음): ${e.message}`); }
    const pillBySeq = new Map(pills.map((p) => [p.s, p]));
    for (const r of permit) {
      const seq = String(r.ITEM_SEQ ?? '');
      if (!seq) continue;
      // 주성분: [M229415]이토프리드염산염|… → 코드 묶음(같은 성분 찾기용)과 짧은 이름
      const pp = pillBySeq.get(seq);
      if (pp && r.MAIN_ITEM_INGR) {
        const parts = [...String(r.MAIN_ITEM_INGR).matchAll(/\[(M\d+)\]([^|\[]*)/g)];
        const codes = [...new Set(parts.map((m) => m[1]))].sort();
        if (codes.length) { pp.ig = codes.join('|'); const nm = parts.map((m) => m[2].trim()).filter(Boolean).join('·'); if (nm) pp.in = nm.length > 60 ? nm.slice(0, 58) + '…' : nm; }
      }
      // 허가 상태·구분(허가정보): 취하/유효기간만료/폐업/행정(취소)는 더 이상 유통되지 않을 수 있는 약, 수입업 품목, 마약류, 희귀의약품
      if (pp) {
        if (r.CANCEL_NAME && r.CANCEL_NAME !== '정상') { pp.st = String(r.CANCEL_NAME).replace(/[()]/g, ''); if (/^\d{8}$/.test(String(r.CANCEL_DATE || ''))) pp.cd = String(r.CANCEL_DATE); }
        if (/수입/.test(r.INDUTY_TYPE || '')) pp.im = 1;
        if (r.NARCOTIC_KIND_CODE) pp.nk = r.NARCOTIC_KIND_CODE;
        if (r.RARE_DRUG_YN === 'Y') pp.ra = 1;
      }
      const cur = details.get(seq);
      const ingr = pick(r, 'MAIN_ITEM_INGR', 'MATERIAL_NAME');
      const extra = {
        ingr: plain(ingr, 400),
        keep2: plain(r.STORAGE_METHOD),
        valid: plain(r.VALID_TERM),
      };
      if (cur) { Object.assign(cur, Object.fromEntries(Object.entries(extra).filter(([, v]) => v))); continue; }
      // e약은요가 없는 약은 카메라로 찍힐 수 있는 낱알(경구약)만 싣는다(용량 절약)
      if (!seen.has(seq)) continue;
      details.set(seq, {
        src: '허가사항',
        n: r.ITEM_NAME,
        efcy: plain(r.EE_DOC_DATA, 1500),
        use: plain(r.UD_DOC_DATA, 1500),
        atpn: plain(r.NB_DOC_DATA, 3000),
        ...extra,
      });
    }
  }

  // 2-1) 보험 약가(상한가): 심평원 약가기준정보. 활용신청 전이면 건너뛴다
  let priced = 0, priceAt = '';
  if (WITH_PRICE) {
    try {
      // 이 API는 조건 없이는 0건이라 품목명(itmNm, 부분 일치) 조건이 꼭 필요하다 → 알약 이름에 흔한 말로 나눠 받는다
      const rows = [];
      for (const term of ['정', '캡슐', '캅셀', '환', '트로키']) {
        const part = await fetchAll(`약가(${term})`, EP.price, { concurrency: 6, timeout: 60000, extra: { itmNm: term } });
        rows.push(...part);
      }
      const best = new Map(); // 약품코드 → 가장 최근 적용 행
      for (const r of rows) {
        const cd = String(r.mdsCd || '').trim();
        if (!/^\d{9}$/.test(cd) || /삭제/.test(r.payTpNm || '')) continue;
        const cur = best.get(cd);
        if (!cur || String(r.adtStaDd || '') > String(cur.adtStaDd || '')) best.set(cd, r);
      }
      for (const p of pills) {
        if (!p.ed) continue;
        for (const cd of p.ed.split(',')) {
          const r = best.get(cd); const v = r && Number(String(r.mxCprc).replace(/,/g, ''));
          if (!(v > 0)) continue;
          p.pr = v; p.pu = r.unit || ''; if (r.gnlNmCd) p.pg = r.gnlNmCd; if (r.nomNm) p.pn = r.nomNm;
          priced++; if (String(r.adtStaDd || '') > priceAt) priceAt = String(r.adtStaDd || '');
          break;
        }
      }
      console.log(`약가: ${best.size}개 약품코드, 낱알 ${priced}건에 가격`);
    } catch (e) { console.warn(`::warning::약가를 건너뜁니다(공공데이터포털 '건강보험심사평가원_약가기준정보조회서비스' 활용신청 필요): ${e.message}`); }
  }

  // 3) 쓰기
  writeFileSync(resolve(OUT, 'pills.json'), JSON.stringify(pills));
  rmSync(resolve(OUT, 'details'), { recursive: true, force: true });
  mkdirSync(resolve(OUT, 'details'), { recursive: true });
  const shards = Array.from({ length: 100 }, () => ({}));
  for (const [seq, d] of details) {
    for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
    shards[Number(seq.slice(-2)) || 0][seq] = d;
  }
  shards.forEach((s, i) => writeFileSync(resolve(OUT, 'details', `${String(i).padStart(2, '0')}.json`), JSON.stringify(s)));

  const meta = {
    updated: new Date().toISOString(),
    pills: pills.length,
    details: details.size,
    withPermit: WITH_PERMIT && details.size > easy.length,
    priced, priceAt,
    withIngr: pills.filter((p) => p.ig).length,
    source: '식품의약품안전처 공공데이터(낱알식별·e약은요·의약품 제품 허가정보), 건강보험심사평가원 약가기준정보, 공공데이터포털',
  };
  writeFileSync(resolve(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`완료: 낱알 ${pills.length}, 상세 ${details.size} (${Math.round((Date.now() - t0) / 1000)}초)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
