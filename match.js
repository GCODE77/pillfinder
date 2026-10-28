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
    for (const v of [r.c1, r.c2]) if (v) for (const t of String(v).split(/[,|/·\s]+/)) if (t && !/^(옅은|진한|연한)$/.test(t) && !out.includes(t)) out.push(t);
    return out;
  }

  // ---------- 각인 문자열 ----------
  // 식약처 각인 칸: "ESOM 20", "마크", "TY|500", "분할선" … 글자·숫자만 남긴다.
  function normImprint(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/분할선|마크|각인|없음|음각|양각|\(.*?\)/g, ' ')
      .replace(/[?？*＊_]/g, '?')            // 모르는 글자(와일드카드)
      .replace(/[^0-9A-Z가-힣?]+/g, '');
  }
  // 분할선(반절선): lf/lb = '-'(한 줄) '+'(십자) '기타', 각인 칸에 '분할선'이라고만 적힌 약도 있다
  function lineOf(r) {
    const kinds = [r.lf, r.lb].map((x) => String(x || '').trim()).filter(Boolean);
    const has = kinds.length > 0 || /분할선/.test(`${r.pf || ''}${r.pb || ''}`);
    return { has, kinds };
  }
  // want: has(있음, 종류 모름) / none / '-' / '+' / '기타' → 약이 맞는 정도 0~1
  function lineFit(r, want) {
    const { has, kinds } = lineOf(r);
    if (want === 'none') return has ? 0.03 : 1;
    if (want === 'has') return has ? 1 : 0.05;
    if (!has) return 0.03;
    if (!kinds.length) return 0.5;   // 분할선은 있는데 종류 자료가 없음
    return kinds.includes(want) ? 1 : 0.25;
  }
  // 분할선 일치 등급(정렬용): 2 = 같음, 1 = 분할선은 있는데 종류를 모름, 0 = 다름
  const lineTier = (r, want) => { const f = lineFit(r, want); return f >= 0.9 ? 2 : f >= 0.4 ? 1 : 0; };
  // 이 약의 분할선 상태를 매칭용 값으로: 없음 → 'none', 종류가 있으면 그 종류, 종류 모르는 있음 → 'has'
  function lineWant(r) {
    if (r.line) return r.line;
    if (!r.s) return '';
    const { has, kinds } = lineOf(r);
    return has ? (kinds[0] || 'has') : 'none';
  }
  // 각인이 있는 약인가(글자·마크가 하나라도 있으면). '분할선'만 있으면 각인 없음
  function hasImprint(r) {
    return [r.pf, r.pb].some((x) => String(x || '').replace(/분할선|없음|[\s\/\-_.,()]/g, '').length > 0);
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
        const sub = a[i - 1] === b[j - 1] || a[i - 1] === '?' || b[j - 1] === '?' ? 0 : (CONF[a[i - 1]] && CONF[a[i - 1]][b[j - 1]]) || 1;
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
    if (q.includes('?')) { // 보이는 글자만 적고 모르는 곳은 ? — 어디에 끼어 있어도 맞으면 높은 점수
      const known = q.replace(/\?/g, '').length;
      if (known) { try { if (new RegExp(q.replace(/\?/g, '.')).test(t)) return Math.min(0.97, 0.7 + 0.1 * known + 0.15 * (q.length / Math.max(q.length, t.length))); } catch (e) { /* 무시 */ } }
    }
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

  function imprintMatchScore(q, r) {
    if (!q) return 0;
    const sides = [normImprint(r.pf), normImprint(r.pb)].filter(Boolean);
    let v = 0;
    for (const s of sides.concat(sides.length > 1 ? [sides.join('')] : [])) v = Math.max(v, imprintSim(q, s));
    return v;
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
    if (obs.form) {
      const g = formGroup(r);
      if (obs.form.pick) {
        // 사용자가 제형을 직접 골랐다: 같으면 만점, 다르면 크게 감점(기타는 애매하므로 중간)
        add('form', 6, g === obs.form.pick ? 1 : g === '기타' ? 0.5 : 0.04);
      } else if (obs.form.hard !== undefined) {
        // 사진으로 본 '경질캡슐 같은 정도' p: 확신(0 또는 1에 가까울수록)만큼만 반영, 연질캡슐은 사진만으로 구분이 어려워 중간
        const p = obs.form.hard, conf = Math.abs(2 * p - 1);
        const v = g === '경질캡슐' ? p : g === '정제' ? 1 - p : g === '연질캡슐' ? 0.35 + 0.3 * (1 - p) : 0.5;
        add('form', 2.2 * conf, v);
      }
    }
    if (obs.aspect && r.L && r.W) {
      const ra = Math.max(r.L, r.W) / Math.min(r.L, r.W);
      const poly = /삼각|오각|육각|팔각|사각/.test(r.sh || '');
      const sig = poly ? 0.2 : 0.11;
      // 비스듬히 찍은 원형 약(비율 1.15 미만)은 원형 약과 비율 차를 따지지 않는다
      const d = obs.aspect < 1.15 && ra < 1.05 ? 0 : Math.log(Math.max(obs.aspect, 1) / ra);
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
      // 자신 없는 판독(신뢰도 낮음, 한 글자)은 거의 반영하지 않는다 — 엉터리 판독이 순위를 흔들지 않게
      if (best || conf) add('imprint', 5 * conf * conf, best);
    } else if (obs.noImprint) {
      // 판독기가 '글자 없음'으로 확신할 때만 약하게 반영
      const has = normImprint(r.pf) || normImprint(r.pb);
      add('imprint', 0.8, has ? 0.35 : 0.9);
    }
    if (obs.has === 'has' || obs.has === 'none') {
      const h = hasImprint(r);
      // 사용자가 직접 고른 값이므로 제형 선택처럼 강하게: 안 맞는 약은 사실상 뒤로 밀린다
      if (!reads.length || obs.has === 'none') add('hasimp', 10, obs.has === 'has' ? (h ? 1 : 0.03) : (h ? 0.02 : 1));
    }
    // 분할선(반절선) 종류: 사용자가 고른 값이므로 각인 유무처럼 강하게
    if (obs.line) add('splitline', 7, lineFit(r, obs.line));
    // 내가 확인한 약과 지문이 닮았으면 강하게
    if (obs.learnedSim && obs.learnedSim.has(r.s)) add('learned', 15, Math.min(1, (obs.learnedSim.get(r.s) - 0.3) / 0.15));
    // 면 특징(사진 한 면마다): 분할선이 보이는지, 각인 없는 빈 면인지 — 식약처 분할선·각인 칸과 대조
    if (obs.faces && obs.faces.length) {
      const fl = [!!(r.lf && r.lf.trim()) || /분할선/.test(r.pf || ''), !!(r.lb && r.lb.trim()) || /분할선/.test(r.pb || '')];
      const blankSide = (t) => !normImprint(t) && !/마크/.test(t || '');
      const fb = [blankSide(r.pf), blankSide(r.pb)];
      let lv = 0, lw = 0, bv = 0, bw = 0;
      for (const f of obs.faces) {
        if (f.line !== undefined) {
          const c = Math.abs(2 * f.line - 1); // 확신도
          // 보이는 면에 분할선이 있으면 어느 한 면엔 분할선, 없으면 분할선 없는 면이 하나는 있어야
          const v = f.line >= 0.5 ? (fl[0] || fl[1] ? 1 : 0.1) : (!fl[0] || !fl[1] ? 1 : 0.3);
          lv += c * v; lw += c;
        }
        if (f.blank !== undefined) {
          const c = Math.abs(2 * f.blank - 1);
          const v = f.blank >= 0.5 ? (fb[0] || fb[1] ? 1 : 0.2) : (!fb[0] || !fb[1] ? 1 : 0.3);
          bv += c * v; bw += c;
        }
      }
      if (lw) add('line', 2 * lw / obs.faces.length, lv / lw);
      if (bw) add('blank', 1.5 * bw / obs.faces.length, bv / bw);
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

  // ---------- 비슷한 약 ----------
  const isOtc = (r) => /일반/.test(r.o || '');
  // 생김새가 비슷한 약: 모양·색·장단축·두께·제형이 가까운 순(이 약 자체는 뺀다). 일반의약품만 고를 수 있다
  function similarLook(db, r, { otcOnly = false, limit = 40 } = {}) {
    const obs = {
      shape: { [r.sh || '기타']: 1 },
      colors: dbColors(r).slice(0, 2).map((c) => ({ probs: { [c]: 1 } })),
      aspect: r.L && r.W ? Math.max(r.L, r.W) / Math.min(r.L, r.W) : undefined,
      mm: r.L ? { long: Math.max(r.L, r.W || 0), short: Math.min(r.L, r.W || r.L) } : null,
      form: { pick: formGroup(r) },
      line: lineWant(r) || undefined,   // 분할선 있는 약이면 분할선 있는 약 위주로
    };
    const out = [];
    for (const x of db) {
      if (x.s === r.s || (otcOnly && !isOtc(x))) continue;
      let { score } = scoreOne(x, obs);
      if (r.T && x.T) { const d = (x.T - r.T) / (0.1 * r.T + 0.3); score *= 0.85 + 0.15 * Math.exp(-(d * d) / 2); }
      out.push({ r: x, score, lt: obs.line ? lineTier(x, obs.line) : 0 });
    }
    out.sort((a, b) => (b.lt - a.lt) || (b.score - a.score));
    return out.slice(0, limit);
  }
  // 조제 테스트용 대체약: 색·각인은 보지 않고 장축·단축·두께와 제형·모양만 (조제기·분포기 시험은 크기·모양이 같으면 된다)
  // ref = 약 한 개 또는 {L, W, T, form, shape}. 결과마다 크기 차(mm) d = {L, W, T}
  function sizeAlike(db, ref, { otcOnly = false, sameForm = true, sameShape = true, sameLine = true, limit = 40 } = {}) {
    const wantLine = sameLine ? lineWant(ref) : '';
    const L = Math.max(ref.L || 0, ref.W || 0), W = Math.min(ref.L || 0, ref.W || ref.L || 0), T = ref.T || 0;
    if (!L) return [];
    const fg = ref.form || (ref.f !== undefined ? formGroup(ref) : ''), sh = ref.shape || ref.sh || '';
    const tol = (v) => Math.max(0.3, v * 0.05);
    const out = [];
    for (const x of db) {
      if ((ref.s && x.s === ref.s) || !x.L || (otcOnly && !isOtc(x))) continue;
      if (sameForm && fg && formGroup(x) !== fg) continue;
      if (sameShape && sh && (x.sh || '기타') !== sh) continue;
      const xl = Math.max(x.L, x.W || 0), xw = Math.min(x.L, x.W || x.L);
      const d = { L: xl - L, W: W ? xw - W : null, T: T && x.T ? x.T - T : null };
      const z = (d.L / tol(L)) ** 2 + (d.W !== null ? (d.W / tol(W)) ** 2 : 0) + (d.T !== null ? (d.T / tol(T)) ** 2 : T ? 1.5 : 0);
      let score = Math.exp(-z / 8);
      if (wantLine) score *= 0.12 + 0.88 * lineFit(x, wantLine);   // 분할선이 같은 약이 확실히 위로
      if (!sameShape && sh) score *= 0.5 + 0.5 * shapeSim(sh, x.sh || '기타');
      if (!sameForm && fg) score *= formGroup(x) === fg ? 1 : 0.6;
      if (score < 0.01) continue;
      out.push({ r: x, score, d, lt: wantLine ? lineTier(x, wantLine) : 0 });
    }
    // 분할선이 같은 약이 무조건 먼저, 그 안에서 크기가 가까운 순
    out.sort((a, b) => (b.lt - a.lt) || (b.score - a.score));
    return out.slice(0, limit);
  }
  // 같은 성분 약: 주성분 코드 묶음(ig)이 같으면 같은 성분(함량은 다를 수 있음), 일반명코드(pg, 약가 자료)가 같으면 성분·함량·제형까지 같음
  function sameIngredient(db, r, { otcOnly = false } = {}) {
    if (!r.ig && !r.pg) return [];
    return db
      .filter((x) => x.s !== r.s && ((r.ig && x.ig === r.ig) || (r.pg && x.pg === r.pg)) && (!otcOnly || isOtc(x)))
      .map((x) => ({ r: x, exact: !!(r.pg && x.pg === r.pg) }))
      .sort((a, b) => (b.exact - a.exact) || ((a.r.pr ?? 1e12) - (b.r.pr ?? 1e12)) || a.r.n.localeCompare(b.r.n, 'ko'));
  }

  // ---------- 직접 고르기(칩) 필터 ----------
  // 제형 묶음: 식약처 제형명 → 정제 / 경질캡슐 / 연질캡슐 / 기타 (캡슐이 전체의 20%, 장방형의 절반 이상이라 구분하면 후보가 크게 줄어든다)
  function formGroup(r) {
    const f = r.f || '';
    if (/연질/.test(f)) return '연질캡슐';
    if (/캡슐|스팬슐/.test(f)) return '경질캡슐';
    if (/정|트로키/.test(f)) return '정제';
    return '기타';
  }
  // 크기 허용 오차(mm): 자로 잰 값은 거칠므로 ±0.6mm 또는 ±6% 중 큰 쪽
  const sizeTol = (v, k = 0.06) => Math.max(0.6, v * k);
  const sizeOk = (dbv, v, k) => !v || (dbv > 0 && Math.abs(dbv - v) <= sizeTol(v, k));
  // 세부 제형(식약처 제형명에 들어 있는 말로 찾는다)
  const FORM_DETAIL = { '필름코팅정': /필름코팅/, '나정': /나정/, '서방형': /서방/, '장용형': /장용/, '당의정': /당의/, '구강붕해': /구강붕해/, '츄어블': /추어블|츄어블|저작/, '다층정': /다층/ };
  function manualFilter({ shapes = [], colors = [], imprint = '', similarColors = true, size = {}, forms = [], formD = [], has = '', otc = '', line = '' } = {}) {
    const cset = new Set(similarColors ? colors.flatMap(COLOR_FAMILY) : colors);
    const q = normImprint(imprint);
    return (r) => {
      if (shapes.length && !shapes.includes(r.sh || '기타')) return false;
      if (cset.size && !dbColors(r).some((c) => cset.has(c))) return false;
      if (forms.length && !forms.includes(formGroup(r))) return false;
      if (otc && !(r.o || '').includes(otc)) return false;
      if (formD.length && !formD.some((k) => FORM_DETAIL[k] && FORM_DETAIL[k].test(r.f || ''))) return false;
      if (!sizeOk(r.L, size.L, size.tol) || !sizeOk(r.W, size.W, size.tol) || !sizeOk(r.T, size.T, size.tol)) return false;
      if (has === 'has' && !hasImprint(r)) return false;
      if (has === 'none' && hasImprint(r)) return false;
      if (line && lineFit(r, line) < 0.4) return false;
      if (q && imprintMatchScore(q, r) < 0.62) return false;
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

  const api = { rank, scoreOne, manualFilter, formGroup, FORM_DETAIL, similarLook, sizeAlike, lineOf, lineFit, lineWant, sameIngredient, isOtc, hasImprint, imprintMatchScore, searchName, normImprint, imprintSim, dbColors, choseong, COLOR_FAMILY, shapeSim, colorSim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Match = api;
})(typeof self !== 'undefined' ? self : this);
