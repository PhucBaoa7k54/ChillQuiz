// Issues short-lived Azure Speech tokens only to signed-in Chill English users.
// Keep AZURE_SPEECH_KEY in Vercel Environment Variables; never expose it to the browser.
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
    } catch (_) {
      return reply(res, 403, { error: 'Yêu cầu không hợp lệ.' });
    }
  }

  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return reply(res, 401, { error: 'Hãy đăng nhập để dùng chấm phát âm chính xác.' });
  }

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization },
      signal: AbortSignal.timeout(5000)
    });
    if (!userResponse.ok) return reply(res, 401, { error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
  } catch (_) {
    return reply(res, 503, { error: 'Không kiểm tra được phiên đăng nhập lúc này.' });
  }

  const key = process.env.AZURE_SPEECH_KEY;
  const region = String(process.env.AZURE_SPEECH_REGION || '').trim().toLowerCase();
  if (!key || !/^[a-z0-9]+$/.test(region)) {
    return reply(res, 503, { error: 'Chưa cấu hình Azure Speech trên Vercel; đang chuyển sang chế độ nhận diện ước lượng.' });
  }

  try {
    const response = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return reply(res, 502, { error: 'Azure Speech chưa cấp được phiên chấm phát âm.' });
    const token = await response.text();
    if (!token) return reply(res, 502, { error: 'Azure Speech trả về phiên rỗng.' });
    return reply(res, 200, { token, region });
  } catch (_) {
    return reply(res, 502, { error: 'Chưa kết nối được Azure Speech. Đang dùng chế độ nhận diện ước lượng.' });
  }
}
