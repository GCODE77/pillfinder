// Supabase 공유 학습: "이 약 맞아요" 지문을 모두가 같이 쓰도록 올리고 내려받는다. (SDK 없이 REST)
// 표: confirmations(id, item_seq text, device text, d text, created_at timestamptz default now())
const cfg = () => (typeof window !== 'undefined' && window.PF_CONFIG) || {};
export const enabled = () => !!(cfg().supabaseUrl && cfg().anonKey);
const hdr = () => ({ apikey: cfg().anonKey, Authorization: 'Bearer ' + cfg().anonKey, 'Content-Type': 'application/json' });
const base = () => cfg().supabaseUrl.replace(/\/+$/, '') + '/rest/v1/confirmations';

export function deviceId(store) {
  let id = store.get('pf.device', null);
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); store.set('pf.device', id); }
  return id;
}

// 올리기: 실패해도 앱 동작에는 영향 없음
export async function upload(rows) {
  if (!enabled() || !rows.length) return false;
  try {
    const r = await fetch(base(), { method: 'POST', headers: { ...hdr(), Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    return r.ok;
  } catch { return false; }
}

// 내려받기: 서로 다른 기기 2대 이상이 같은 약으로 확인한 것만 채택(장난·오입력 방지), 약당 최대 6장
export async function download() {
  if (!enabled()) return null;
  try {
    const r = await fetch(base() + '?select=item_seq,device,d&order=created_at.desc&limit=1500', { headers: hdr() });
    if (!r.ok) return null;
    const rows = await r.json();
    const by = new Map();
    for (const x of rows) {
      if (!x.item_seq || !x.d || x.d.length > 3000) continue;
      let g = by.get(x.item_seq); if (!g) by.set(x.item_seq, (g = { devs: new Set(), list: [] }));
      g.devs.add(x.device); g.list.push(x.d);
    }
    const out = [];
    for (const [s, g] of by) if (g.devs.size >= 2) for (const d of g.list.slice(0, 6)) out.push({ s, d });
    return out;
  } catch { return null; }
}
