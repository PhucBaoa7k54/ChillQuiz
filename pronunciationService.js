/* Pronunciation adapter for Chill English Quiz. Detailed scoring runs on the server; browser speech is a clearly labeled fallback. */
(function (root) {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const clean = value => String(value || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  function alignText(reference, spoken) {
    const a = Array.from(clean(reference));
    const b = Array.from(clean(spoken));
    if (!a.length || !b.length) return { score: 0, characters: Array.from(String(reference || ''), char => ({ char, score: 0, status: 'wrong' })) };
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

  async function openMicrophone(onLevel) {
    if (!root.navigator?.mediaDevices?.getUserMedia) throw new Error('Trình duyệt này không mở được micro. Hãy dùng Safari hoặc Chrome trên HTTPS.');
    const stream = await root.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    let context, analyser, raf = 0, currentLevel = 0, stopped = false;
    try {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (AudioContext) {
        context = new AudioContext();
        await context.resume().catch(() => {});
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (stopped || !analyser) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) { const delta = (value - 128) / 128; sum += delta * delta; }
          currentLevel = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
          if (onLevel) onLevel(currentLevel);
          raf = root.requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (_) {}
    return {
      stream,
      level: () => currentLevel,
      stop() {
        if (stopped) return;
        stopped = true;
        root.cancelAnimationFrame(raf);
        stream.getTracks().forEach(track => track.stop());
        if (context) context.close().catch(() => {});
        if (onLevel) onLevel(0);
      }
    };
  }

  function recordAudio(microphone) {
    return new Promise((resolve, reject) => {
      if (!root.MediaRecorder) return reject(new Error('Thu âm chưa được hỗ trợ trong trình duyệt này.'));
      let recorder;
      try {
        const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
        const mimeType = types.find(type => root.MediaRecorder.isTypeSupported?.(type));
        recorder = new root.MediaRecorder(microphone.stream, mimeType ? { mimeType } : undefined);
      } catch (_) { return reject(new Error('Không thể bắt đầu thu âm trên thiết bị này.')); }
      const chunks = [];
      const startedAt = Date.now();
      let firstVoiceAt = 0, lastVoiceAt = 0, timer = 0, settled = false, failure = null;
      const finish = error => {
        if (settled) return;
        failure = error || null;
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (_) { settle(); }
        } else settle();
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        if (failure) return reject(failure);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 1000) return reject(new Error('Chưa thu được âm thanh rõ. Hãy thử lại.'));
        resolve(blob);
      };
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => finish(new Error('Không thể thu âm. Hãy thử lại.'));
      recorder.onstop = settle;
      try { recorder.start(160); } catch (_) { return reject(new Error('Không thể bắt đầu thu âm trên thiết bị này.')); }
      timer = setInterval(() => {
        const now = Date.now();
        const level = microphone.level();
        if (level >= 0.045) {
          if (!firstVoiceAt) firstVoiceAt = now;
          lastVoiceAt = now;
        }
        if ((firstVoiceAt && now - firstVoiceAt > 320 && now - lastVoiceAt > 850) || now - startedAt >= 6800) finish();
      }, 100);
    });
  }

  async function toWav16k(blob) {
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) throw new Error('Thiết bị chưa hỗ trợ chuyển đổi âm thanh.');
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const sourceRate = decoded.sampleRate;
      const length = Math.max(1, Math.ceil(decoded.duration * 16000));
      const bytes = new ArrayBuffer(44 + length * 2);
      const view = new DataView(bytes);
      const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE');
      write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
      for (let i = 0; i < length; i++) {
        const position = i * sourceRate / 16000;
        const left = Math.min(Math.floor(position), channels[0].length - 1);
        const right = Math.min(left + 1, channels[0].length - 1);
        const mix = position - left;
        let sample = 0;
        for (const channel of channels) sample += channel[left] * (1 - mix) + channel[right] * mix;
        sample /= channels.length;
        const value = Math.max(-1, Math.min(1, sample));
        view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
      }
      return new Blob([bytes], { type: 'audio/wav' });
    } finally {
      context.close().catch(() => {});
    }
  }

  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
    return root.btoa(binary);
  }

  async function assessOnServer(blob, reference, options) {
    const audioBase64 = await blobToBase64(blob);
    const response = await root.fetch('/api/assess-pronunciation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + options.accessToken },
      body: JSON.stringify({
        audioBase64,
        contentType: 'audio/wav',
        referenceText: reference,
        referenceIpa: String(options.referenceIpa || ''),
        accent: options.accent || 'American'
      }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Number.isFinite(Number(data.score))) throw new Error(data.error || 'Chưa nhận được kết quả từ máy chủ chấm phát âm.');
    return data;
  }

  function browserRecognize(reference, accent) {
    return new Promise((resolve, reject) => {
      const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
      if (!Recognition) return reject(new Error('Chấm phát âm trực tuyến chưa sẵn sàng và trình duyệt không hỗ trợ nhận diện giọng nói. Hãy thử lại sau.'));
      const recognition = new Recognition();
      recognition.lang = accent === 'British' ? 'en-GB' : 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      let done = false;
      const finish = (error, transcript) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error);
        else {
          const aligned = alignText(reference, transcript);
          resolve({ ...aligned, accuracy: aligned.score, completeness: aligned.score, transcript, phonemes: [], source: 'browser-fallback', note: 'Ước lượng từ nhận diện của trình duyệt; đây không phải điểm chấm âm vị.' });
        }
      };
      const timer = setTimeout(() => { try { recognition.stop(); } catch (_) {} finish(new Error('Không nghe rõ giọng nói. Hãy thử lại ở nơi yên tĩnh hơn.')); }, 9000);
      recognition.onresult = event => finish(null, event.results?.[0]?.[0]?.transcript || '');
      recognition.onerror = event => finish(new Error(event.error === 'not-allowed' ? 'Bạn chưa cấp quyền micro. Hãy bật quyền trong cài đặt trình duyệt; nếu đang mở trong Zalo/Facebook, hãy mở trang bằng Safari hoặc Chrome.' : event.error === 'audio-capture' ? 'Không tìm thấy micro trên thiết bị.' : 'Trình duyệt chưa nhận rõ từ vừa đọc. Hãy thử lại.'));
      recognition.onend = () => { if (!done) finish(new Error('Không nghe thấy câu trả lời. Hãy thử lại.')); };
      try { recognition.start(); } catch (error) { finish(error); }
    });
  }

  async function assess(reference, options = {}) {
    const word = String(reference || '').trim();
    if (!word) throw new Error('Không tìm thấy từ cần đọc.');
    if (!options.accessToken) return browserRecognize(word, options.accent);
    const onLevel = typeof options.onLevel === 'function' ? options.onLevel : null;
    let microphone = null;
    try {
      microphone = await openMicrophone(onLevel);
      const recording = await recordAudio(microphone);
      const wav = await toWav16k(recording);
      return await assessOnServer(wav, word, options);
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        throw new Error('Micro chưa được cấp quyền. Hãy bật quyền Micro và dùng kết nối HTTPS. Nếu đang mở trong Zalo/Facebook, hãy chọn Mở bằng Safari hoặc Chrome.');
      }
      if (/Chưa cấp quyền micro|không tìm thấy micro/i.test(String(error?.message || ''))) throw error;
    } finally {
      microphone?.stop();
    }
    return browserRecognize(word, options.accent);
  }

  root.ChillPronunciation = { assess, alignText };
})(window);
