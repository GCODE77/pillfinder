// (선택 기능) AI 판독 — 사용자가 설정에 넣은 본인 Claude API 키로 약 사진을 읽어 각인·색·모양을 받는다.
// 키는 이 기기 localStorage에만 저장되고, 요청은 브라우저에서 Anthropic API로 바로 간다(우리 서버 없음).
// 온디바이스 OCR보다 음각 각인을 훨씬 잘 읽지만, 호출마다 사용자 계정에 요금이 부과된다.

const SHAPES = ['원형', '타원형', '장방형', '반원형', '삼각형', '사각형', '마름모형', '오각형', '육각형', '팔각형', '기타'];
const COLORS = ['하양', '노랑', '주황', '분홍', '빨강', '갈색', '연두', '초록', '청록', '파랑', '남색', '자주', '보라', '회색', '검정', '투명'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_pill', 'imprint_side_a', 'imprint_side_b', 'colors', 'shape', 'score_line', 'confidence', 'note'],
  properties: {
    is_pill: { type: 'boolean', description: '사진에 알약(정제·캡슐)이 보이는지' },
    imprint_side_a: { type: 'string', description: '보이는 면의 각인/인쇄 글자. 대문자, 줄바꿈은 공백. 없으면 빈 문자열' },
    imprint_side_b: { type: 'string', description: '다른 면이 함께 보일 때 그 면의 글자. 없으면 빈 문자열' },
    colors: { type: 'array', items: { type: 'string', enum: COLORS }, description: '주된 색부터 최대 2개' },
    shape: { type: 'string', enum: SHAPES },
    score_line: { type: 'boolean', description: '분할선(가운데 홈)이 보이는지' },
    confidence: { type: 'number', description: '각인 판독 확신도 0~1' },
    note: { type: 'string', description: '로고·그림 마크 등 글자로 못 적은 특징 (한국어, 짧게)' },
  },
};

const PROMPT = `알약 식별을 돕는 중입니다. 사진 속 알약 한 알을 보고 식약처 낱알식별 기준으로 적어 주세요.
- 각인은 음각(새김)이든 인쇄든 보이는 글자·숫자를 그대로 적습니다. 확실하지 않은 글자는 가장 그럴듯한 것으로 적고 confidence를 낮춥니다.
- 거꾸로 찍혔으면 바로 세운 방향으로 읽습니다. 로고·그림은 note에 적습니다.
- 색은 조명 탓 그림자를 무시하고 약 자체의 색으로 고릅니다. 캡슐처럼 두 색이면 두 개를 적습니다.
- 모양 분류: 길쭉하고 끝이 둥근 타원은 타원형, 캡슐·직사각형에 가까운 길쭉한 약은 장방형.`;

let clientP = null, clientKey = '';
async function client(apiKey) {
  if (!clientP || clientKey !== apiKey) {
    clientKey = apiKey;
    clientP = import('./vendor/anthropic-sdk.mjs').then(({ default: Anthropic }) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }));
  }
  return clientP;
}

// jpegs: base64(접두어 없음) 배열. 반환 {is_pill, imprint_side_a, ...} 또는 throw
export async function aiRead({ apiKey, model = 'claude-opus-5-5', jpegs }) {
  const c = await client(apiKey);
  const content = [
    ...jpegs.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    { type: 'text', text: PROMPT },
  ];
  const params = {
    model,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  };
  // Opus/Sonnet 5.5는 안전 분류기가 드물게 거절할 수 있어 서버 측 대체 모델을 켠다(Haiku는 미지원)
  const useFallback = /opus|sonnet|fable/.test(model);
  const res = useFallback
    ? await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await c.messages.create(params);
  if (res.stop_reason === 'refusal') throw new Error('AI가 이 사진의 판독을 거절했습니다');
  if (res.stop_reason === 'max_tokens') throw new Error('AI 응답이 잘렸습니다');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

export function describeAiError(e) {
  const s = e && (e.status || e.statusCode);
  if (s === 401) return 'API 키가 올바르지 않습니다(설정에서 확인)';
  if (s === 429) return 'AI 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요';
  if (s === 400) return 'AI 요청 형식 오류: ' + (e.message || '');
  if (s >= 500) return 'AI 서버가 응답하지 않습니다. 잠시 후 다시 시도하세요';
  return (e && e.message) || String(e);
}
