// Supabase 공유 학습 설정. URL과 anon(publishable) 키만 넣는다(공개용 키 — 행 단위 보안 RLS가 보호).
// 절대 service_role/secret 키나 DB 비밀번호를 넣지 마라. 비워 두면 공유 학습은 꺼지고 이 기기에서만 학습한다.
window.PF_CONFIG = { supabaseUrl: '', anonKey: '' };
