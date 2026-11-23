// Health check for the server-side Hugging Face pronunciation provider.
const SUPABASE_URL = 'https://xnwfzpbbaburejxwszqn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GtSF7KWERy3oNbFYmUah7w_GL64Yxrs';

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('pragma', 'no-cache');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return reply(res, 405, { error: 'Chỉ hỗ trợ yêu cầu POST.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return reply(res, 403, { error: 'Yêu cầu không hợp lệ.' });
    } catch (_) { return reply(res, 403, { error: 'Yêu cầu không hợp lệ.' }); }
  }
  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(res, 401, { error: 'Hãy đăng nhập để kiểm tra kết nối.' });
  try {
    const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return reply(res, 401, { error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
  } catch (_) { return reply(res, 503, { error: 'Không kiểm tra được phiên đăng nhập lúc này.' }); }
  if (!String(process.env.HF_TOKEN || '').trim()) return reply(res, 503, { error: 'Chưa cấu hình HF_TOKEN trên Vercel.' });
  return reply(res, 200, { ok: true, provider: 'Hugging Face Phoneme AI' });
}
