// Server-side Hugging Face pronunciation scoring. HF_TOKEN never reaches the browser.
const SUPABASE_URL = 'https://xnwfzpbbaburejxwszqn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GtSF7KWERy3oNbFYmUah7w_GL64Yxrs';
const PHONEME_MODEL = 'facebook/wav2vec2-lv-60-espeak-cv-ft';
const TRANSCRIPT_MODEL = 'openai/whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('pragma', 'no-cache');
  res.end(JSON.stringify(body));
}

function status(score) { return score >= 75 ? 'good' : score >= 50 ? 'warn' : 'wrong'; }

function normalizePhones(value) {
  let text = String(value || '').toLocaleLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ˈˌ'’]/g, '')
    .replace(/[ːˑ]/g, '')
    .replace(/[.\/\[\],|]/g, ' ')
    .replace(/t͡ʃ|t͜ʃ/g, 'tʃ')
    .replace(/d͡ʒ|d͜ʒ/g, 'dʒ')
    .replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const pairs = new Set(['tʃ', 'dʒ', 'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ', 'ɪə', 'eə', 'ʊə', 'ɜr', 'ɑr', 'ɔr']);
  const tokenize = part => {
    const chars = Array.from(part.normalize('NFC'));
    const result = [];
    for (let i = 0; i < chars.length;) {
      const pair = chars[i] + (chars[i + 1] || '');
      if (pairs.has(pair)) { result.push(pair); i += 2; }
      else { result.push(chars[i]); i++; }
    }
    return result;
  };
  return text.includes(' ') ? text.split(' ').flatMap(tokenize) : tokenize(text);
}

function nearPhone(expected, spoken) {
  const pairs = new Set(['ɪ:i', 'i:ɪ', 'ʊ:u', 'u:ʊ', 'æ:ɛ', 'ɛ:æ', 'θ:t', 't:θ', 'θ:s', 's:θ', 'ð:d', 'd:ð', 'ə:ʌ', 'ʌ:ə']);
  return pairs.has(expected + ':' + spoken);
}

function alignPhones(expected, spoken) {
  const rows = expected.length + 1, cols = spoken.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (expected[i - 1] === spoken[j - 1] ? 0 : 1));
  }
  const phones = Array.from(expected, (phone, index) => ({ expected: phone, spoken: '', score: 0, status: 'wrong', index }));
  let i = expected.length, j = spoken.length, exact = 0, deletions = 0, insertions = 0;
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (expected[i - 1] === spoken[j - 1] ? 0 : 1)) {
      const score = expected[i - 1] === spoken[j - 1] ? 100 : nearPhone(expected[i - 1], spoken[j - 1]) ? 60 : 20;
      phones[i - 1] = { expected: expected[i - 1], spoken: spoken[j - 1], score, status: status(score), index: i - 1 };
      if (score === 100) exact++;
      i--; j--;
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) {
      phones[i - 1] = { expected: expected[i - 1], spoken: '', score: 0, status: 'wrong', index: i - 1 };
      deletions++; i--;
    } else { insertions++; j--; }
  }
  const accuracy = phones.length ? phones.reduce((sum, phone) => sum + phone.score, 0) / phones.length : 0;
  const completeness = phones.length ? Math.max(0, 100 * (phones.length - deletions) / Math.max(phones.length, spoken.length)) : 0;
  return { phones: phones.map(({ index, ...phone }) => phone), accuracy, completeness, score: Math.round(accuracy * 0.85 + completeness * 0.15), exact };
}

function letterGroups(word) {
  const text = String(word || '');
  const patterns = ['tion', 'sion', 'tch', 'dge', 'igh', 'eigh', 'ough', 'ph', 'sh', 'ch', 'th', 'wh', 'ck', 'ng', 'qu', 'ee', 'ea', 'oo', 'ou', 'ow', 'oi', 'oy', 'ai', 'ay', 'au', 'aw', 'er', 'ir', 'ur', 'ar', 'or'];
  const groups = [];
  for (let i = 0; i < text.length;) {
    if (!/[a-z]/i.test(text[i])) { groups.push({ start: i, end: i + 1, neutral: true }); i++; continue; }
    const match = patterns.find(pattern => text.slice(i, i + pattern.length).toLowerCase() === pattern);
    const size = match ? match.length : 1;
    groups.push({ start: i, end: i + size }); i += size;
  }
  return groups;
}

function alignTranscript(reference, transcript) {
  const a = Array.from(String(reference || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const b = Array.from(String(transcript || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const rows = a.length + 1, cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const scores = Array(a.length).fill(0);
  let i = a.length, j = b.length, exact = 0;
  while (i || j) {
    if (i && j && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      scores[i - 1] = a[i - 1] === b[j - 1] ? 100 : 20;
      if (scores[i - 1] === 100) exact++;
      i--; j--;
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) { scores[i - 1] = 0; i--; }
    else j--;
  }
  const chars = [];
  let index = 0;
  for (const char of Array.from(String(reference || ''))) {
    if (/[a-z0-9]/i.test(char)) {
      const score = scores[index++] || 0;
      chars.push({ char, score, status: status(score) });
    } else chars.push({ char, score: null, status: 'neutral' });
  }
  const accuracy = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const completeness = scores.length ? exact * 100 / Math.max(scores.length, b.length) : 0;
  return { characters: chars, accuracy, completeness, score: Math.round(accuracy * 0.85 + completeness * 0.15) };
}

function responseText(data) {
  if (typeof data?.text === 'string') return data.text.trim();
  if (Array.isArray(data)) return data.map(item => item?.text || '').join(' ').trim();
  return '';
}

async function callModel(model, audio, token) {
  const response = await fetch('https://router.huggingface.co/hf-inference/models/' + model, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'audio/wav' },
    body: audio,
    signal: AbortSignal.timeout(26000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Dịch vụ nhận diện giọng nói chưa sẵn sàng (' + response.status + ').');
  const text = responseText(data);
  if (!text) throw new Error('Mô hình không nhận được lời đọc.');
  return text;
}

async function verifyUser(authorization) {
  if (!/^Bearer\s+\S+$/i.test(authorization)) return false;
  const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization },
    signal: AbortSignal.timeout(5000)
  });
  return response.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return reply(res, 405, { error: 'Chỉ hỗ trợ yêu cầu POST.' });
  }
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return reply(res, 403, { error: 'Yêu cầu không hợp lệ.' }); }
    catch (_) { return reply(res, 403, { error: 'Yêu cầu không hợp lệ.' }); }
  }
  try {
    if (!await verifyUser(String(req.headers.authorization || ''))) return reply(res, 401, { error: 'Hãy đăng nhập để dùng chấm phát âm chính xác.' });
  } catch (_) { return reply(res, 503, { error: 'Không kiểm tra được phiên đăng nhập lúc này.' }); }
  const token = String(process.env.HF_TOKEN || '').trim();
  if (!token) return reply(res, 503, { error: 'Chưa cấu hình HF_TOKEN trên Vercel; đang dùng nhận diện dự phòng.' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); }
  catch (_) { return reply(res, 400, { error: 'Dữ liệu âm thanh không hợp lệ.' }); }
  if (!body || typeof body !== 'object') return reply(res, 400, { error: 'Dữ liệu âm thanh không hợp lệ.' });
  const encoded = String(body.audioBase64 || '');
  const referenceText = String(body.referenceText || '').trim().slice(0, 80);
  const referenceIpa = String(body.referenceIpa || '').trim().slice(0, 120);
  if (!referenceText || !encoded || encoded.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8) {
    return reply(res, 400, { error: 'Thiếu từ cần chấm hoặc tệp âm thanh quá lớn.' });
  }
  if (!/^audio\/wav$/i.test(String(body.contentType || ''))) return reply(res, 415, { error: 'Chỉ hỗ trợ âm thanh WAV 16 kHz.' });
  let audio;
  try { audio = Buffer.from(encoded, 'base64'); }
  catch (_) { return reply(res, 400, { error: 'Không đọc được tệp âm thanh.' }); }
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) return reply(res, 413, { error: 'Tệp âm thanh vượt quá giới hạn.' });

  if (referenceIpa) {
    try {
      const spokenIpa = await callModel(PHONEME_MODEL, audio, token);
      const expected = normalizePhones(referenceIpa);
      const spoken = normalizePhones(spokenIpa);
      if (expected.length && spoken.length) {
        const aligned = alignPhones(expected, spoken);
        const characters = Array.from(referenceText, char => ({ char, score: null, status: 'neutral' }));
        const groups = letterGroups(referenceText).filter(group => !group.neutral);
        groups.forEach((group, index) => {
          const phoneIndex = Math.min(aligned.phones.length - 1, Math.floor((index + 0.5) * aligned.phones.length / Math.max(1, groups.length)));
          const phone = aligned.phones[phoneIndex];
          for (let charIndex = group.start; charIndex < group.end; charIndex++) if (characters[charIndex] && phone) {
            characters[charIndex] = { char: characters[charIndex].char, score: phone.score, status: phone.status, phoneme: phone.expected };
          }
        });
        return reply(res, 200, {
          score: aligned.score,
          accuracy: Math.round(aligned.accuracy * 100) / 100,
          completeness: Math.round(aligned.completeness * 100) / 100,
          transcript: spokenIpa,
          characters,
          phonemes: aligned.phones,
          source: 'hf-phoneme',
          note: 'Đối chiếu âm vị do mô hình Hugging Face nhận diện; điểm số là mức tham khảo.'
        });
      }
    } catch (error) {
      return reply(res, 502, { error: error?.message || 'Mô hình chấm âm vị chưa sẵn sàng.' });
    }
  }

  try {
    const transcript = await callModel(TRANSCRIPT_MODEL, audio, token);
    const aligned = alignTranscript(referenceText, transcript);
    return reply(res, 200, {
      score: aligned.score,
      accuracy: Math.round(aligned.accuracy * 100) / 100,
      completeness: Math.round(aligned.completeness * 100) / 100,
      transcript,
      characters: aligned.characters,
      phonemes: [],
      source: 'hf-transcript',
      note: 'Ước lượng theo từ Whisper nhận diện; đây không phải điểm chấm âm vị.'
    });
  } catch (error) {
    return reply(res, 502, { error: error?.message || 'Không thể kết nối dịch vụ nhận diện phát âm.' });
  }
}
