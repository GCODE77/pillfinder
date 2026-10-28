// 모양·제형 그림(SVG). 모양은 실제 테두리 모양 안에 글자, 제형은 특징이 보이는 예시 그림.
// 실제 약 사진은 쓰지 않고(저작권) 구분점만 단순하게 그린다.
let uid = 0;
const nid = (p) => `${p}${++uid}`;

const poly = (cx, cy, r, n, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i * 2 * Math.PI) / n;
  return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

const OUT = 'stroke="#facc15" stroke-width="3" stroke-linejoin="round" fill="rgba(250,204,21,.13)"';

// 모양 타일: 테두리 + 안에 글자 (viewBox 100×64)
export function shapeSvg(name) {
  let body, ty = 37;
  switch (name) {
    case '원형': body = `<circle cx="50" cy="32" r="27" ${OUT}/>`; break;
    case '타원형': body = `<ellipse cx="50" cy="32" rx="40" ry="23" ${OUT}/>`; break;
    case '장방형': body = `<rect x="6" y="15" width="88" height="34" rx="13" ${OUT}/>`; break;
    case '반원형': body = `<path d="M10 46 A40 36 0 0 1 90 46 Z" ${OUT}/>`; ty = 38; break;
    case '삼각형': body = `<polygon points="50,6 92,56 8,56" ${OUT}/>`; ty = 46; break;
    case '사각형': body = `<rect x="22" y="7" width="56" height="50" rx="7" ${OUT}/>`; break;
    case '마름모형': body = `<polygon points="50,4 94,32 50,60 6,32" ${OUT}/>`; break;
    case '오각형': body = `<polygon points="${poly(50, 35, 29, 5)}" ${OUT}/>`; ty = 40; break;
    case '육각형': body = `<polygon points="${poly(50, 32, 29, 6, 0)}" ${OUT}/>`; break;
    case '팔각형': body = `<polygon points="${poly(50, 32, 29, 8, Math.PI / 8)}" ${OUT}/>`; break;
    default: body = `<path d="M28 19 C8 19 8 52 50 57 C92 52 92 19 72 19 C62 9 38 9 28 19Z" ${OUT}/>`; break; // 기타: 모양이 일정치 않은 것
  }
  return `<svg viewBox="0 0 100 64" aria-hidden="true">${body}<text x="50" y="${ty}" text-anchor="middle" font-size="14" font-weight="800" fill="#fde68a" font-family="Pretendard,Malgun Gothic,sans-serif">${name}</text></svg>`;
}

// ---------- 제형 그림 ----------
const TAB = '#f1f5f9', TAB2 = '#cbd5e1', LINE = '#64748b';

const capsule = (c1, c2, ang = -28) => `<g transform="rotate(${ang} 50 32)">
  <path d="M50 18 H30 a14 14 0 0 0 0 28 H50 Z" fill="${c1}"/><path d="M50 18 H70 a14 14 0 0 1 0 28 H50 Z" fill="${c2}"/>
  <rect x="48" y="18" width="4" height="28" fill="rgba(15,23,42,.18)"/>
  <rect x="26" y="22" width="44" height="4" rx="2" fill="rgba(255,255,255,.55)"/></g>`;

const FORMS = {
  '정제': () => `<circle cx="50" cy="34" r="24" fill="rgba(0,0,0,.25)" transform="translate(2 3)"/><circle cx="50" cy="32" r="24" fill="${TAB}"/><circle cx="50" cy="32" r="20" fill="none" stroke="${TAB2}" stroke-width="2"/><line x1="33" y1="39" x2="67" y2="25" stroke="${LINE}" stroke-width="2.5"/>`,
  '경질캡슐': () => capsule('#f8fafc', '#facc15'),
  '연질캡슐': () => `<defs><radialGradient id="${nid('g')}" cx=".35" cy=".3"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></radialGradient></defs>
    <ellipse cx="50" cy="32" rx="34" ry="19" fill="url(#g${uid})"/><ellipse cx="50" cy="32" rx="34" ry="19" fill="none" stroke="rgba(180,83,9,.5)" stroke-width="1.5"/>
    <path d="M18 32 H82" stroke="rgba(180,83,9,.35)" stroke-width="1.5" stroke-dasharray="2 3"/><ellipse cx="38" cy="23" rx="12" ry="4.5" fill="rgba(255,255,255,.7)" transform="rotate(-12 38 23)"/>`,
  '필름코팅정': () => `<ellipse cx="50" cy="32" rx="34" ry="20" fill="#bfdbfe"/><ellipse cx="50" cy="32" rx="34" ry="20" fill="none" stroke="#60a5fa" stroke-width="2.5"/><path d="M26 25 Q40 15 58 20" stroke="rgba(255,255,255,.9)" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  '나정': () => `<circle cx="50" cy="32" r="24" fill="#e2e8f0"/>${[[40, 24], [58, 28], [46, 40], [60, 40], [36, 36], [52, 22], [64, 32]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#94a3b8"/>`).join('')}`,
  '서방형': () => `<circle cx="38" cy="32" r="22" fill="${TAB}"/><circle cx="38" cy="32" r="15" fill="none" stroke="#38bdf8" stroke-width="3"/><circle cx="38" cy="32" r="7" fill="none" stroke="#38bdf8" stroke-width="3"/><path d="M66 32 H90 M82 24 L90 32 L82 40" stroke="#facc15" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  '장용형': () => `<circle cx="50" cy="32" r="24" fill="#16a34a"/><circle cx="50" cy="32" r="17" fill="${TAB}"/><text x="50" y="38" text-anchor="middle" font-size="17" font-weight="900" fill="#166534" font-family="Pretendard,Malgun Gothic,sans-serif">장</text>`,
  '당의정': () => `<ellipse cx="50" cy="52" rx="22" ry="5" fill="rgba(0,0,0,.28)"/><circle cx="50" cy="30" r="24" fill="#f9a8d4"/><circle cx="50" cy="30" r="24" fill="none" stroke="#ec4899" stroke-width="2"/><ellipse cx="41" cy="19" rx="9" ry="5" fill="rgba(255,255,255,.75)" transform="rotate(-25 41 19)"/>`,
  '구강붕해': () => `<circle cx="36" cy="32" r="20" fill="${TAB}" stroke="#a78bfa" stroke-width="2" stroke-dasharray="4 3"/>${[[62, 22], [70, 30], [64, 38], [76, 24], [78, 38], [86, 32]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${2.6 - i * 0.2}" fill="#a78bfa"/>`).join('')}`,
  '츄어블': () => { const m = nid('m'); return `<defs><mask id="${m}"><rect width="100" height="64" fill="#fff"/><circle cx="68" cy="20" r="9" fill="#000"/><circle cx="76" cy="30" r="7" fill="#000"/></mask></defs><circle cx="50" cy="32" r="25" fill="#fcd34d" mask="url(#${m})"/>`; },
  '다층정': () => `<rect x="14" y="12" width="72" height="40" rx="14" fill="${TAB}"/><clipPath id="${nid('c')}"><rect x="14" y="12" width="72" height="40" rx="14"/></clipPath><g clip-path="url(#c${uid})"><rect x="14" y="12" width="72" height="13" fill="#fb7185"/><rect x="14" y="25" width="72" height="14" fill="#fde68a"/><rect x="14" y="39" width="72" height="13" fill="#7dd3fc"/></g>`,
};

export const FORM_DESC = {
  '정제': '가루를 눌러 굳힌 알약. 동글납작한 대부분의 알약',
  '경질캡슐': '단단한 껍데기 두 조각(뚜껑+몸통)이 끼워진 캡슐. 가운데 이음선, 안에 가루·알갱이',
  '연질캡슐': '말랑한 젤리 같은 한 덩어리. 투명·반투명하고 안에 기름·액체',
  '필름코팅정': '얇은 막으로 코팅해 매끈하고 윤기 나는 알약',
  '나정': '코팅이 없는 알약. 겉이 거칠고 윤기 없음',
  '서방형': '천천히 녹아 효과가 오래가게 만든 약',
  '장용형': '위가 아닌 장에서 녹도록 겉을 코팅한 약',
  '당의정': '설탕으로 두껍게 코팅한 동글동글한 알약',
  '구강붕해': '물 없이 입안에서 녹는 알약',
  '츄어블': '씹어서 먹는 알약',
  '다층정': '단면이 여러 겹(층)으로 된 알약',
};

export function formSvg(name) {
  const f = FORMS[name];
  return `<svg viewBox="0 0 100 64" aria-hidden="true">${f ? f() : ''}</svg>`;
}

// 그림 + 이름 + 설명이 있는 제형 타일
export function formTile(name, attr, extra = '') {
  return `<button class="tile form" ${attr}="${name}" ${extra}>${formSvg(name)}<span class="nm">${name}</span><span class="cap">${FORM_DESC[name] || ''}</span></button>`;
}
export function shapeTile(name, attr, extra = '') {
  return `<button class="tile shape" ${attr}="${name}" aria-label="${name}" ${extra}>${shapeSvg(name)}</button>`;
}
