/* Pronunciation assessment adapter for Chill English Quiz.
   Azure provides phoneme-level feedback; Web Speech is an explicitly approximate fallback. */
(function (root) {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const clean = value => String(value || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  function alignText(reference, spoken) {
    const a = Array.from(clean(reference));
    const b = Array.from(clean(spoken));
    if (!a.length || !b.length) return { score: 0, characters: a.map(char => ({ char, score: 0, status: 'wrong' })) };
    const rows = a.length + 1, cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i++) dp[i][0] = i;
    for (let j = 0; j < cols; j++) dp[0][j] = j;
    for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const scores = Array(a.length).fill(0);
    let i = a.length, j = b.length, matches = 0;
    while (i || j) {
      if (i && j && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
        if (a[i - 1] === b[j - 1]) { scores[i - 1] = 100; matches++; }
        else scores[i - 1] = 25;
        i--; j--;
      } else if (i && dp[i][j] === dp[i - 1][j] + 1) { scores[i - 1] = 0; i--; }
      else { j--; }
    }
    const characters = [];
    let index = 0;
    for (const char of Array.from(String(reference || ''))) {
      if (/[a-z0-9]/i.test(char)) {
        const score = scores[index++] || 0;
        characters.push({ char, score, status: score >= 75 ? 'good' : score >= 45 ? 'warn' : 'wrong' });
      } else characters.push({ char, score: null, status: 'neutral' });
    }
    return { score: Math.round((matches / Math.max(a.length, b.length)) * 100), characters };
  }

  function groupLetters(word) {
    const text = String(word || '');
    const groups = [];
    const patterns = ['tion', 'sion', 'tch', 'dge', 'igh', 'eigh', 'ough', 'ph', 'sh', 'ch', 'th', 'wh', 'ck', 'ng', 'qu', 'ee', 'ea', 'oo', 'ou', 'ow', 'oi', 'oy', 'ai', 'ay', 'au', 'aw', 'er', 'ir', 'ur', 'ar', 'or'];
    for (let i = 0; i < text.length;) {
      if (!/[a-z]/i.test(text[i])) { groups.push({ text: text[i], start: i, end: i + 1, neutral: true }); i++; continue; }
      const match = patterns.find(pattern => text.slice(i, i + pattern.length).toLowerCase() === pattern);
      const size = match ? match.length : 1;
      groups.push({ text: text.slice(i, i + size), start: i, end: i + size });
      i += size;
    }
    return groups;
  }

  function parseAzureResult(result, reference) {
    let raw = '';
    try { raw = result.properties.getProperty(root.SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult); } catch (_) {}
    if (!raw && result.json) raw = result.json;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const best = data?.NBest?.[0] || {};
    const assessment = best.PronunciationAssessment || {};
    const word = best.Words?.[0] || {};
    const wordAssessment = word.PronunciationAssessment || {};
    const accuracy = Number(assessment.AccuracyScore ?? wordAssessment.AccuracyScore);
    if (!Number.isFinite(accuracy)) throw new Error('Azure không trả về điểm phát âm cho từ này.');
    const completeness = Number.isFinite(Number(assessment.CompletenessScore)) ? Number(assessment.CompletenessScore) : 100;
    const score = clamp(Math.round((accuracy * 0.85 + completeness * 0.15) * 100) / 100, 0, 100);
    const phonemes = (word.Phonemes || []).map(item => {
      const detail = item.PronunciationAssessment || {};
      const spoken = detail.NBestPhonemes?.[0]?.Phoneme || '';
      const value = Number(detail.AccuracyScore);
      const phonemeScore = Number.isFinite(value) ? clamp(value, 0, 100) : 0;
      return { expected: String(item.Phoneme || ''), spoken: String(spoken), score: phonemeScore, status: phonemeScore >= 75 ? 'good' : phonemeScore >= 50 ? 'warn' : 'wrong' };
    });
    const groups = groupLetters(reference);
    const characters = Array.from(String(reference || ''), char => ({ char, score: null, status: 'neutral' }));
    const scoredGroups = groups.filter(group => !group.neutral);
    scoredGroups.forEach((group, index) => {
      const phoneIndex = Math.min(phonemes.length - 1, Math.floor((index + 0.5) * phonemes.length / Math.max(1, scoredGroups.length)));
      const phone = phonemes[phoneIndex];
      for (let charIndex = group.start; charIndex < group.end; charIndex++) {
        if (characters[charIndex] && phone) characters[charIndex] = { ...characters[charIndex], score: phone.score, status: phone.status, phoneme: phone.expected };
      }
    });
    return {
      score,
      accuracy: clamp(accuracy, 0, 100),
      completeness: clamp(completeness, 0, 100),
      transcript: String(best.Display || best.Lexical || result.text || ''),
      characters,
      phonemes,
      source: 'azure-phoneme',
      note: 'Điểm âm vị từ Azure Speech. Màu chữ là ánh xạ tham khảo; xem các thẻ IPA để biết điểm âm trực tiếp.'
    };
  }

  function loadSpeechSDK() {
    if (root.SpeechSDK) return Promise.resolve(root.SpeechSDK);
    if (root.__chillSpeechSdkPromise) return root.__chillSpeechSdkPromise;
    root.__chillSpeechSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://aka.ms/csspeech/jsbrowserpackage';
      script.async = true;
      script.onload = () => root.SpeechSDK ? resolve(root.SpeechSDK) : reject(new Error('Không tải được bộ nhận diện phát âm.'));
      script.onerror = () => reject(new Error('Không tải được bộ nhận diện phát âm.'));
      document.head.appendChild(script);
    });
    return root.__chillSpeechSdkPromise;
  }

  async function fetchSpeechToken(accessToken) {
    const response = await fetch('/api/speech-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      cache: 'no-store',
      body: '{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token || !data.region) throw new Error(data.error || 'Chấm âm vị chưa được cấu hình.');
    return data;
  }

  async function openMicrophone(onLevel) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt này không mở được micro. Hãy dùng Safari hoặc Chrome trên HTTPS.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let context, analyser, raf = 0;
    try {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (AudioContext && onLevel) {
        context = new AudioContext();
        await context.resume().catch(() => {});
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) { const delta = (value - 128) / 128; sum += delta * delta; }
          onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
          raf = requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (_) {}
    return {
      stream,
      stop() {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach(track => track.stop());
        if (context) context.close().catch(() => {});
        if (onLevel) onLevel(0);
      }
    };
  }

  function azureRecognize(sdk, tokenInfo, stream, reference, accent) {
    return new Promise((resolve, reject) => {
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(tokenInfo.token, tokenInfo.region);
      speechConfig.speechRecognitionLanguage = accent === 'British' ? 'en-GB' : 'en-US';
      const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      const config = sdk.PronunciationAssessmentConfig.fromJSON(JSON.stringify({
        referenceText: reference,
        gradingSystem: 'HundredMark',
        granularity: 'Phoneme',
        enableMiscue: true,
        phonemeAlphabet: 'IPA',
        nbestPhonemeCount: 3
      }));
      config.applyTo(recognizer);
      let settled = false;
      const timer = setTimeout(() => finish(new Error('Chấm phát âm mất quá lâu. Hãy thử lại nơi mạng ổn định hơn.')), 18000);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { recognizer.close(); } catch (_) {}
        try { audioConfig.close(); } catch (_) {}
        try { speechConfig.close(); } catch (_) {}
        try { config.close(); } catch (_) {}
        if (error) reject(error);
        else {
          try { resolve(parseAzureResult(result, reference)); }
          catch (parseError) { reject(parseError); }
        }
      };
      recognizer.recognizeOnceAsync(result => {
        if (result.reason === sdk.ResultReason.Canceled) finish(new Error(result.errorDetails || 'Dịch vụ chấm phát âm đã hủy lượt này.'));
        else finish(null, result);
      }, error => finish(new Error(String(error || 'Không nhận được kết quả phát âm.'))));
    });
  }

  function browserRecognize(reference, accent) {
    return new Promise((resolve, reject) => {
      const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
      if (!Recognition) return reject(new Error('Trình duyệt này chưa hỗ trợ nhận diện giọng nói. Nếu đang mở trong Zalo/Facebook, hãy chọn Mở bằng Safari hoặc Chrome mới nhất.'));
      const recognition = new Recognition();
      recognition.lang = accent === 'British' ? 'en-GB' : 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      let done = false;
      const timer = setTimeout(() => { try { recognition.stop(); } catch (_) {} finish(new Error('Không nghe rõ giọng nói. Hãy thử lại ở nơi yên tĩnh hơn.')); }, 9000);
      const finish = (error, transcript) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error);
        else {
          const aligned = alignText(reference, transcript);
          resolve({ ...aligned, accuracy: aligned.score, completeness: aligned.score, transcript, phonemes: [], source: 'browser-transcript', note: 'Ước lượng từ bản nhận diện của trình duyệt; đây không phải điểm chấm âm vị.' });
        }
      };
      recognition.onresult = event => finish(null, event.results?.[0]?.[0]?.transcript || '');
      recognition.onerror = event => finish(new Error(event.error === 'not-allowed' ? 'Bạn chưa cấp quyền micro. Hãy bật quyền trong cài đặt trình duyệt; nếu đang mở trong Zalo/Facebook, hãy mở trang bằng Safari hoặc Chrome.' : event.error === 'audio-capture' ? 'Không tìm thấy micro trên thiết bị.' : 'Trình duyệt chưa nhận rõ từ vừa đọc. Hãy thử lại.'));
      recognition.onend = () => { if (!done) finish(new Error('Không nghe thấy câu trả lời. Hãy thử lại.')); };
      try { recognition.start(); } catch (error) { finish(error); }
    });
  }

  async function assess(reference, options = {}) {
    const word = String(reference || '').trim();
    if (!word) throw new Error('Không tìm thấy từ cần đọc.');
    const onLevel = typeof options.onLevel === 'function' ? options.onLevel : null;
    let tokenInfo = null;
    try { tokenInfo = await fetchSpeechToken(options.accessToken || ''); } catch (_) {}
    let microphone = null;
    try {
      microphone = await openMicrophone(onLevel);
      if (tokenInfo) {
        try {
          const sdk = await loadSpeechSDK();
          return await azureRecognize(sdk, tokenInfo, microphone.stream, word, options.accent);
        } catch (_) {
          // Azure is optional until the Vercel Speech resource has been configured; use a clearly labeled transcript estimate.
        }
      }
      return await browserRecognize(word, options.accent);
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw new Error('Micro chưa được cấp quyền. Hãy bật quyền Micro và dùng kết nối HTTPS. Nếu đang mở trong Zalo/Facebook, hãy chọn Mở bằng Safari hoặc Chrome.');
      throw error;
    } finally {
      microphone?.stop();
    }
  }

  root.ChillPronunciation = { assess, alignText, loadSpeechSDK };
})(window);
