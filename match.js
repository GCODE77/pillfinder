// 필파인더 후보 매칭 — 사진에서 뽑은 특징(모양·색·비율·각인·크기)을 식약처 낱알식별 목록과 맞춰 점수를 매긴다.
// 브라우저(window.Match)와 Node 테스트에서 같이 쓴다.
(function (root) {
  'use strict';

  // 식약처 분류가 사람마다 갈리는 짝(타원형↔장방형 등)은 부분 점수
  const SHAPE_SIM = {
    원형: { 팔각형: 0.35, 육각형: 0.2, 타원형: 0.15, 기타: 0.2 },
    타원형: { 장방형: 0.6, 원형: 0.15, 반원형: 0.2, 기타: 0.25 },
    장방형: { 타원형: 0.6, 사각형: 0.2, 기타: 0.25 },
    반원형: { 타원형: 0.25, 삼각형: 0.2, 기타: 0.3 },
    삼각형: { 반원형: 0.2, 오각형: 0.15, 기타: 0.3 },
    사각형: { 마름모형: 0.55, 장방형: 0.25, 팔각형: 0.15, 기타: 0.25 },
    마름모형: { 사각형: 0.55, 타원형: 0.1, 기타: 0.3 },
    오각형: { 육각형: 0.3, 원형: 0.1, 삼각형: 0.15, 기타: 0.3 },
    육각형: { 팔각형: 0.35, 오각형: 0.3, 원형: 0.2, 기타: 0.3 },
    팔각형: { 원형: 0.35, 육각형: 0.35, 사각형: 0.15, 기타: 0.3 },
    기타: { 원형: 0.15, 타원형: 0.2, 장방형: 0.2, 반원형: 0.3, 삼각형: 0.3, 사각형: 0.25, 마름모형: 0.3, 오각형: 0.3, 육각형: 0.3, 팔각형: 0.3 },
  };
  const shapeSim = (a, b) => (a === b ? 1 : (SHAPE_SIM[a] && SHAPE_SIM[a][b]) || 0.05);

  // 헷갈리는 색 계열
  const COLOR_PAIRS = [
    ['하양', '회색', 0.35], ['하양', '노랑', 0.3], ['하양', '투명', 0.5], ['하양', '분홍', 0.2], ['하양', '연두', 0.15],
    ['분홍', '빨강', 0.45], ['분홍', '주황', 0.4], ['분홍', '자주', 0.4],
    ['주황', '빨강', 0.45], ['주황', '노랑', 0.4], ['주황', '갈색', 0.4],
    ['갈색', '빨강', 0.3], ['갈색', '회색', 0.15],
    ['연두', '초록', 0.5], ['연두', '노랑', 0.4], ['초록', '청록', 0.5],
    ['청록', '파랑', 0.45], ['파랑', '남색', 0.5], ['파랑', '보라', 0.25], ['남색', '보라', 0.35], ['남색', '검정', 0.3],
    ['보라', '자주', 0.5], ['자주', '빨강', 0.3],
    ['회색', '검정', 0.4], ['투명', '노랑', 0.3],
  ];
  const CSIM = {};
  for (const [a, b, v] of COLOR_PAIRS) { (CSIM[a] = CSIM[a] || {})[b] = v; (CSIM[b] = CSIM[b] || {})[a] = v; }
  const colorSim = (a, b) => (a === b ? 1 : (CSIM[a] && CSIM[a][b]) || 0.03);
  const COLOR_FAMILY = (c) => [c, ...Object.keys(CSIM[c] || {}).filter((k) => CSIM[c][k] >= 0.4)];

  // DB 색 칸은 "하양", "하양, 노랑", "주황|하양" 같은 형태
  function dbColors(r) {
    const out = [];
    for (const v of [r.c1, r.c2]) if (v) for (const t of String(v).split(/[,|/·\s]+/)) if (t && !out.includes(t)) out.push(t);
    return out;
  }

  // ---------- 각인 문자열 ----------
  // 식약처 각인 칸: "ESOM 20", "마크", "TY|500", "분할선" … 글자·숫자만 남긴다.
  function normImprint(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/분할선|마크|각인|없음|음각|양각|\(.*?\)/g, ' ')
      .replace(/[^0-9A-Z가-힣]+/g, '');
  }
  // 마모·오독으로 헷갈리는 글자 (거리 0.3)
  const CONF = {};
  for (const g of ['0OQD', '1IL7T', '5S', '8B3', '2Z', '6G', 'UV', 'MNW', 'CG', 'EF', 'KX', 'PR']) {
    for (const a of g) for (const b of g) if (a !== b) (CONF[a] = CONF[a] || {})[b] = 0.3;
  }
  function wlev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        const sub = a[i - 1] === b[j - 1] ? 0 : (CONF[a[i - 1]] && CONF[a[i - 1]][b[j - 1]]) || 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
      }
      prev = cur;
    }
    return prev[n];
  }
  // 0~1: 읽은 글자(q)가 DB 각인(t)과 얼마나 닮았나. 일부만 읽혀도(앞뒤 잘림) 점수를 준다.
  function imprintSim(q, t) {
    if (!q || !t) return 0;
    if (q === t) return 1;
    if (t.includes(q) && q.length >= 2) return 0.75 + 0.2 * (q.length / t.length);
    if (q.includes(t) && t.length >= 2) return 0.7 + 0.2 * (t.length / q.length);
    const full = 1 - wlev(q, t) / Math.max(q.length, t.length);
    // 부분 일치: t 안에서 q 길이 창을 밀어 가며
    let part = 0;
    if (t.length > q.length && q.length >= 2) {
      for (let i = 0; i + q.length <= t.length; i++) part = Math.max(part, 1 - wlev(q, t.slice(i, i + q.length)) / q.length);
      part *= 0.75 * (0.6 + 0.4 * q.length / t.length);
    }
    return Math.max(0, full, part);
  }

  // ---------- 점수 ----------
  // obs: {
  //   shape: {원형:0.9,...}, colors: [{probs:{하양:0.8,...}}, ...], aspect: 1.9,
  //   mm: {long, short} | null, imprints: [{text:'TY500', conf:0.8}], (앞·뒤 사진의 판독을 합쳐서)
  // }
  function scoreOne(r, obs) {
    const parts = {};
    let wsum = 0, ssum = 0;
    const add = (k, w, v) => { parts[k] = v; wsum += w; ssum += w * v; };

    if (obs.shape) {
      let s = 0;
      const rs = r.sh || '기타';
      for (const k in obs.shape) s += obs.shape[k] * shapeSim(k, rs);
      add('shape', 2, Math.min(1, s * 1.15));
    }
    if (obs.colors && obs.colors.length) {
      const rc = dbColors(r);
      if (rc.length) {
        const one = (probs, c) => { let s = 0; for (const k in probs) s += probs[k] * colorSim(k, c); return Math.min(1, s * 1.1); };
        let v;
        if (obs.colors.length === 1) {
          v = Math.max(...rc.map((c) => one(obs.colors[0].probs, c)));
          if (rc.length >= 2) v *= 0.8; // 두 가지 색 약인데 한 색만 보임
        } else {
          const [p, q] = obs.colors;
          if (rc.length >= 2) v = Math.max((one(p.probs, rc[0]) + one(q.probs, rc[1])) / 2, (one(p.probs, rc[1]) + one(q.probs, rc[0])) / 2);
          else v = 0.6 * Math.max(one(p.probs, rc[0]), one(q.probs, rc[0]));
        }
        add('color', 2.5, v);
      }
    }
    if (obs.aspect && r.L && r.W) {
      const ra = Math.max(r.L, r.W) / Math.min(r.L, r.W);
      const poly = /삼각|오각|육각|팔각|사각/.test(r.sh || '');
      const sig = poly ? 0.2 : 0.11;
      const d = Math.log(obs.aspect / ra);
      add('aspect', 1.5, Math.exp(-(d * d) / (2 * sig * sig)));
    }
    if (obs.mm && obs.mm.long && r.L) {
      const tol = (x) => 0.07 * x + 0.35;
      const dl = (obs.mm.long - Math.max(r.L, r.W || 0)) / tol(r.L);
      let v = Math.exp(-(dl * dl) / 2);
      if (obs.mm.short && r.W) { const ds = (obs.mm.short - Math.min(r.L, r.W)) / tol(r.W); v *= Math.exp(-(ds * ds) / 2) ** 0.5; }
      add('size', 2.2, v);
    }
    const reads = (obs.imprints || []).filter((x) => x && x.text);
    if (reads.length) {
      const sides = [normImprint(r.pf), normImprint(r.pb)].filter(Boolean);
      const both = sides.join('');
      let best = 0, conf = 0;
      for (const rd of reads) {
        const q = normImprint(rd.text);
        if (!q) continue;
        const c = rd.conf ?? 0.6;
        let v = sides.length ? 0 : 0.05; // 각인 없는 약인데 글자가 읽힘
        for (const t of sides.concat(sides.length > 1 ? [both] : [])) v = Math.max(v, imprintSim(q, t));
        if (v * c >= best * conf) { best = v; conf = c; }
      }
      if (best || conf) add('imprint', 1 + 4 * conf, best);
    } else if (obs.noImprint) {
      // 판독기가 '글자 없음'으로 확신할 때만 약하게 반영
      const has = normImprint(r.pf) || normImprint(r.pb);
      add('imprint', 0.8, has ? 0.35 : 0.9);
    }
    return { score: wsum ? ssum / wsum : 0, parts };
  }

  function rank(db, obs, { limit = 40, filter } = {}) {
    const out = [];
    for (const r of db) {
      if (filter && !filter(r)) continue;
      const s = scoreOne(r, obs);
      out.push({ r, score: s.score, parts: s.parts });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  // ---------- 직접 고르기(칩) 필터 ----------
  function manualFilter({ shapes = [], colors = [], imprint = '', similarColors = true } = {}) {
    const cset = new Set(similarColors ? colors.flatMap(COLOR_FAMILY) : colors);
    const q = normImprint(imprint);
    return (r) => {
      if (shapes.length && !shapes.includes(r.sh || '기타')) return false;
      if (cset.size && !dbColors(r).some((c) => cset.has(c))) return false;
      if (q) {
        const sides = [normImprint(r.pf), normImprint(r.pb)];
        if (!sides.some((t) => t && (t.includes(q) || (q.length >= 3 && imprintSim(q, t) >= 0.66)))) return false;
      }
      return true;
    };
  }

  // ---------- 이름 검색 ----------
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function choseong(s) {
    let o = '';
    for (const ch of s) {
      const c = ch.charCodeAt(0) - 0xac00;
      o += c >= 0 && c < 11172 ? CHO[(c / 588) | 0] : ch;
    }
    return o;
  }
  const normName = (s) => String(s || '').toLowerCase().replace(/[\s\-_.,()[\]·]/g, '');
  const isCho = (s) => /^[ㄱ-ㅎ]+$/.test(s);

  // items: [{n, e, en, s, ...}] → 이름·업체·영문명·각인으로
  function searchName(items, query, limit = 60) {
    const q = normName(query);
    if (!q) return [];
    const cho = isCho(q);
    const qi = normImprint(query);
    const out = [];
    for (const r of items) {
      const n = normName(r.n);
      let sc = 0;
      if (cho) {
        const c = choseong(n);
        if (c.startsWith(q)) sc = 80; else if (c.includes(q)) sc = 50;
      } else {
        if (n.startsWith(q)) sc = 100 - Math.min(30, n.length - q.length);
        else if (n.includes(q)) sc = 70 - Math.min(30, n.length - q.length);
        else if (r.en && normName(r.en).includes(q)) sc = 55;
        else if (r.e && normName(r.e).includes(q)) sc = 30;
        else if (qi.length >= 2 && (normImprint(r.pf) === qi || normImprint(r.pb) === qi)) sc = 45;
        else if (r.ingr && normName(r.ingr).includes(q)) sc = 40;
      }
      if (sc) out.push({ r, sc });
    }
    out.sort((a, b) => b.sc - a.sc || a.r.n.length - b.r.n.length);
    return out.slice(0, limit).map((x) => x.r);
  }

  const api = { rank, scoreOne, manualFilter, searchName, normImprint, imprintSim, dbColors, choseong, COLOR_FAMILY, shapeSim, colorSim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Match = api;
})(typeof self !== 'undefined' ? self : this);
