(function () {
  'use strict';

  const NAME_SORTER = new Intl.Collator('vi', { sensitivity: 'accent', numeric: true, ignorePunctuation: false });
  const NAME_MATCHER = new Intl.Collator('vi', { sensitivity: 'base', usage: 'search' });
  const TERM_MATCHER = new Intl.Collator('en', { sensitivity: 'accent', usage: 'search' });
  const SPEECH_RATES = [0.75, 0.9, 1, 1.1, 1.25];
  const MAX_SET_TITLE_LENGTH = 80;
  const STREAK_TIERS = [
    { min: 0, name: 'Ngọn lửa tắt', title: 'Hãy bắt đầu hôm nay' },
    { min: 1, name: 'Ngọn lửa nhỏ', title: 'Ngọn lửa nhỏ' },
    { min: 3, name: 'Ngọn lửa ổn định', title: 'Ngọn lửa ổn định' },
    { min: 7, name: 'Ngọn lửa mạnh', title: 'Ngọn lửa mạnh' },
    { min: 14, name: 'Ngọn lửa rực sáng', title: 'Ngọn lửa rực sáng' },
    { min: 30, name: 'Ngọn lửa đặc biệt', title: 'Ngọn lửa đặc biệt' }
  ];
  const STREAK_MILESTONES = [1, 3, 7, 14, 30];
  const original = {
    addEditCard: window.addEditCard,
    calculateStudyStreak: window.calculateStudyStreak,
    cardEditor: window.cardEditor,
    closeModal: window.closeModal,
    drawFlash: window.drawFlash,
    drawSets: window.drawSets,
    finishActivity: window.finishActivity,
    finishMatch: window.finishMatch,
    launch: window.launch,
    library: window.library,
    load: window.load,
    nav: window.nav,
    openEditor: window.openEditor,
    saveSettings: window.saveSettings,
    settingsPage: window.settingsPage,
    showStreakMilestone: window.showStreakMilestone,
    stepCard: window.stepCard,
    streakFlameMarkup: window.streakFlameMarkup,
    streakWidget: window.streakWidget,
    syncRouteFromHash: window.syncRouteFromHash
  };
  if (!original.drawSets || !original.saveSettings || !original.openEditor) return;

  const style = document.createElement('style');
  style.textContent = '.field-error{display:block;min-height:0;margin:5px 0 0;color:var(--color-error);font-size:var(--text-xs)}.field-error:empty{display:none}input[aria-invalid="true"],textarea[aria-invalid="true"]{border-color:var(--color-error)!important;box-shadow:0 0 0 2px var(--color-error-soft)}.card-error{grid-column:1/-1}.import-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0}.import-summary div{padding:10px;border-radius:12px;background:var(--color-paper-2)}.import-summary strong{display:block;font-size:var(--text-lg)}.confirm-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:9px;margin-top:18px}.confirm-copy{margin:10px 0;color:var(--color-muted)}.speech-button.is-playing{background:var(--color-brand-soft);color:var(--color-brand)}.clear-phrase{max-width:260px}.flame-tier-0 .flame-outer,.flame-tier-0 .flame-mid,.flame-tier-0 .flame-inner{fill:var(--color-muted);opacity:.35}.flame-tier-4:before{position:absolute;inset:8% -8%;border:1px solid var(--color-accent-deep);border-radius:50%;content:"";box-shadow:0 0 18px color-mix(in oklab,var(--color-accent) 30%,transparent)}.flame-tier-4 .flame-spark{opacity:.65}.flame-tier-4 .spark-a{animation:flame-drift 1.8s ease-in-out infinite alternate}.flame-tier-4 .spark-b{animation:flame-drift 2.1s ease-in-out infinite alternate-reverse}@keyframes flame-drift{from{transform:translateY(2px);opacity:.45}to{transform:translateY(-3px);opacity:1}}@media(prefers-reduced-motion:reduce){.flame-tier-4 .flame-spark{animation:none!important;opacity:.75}}';
  document.head.appendChild(style);

  let pendingBackupImport = null;
  let speechPlaybackToken = 0;
  let speechWatchdog = 0;

  function normalizedSearch(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim();
  }

  function setDataCount(data) {
    const sets = Array.isArray(data.sets) ? data.sets : [];
    const progress = data.progress && typeof data.progress === 'object' ? Object.values(data.progress) : [];
    return {
      sets: sets.length,
      cards: sets.reduce((total, set) => total + (Array.isArray(set.cards) ? set.cards.length : 0), 0),
      progress: progress.length,
      srs: progress.filter(item => item && (item.nextReview || item.lastReviewed || item.repetitions || item.interval)).length,
      activity: Array.isArray(data.activity) ? data.activity.length : 0,
      matches: Array.isArray(data.matchRecords) ? data.matchRecords.length : 0
    };
  }

  function countMarkup(label, count) {
    return '<div><strong>' + esc(count) + '</strong><span>' + esc(label) + '</span></div>';
  }

  function createBackupDocument(data) {
    return {
      format: 'chill-english-backup',
      version: 2,
      backupId: id(),
      exportedAt: new Date().toISOString(),
      data: data || accountPayload()
    };
  }

  function downloadBackupDocument(documentData, filename) {
    const blob = new Blob([JSON.stringify(documentData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function validDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function validateBackupData(raw) {
    if (raw && raw.format && raw.format !== 'chill-english-backup') throw new Error('Tệp không phải bản sao lưu Chill English Quiz.');
    if (raw && raw.format && (!Number.isInteger(Number(raw.version)) || Number(raw.version) < 1 || Number(raw.version) > 2)) {
      throw new Error('Phiên bản bản sao lưu không được hỗ trợ.');
    }
    const source = raw && raw.format === 'chill-english-backup' ? raw.data : (raw && (raw.payload || raw));
    if (!source || typeof source !== 'object' || Array.isArray(source) || !Array.isArray(source.sets)) {
      throw new Error('Bản sao lưu thiếu danh sách Study Sets.');
    }
    if (source.folders !== undefined && !Array.isArray(source.folders)) throw new Error('Danh sách thư mục không hợp lệ.');
    if (source.progress !== undefined && (!source.progress || typeof source.progress !== 'object' || Array.isArray(source.progress))) {
      throw new Error('Dữ liệu tiến độ không hợp lệ.');
    }
    if (source.activity !== undefined && !Array.isArray(source.activity)) throw new Error('Lịch sử học tập không hợp lệ.');
    if (source.matchRecords !== undefined && !Array.isArray(source.matchRecords)) throw new Error('Lịch sử ghép từ không hợp lệ.');
    if (source.settings !== undefined && (!source.settings || typeof source.settings !== 'object' || Array.isArray(source.settings))) {
      throw new Error('Cài đặt không hợp lệ.');
    }

    const setIds = new Set();
    const normalizedSets = [];
    for (const inputSet of source.sets) {
      if (!inputSet || typeof inputSet !== 'object' || Array.isArray(inputSet) || typeof inputSet.title !== 'string' || !Array.isArray(inputSet.cards)) {
        throw new Error('Một Study Set có cấu trúc không hợp lệ.');
      }
      const title = inputSet.title.trim();
      const folder = typeof inputSet.folder === 'string' ? inputSet.folder : '';
      if (!title || Array.from(title).length > MAX_SET_TITLE_LENGTH || /[\u0000-\u001f\u007f]/.test(title)) {
        throw new Error('Study Set có tên trống, quá dài hoặc chứa ký tự điều khiển.');
      }
      const setId = typeof inputSet.id === 'string' && inputSet.id.trim() ? inputSet.id.trim() : id();
      if (setIds.has(setId)) throw new Error('Bản sao lưu có Study Set trùng ID: ' + title + '.');
      setIds.add(setId);
      if (normalizedSets.some(set => set.folder === folder && NAME_MATCHER.compare(set.title, title) === 0)) {
        throw new Error('Bản sao lưu có tên Study Set trùng trong cùng thư mục: ' + title + '.');
      }
      if (!inputSet.cards.length) throw new Error('Study Set “' + title + '” chưa có Flashcard.');

      const cardIds = new Set();
      const terms = [];
      const cards = [];
      for (const inputCard of inputSet.cards) {
        if (!inputCard || typeof inputCard !== 'object' || Array.isArray(inputCard) || typeof inputCard.term !== 'string' || typeof inputCard.meaning !== 'string') {
          throw new Error('Một Flashcard trong “' + title + '” có cấu trúc không hợp lệ.');
        }
        const term = inputCard.term.trim();
        const meaning = inputCard.meaning.trim();
        if (!term || !meaning) throw new Error('Study Set “' + title + '” có Flashcard thiếu từ hoặc nghĩa.');
        if (terms.some(previous => TERM_MATCHER.compare(previous, term) === 0)) {
          throw new Error('Study Set “' + title + '” có Flashcard trùng từ: ' + term + '.');
        }
        terms.push(term);
        const cardId = typeof inputCard.id === 'string' && inputCard.id.trim() ? inputCard.id.trim() : id();
        if (cardIds.has(cardId)) throw new Error('Study Set “' + title + '” có Flashcard trùng ID.');
        cardIds.add(cardId);
        const card = Object.assign({}, inputCard, { id: cardId, term, meaning });
        for (const scoreKey of ['bestPronunciationScore', 'lastPronunciationScore']) {
          const score = inputCard[scoreKey];
          card[scoreKey] = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
        }
        for (const listKey of ['pronunciationHistory', 'pronunciationCharacterScores', 'pronunciationPhonemes']) {
          if (inputCard[listKey] !== undefined && !Array.isArray(inputCard[listKey])) throw new Error('Lịch sử phát âm của “' + term + '” không hợp lệ.');
          if (Array.isArray(inputCard[listKey])) card[listKey] = inputCard[listKey].slice();
        }
        card.pronunciationErrors = Math.max(0, Number(inputCard.pronunciationErrors) || 0);
        card.pronunciationAttempts = Math.max(0, Number(inputCard.pronunciationAttempts) || 0);
        cards.push(card);
      }
      normalizedSets.push(Object.assign({}, inputSet, { id: setId, title, folder, _shared: undefined, cards }));
    }

    const folders = [];
    for (const inputFolder of source.folders || []) {
      const folder = typeof inputFolder === 'string' ? inputFolder : (inputFolder && (inputFolder.name || inputFolder.title));
      if (typeof folder !== 'string' || !folder.trim()) throw new Error('Một thư mục trong bản sao lưu không hợp lệ.');
      if (!folders.includes(folder.trim())) folders.push(folder.trim());
    }
    const progress = {};
    for (const [key, value] of Object.entries(source.progress || {})) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Một bản ghi tiến độ không hợp lệ.');
      for (const field of ['correct', 'incorrect', 'repetitions', 'interval', 'easeFactor']) {
        if (value[field] !== undefined && (!Number.isFinite(Number(value[field])) || Number(value[field]) < 0)) {
          throw new Error('Một bản ghi tiến độ có số liệu không hợp lệ.');
        }
      }
      for (const field of ['lastReviewed', 'nextReview']) {
        if (value[field] && !validDateKey(String(value[field]))) throw new Error('Một lịch ôn SRS có ngày không hợp lệ.');
      }
      if (value.status !== undefined && typeof value.status !== 'string') throw new Error('Một trạng thái SRS không hợp lệ.');
      progress[key] = Object.assign({}, value);
    }
    const activity = (source.activity || []).map(item => {
      if (!item || typeof item !== 'object' || !validDateKey(String(item.date || '').slice(0, 10))) {
        throw new Error('Một bản ghi lịch sử học tập có ngày không hợp lệ.');
      }
      return Object.assign({}, item);
    });
    const settings = Object.assign({ target: 15, accent: 'American', speechRate: 1 }, source.settings || {});
    const speechRate = Number(settings.speechRate);
    settings.target = Math.max(1, Number(settings.target) || 15);
    settings.accent = settings.accent === 'British' ? 'British' : 'American';
    settings.speechRate = SPEECH_RATES.includes(speechRate) ? speechRate : 1;
    return Object.assign({}, source, {
      sets: normalizedSets.filter(set => !set._shared),
      folders,
      progress,
      activity,
      favorites: Array.isArray(source.favorites) ? source.favorites.filter(item => typeof item === 'string') : [],
      settings,
      matchRecords: source.matchRecords || [],
      importedBackupIds: Array.isArray(source.importedBackupIds) ? source.importedBackupIds.filter(item => typeof item === 'string') : []
    });
  }

  function mergeProgress(existing, incoming) {
    if (!existing) return Object.assign({}, incoming);
    const oldDate = String(existing.lastReviewed || '');
    const newDate = String(incoming.lastReviewed || '');
    const latest = newDate > oldDate ? incoming : existing;
    return Object.assign({}, existing, latest, {
      correct: Math.max(Number(existing.correct) || 0, Number(incoming.correct) || 0),
      incorrect: Math.max(Number(existing.incorrect) || 0, Number(incoming.incorrect) || 0)
    });
  }

  function mergeArrayByOccurrence(existing, incoming, keyOf) {
    const result = existing.slice();
    const remaining = new Map();
    for (const item of existing) {
      const key = keyOf(item);
      remaining.set(key, (remaining.get(key) || 0) + 1);
    }
    for (const item of incoming) {
      const key = keyOf(item);
      const count = remaining.get(key) || 0;
      if (count) remaining.set(key, count - 1);
      else result.push(item);
    }
    return result;
  }

  function mergeBackupData(current, incoming, backupId) {
    if (backupId && (current.importedBackupIds || []).includes(backupId)) throw new Error('Bản sao lưu này đã được gộp trước đó.');
    const merged = JSON.parse(JSON.stringify(current));
    const localSets = merged.sets || (merged.sets = []);
    const setMap = new Map();
    const cardMaps = new Map();
    let addedSets = 0;
    let mergedSets = 0;

    for (const incomingSet of incoming.sets) {
      let target = localSets.find(set => set.id === incomingSet.id && !set._shared);
      if (!target) target = localSets.find(set => !set._shared && (set.folder || '') === (incomingSet.folder || '') && NAME_MATCHER.compare(set.title || '', incomingSet.title || '') === 0);
      if (!target) {
        target = JSON.parse(JSON.stringify(incomingSet));
        localSets.push(target);
        addedSets++;
      } else mergedSets++;
      setMap.set(incomingSet.id, target.id);
      const cardMap = new Map();
      target.cards = Array.isArray(target.cards) ? target.cards : [];
      for (const incomingCard of incomingSet.cards) {
        let targetCard = target.cards.find(card => card.id === incomingCard.id);
        if (!targetCard) targetCard = target.cards.find(card => TERM_MATCHER.compare(card.term || '', incomingCard.term || '') === 0);
        if (!targetCard) {
          targetCard = JSON.parse(JSON.stringify(incomingCard));
          target.cards.push(targetCard);
        }
        cardMap.set(incomingCard.id, targetCard.id);
      }
      cardMaps.set(incomingSet.id, cardMap);
    }

    merged.folders = Array.isArray(merged.folders) ? merged.folders : [];
    for (const folder of incoming.folders || []) if (!merged.folders.includes(folder)) merged.folders.push(folder);
    merged.progress = merged.progress || {};
    for (const [key, value] of Object.entries(incoming.progress || {})) {
      const separator = key.indexOf(':');
      if (separator < 0) continue;
      const sourceSetId = key.slice(0, separator);
      const sourceCardId = key.slice(separator + 1);
      const targetSetId = setMap.get(sourceSetId);
      const targetCardId = cardMaps.get(sourceSetId) && cardMaps.get(sourceSetId).get(sourceCardId);
      if (!targetSetId || !targetCardId) continue;
      const targetKey = targetSetId + ':' + targetCardId;
      merged.progress[targetKey] = mergeProgress(merged.progress[targetKey], value);
    }
    const mapFavorite = value => {
      const separator = String(value).indexOf(':');
      if (separator < 0) return null;
      const sourceSetId = String(value).slice(0, separator);
      const sourceCardId = String(value).slice(separator + 1);
      const targetSetId = setMap.get(sourceSetId);
      const targetCardId = cardMaps.get(sourceSetId) && cardMaps.get(sourceSetId).get(sourceCardId);
      return targetSetId && targetCardId ? targetSetId + ':' + targetCardId : null;
    };
    const favorites = new Set(merged.favorites || []);
    for (const favorite of incoming.favorites || []) {
      const mapped = mapFavorite(favorite);
      if (mapped) favorites.add(mapped);
    }
    merged.favorites = Array.from(favorites);
    const mapSession = item => {
      if (!item || !item.sid || !setMap.has(item.sid)) return null;
      return Object.assign({}, item, { sid: setMap.get(item.sid) });
    };
    const mappedActivity = (incoming.activity || []).map(mapSession).filter(Boolean);
    const mappedMatches = (incoming.matchRecords || []).map(mapSession).filter(Boolean);
    merged.activity = mergeArrayByOccurrence(merged.activity || [], mappedActivity, item => item.sessionId ? 'id:' + item.sessionId : 'legacy:' + JSON.stringify(item));
    merged.matchRecords = mergeArrayByOccurrence(merged.matchRecords || [], mappedMatches, item => item.sessionId ? 'id:' + item.sessionId : 'legacy:' + JSON.stringify(item));
    merged.importedBackupIds = Array.from(new Set([...(merged.importedBackupIds || []), ...(incoming.importedBackupIds || []), ...(backupId ? [backupId] : [])]));
    return { data: merged, addedSets, mergedSets };
  }

  function showImportPreview(data, backupId) {
    pendingBackupImport = { data, backupId };
    const current = setDataCount(accountPayload());
    const incoming = setDataCount(data);
    const cloudNote = syncReady && syncUser ? '<p class="confirm-copy">Sau khi lưu, thay đổi sẽ được đồng bộ lên tài khoản đang đăng nhập.</p>' : '';
    document.getElementById('modalroot').innerHTML = '<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="backupPreviewTitle"><div class="modalhead"><h2 id="backupPreviewTitle">Xem trước bản sao lưu</h2><button type="button" class="close" aria-label="Đóng" onclick="closeModal()">×</button></div><p class="confirm-copy">Tệp có ' + incoming.sets + ' Study Sets, ' + incoming.cards + ' Flashcards, ' + incoming.progress + ' bản ghi tiến độ (trong đó ' + incoming.srs + ' có lịch SRS), ' + incoming.activity + ' phiên học và ' + incoming.matches + ' lượt ghép từ.</p><div class="import-summary">' + countMarkup('Study Sets hiện tại', current.sets) + countMarkup('Flashcards hiện tại', current.cards) + countMarkup('Phiên học hiện tại', current.activity) + countMarkup('Lượt ghép từ hiện tại', current.matches) + '</div><p class="confirm-copy"><b>Gộp:</b> thêm thẻ/bộ mới, giữ cài đặt và nội dung hiện có; tiến độ mới nhất được giữ lại.</p><p class="confirm-copy"><b>Thay thế:</b> dùng dữ liệu trong tệp cho thiết bị này. Một bản sao lưu hiện tại sẽ được tải xuống trước khi thay.</p>' + cloudNote + '<div class="confirm-actions"><button type="button" class="btn secondary" onclick="closeModal()">Hủy</button><button type="button" class="btn secondary" onclick="applyBackupImport(\'merge\')">Gộp dữ liệu</button><button type="button" class="btn danger" onclick="applyBackupImport(\'replace\')">Thay thế dữ liệu</button></div></div></div>';
  }

  function resetStudySessions() {
    reviewQueue = [];
    reviewCards = [];
    reviewTotal = 0;
    reviewCorrect = 0;
    reviewCorrectKeys = [];
    reviewRetryQueue = [];
    reviewTest = null;
    reviewTestCards = [];
    activeSet = null;
    session = null;
    matchState = null;
    flashSession = null;
    pronunciationSession = null;
    if (matchTimer) clearInterval(matchTimer);
    if (matchFeedbackTimer) clearTimeout(matchFeedbackTimer);
    matchTimer = null;
    matchFeedbackTimer = null;
    stopVocabularySpeech();
  }

  window.applyBackupImport = function (mode) {
    if (!pendingBackupImport || !['merge', 'replace'].includes(mode)) return;
    const pending = pendingBackupImport;
    const previousState = state;
    const previousStorage = localStorage.getItem(KEY);
    let nextState;
    let message;
    if (mode === 'replace') {
      if (!confirm('Thay thế sẽ ghi đè dữ liệu học tập trên thiết bị này' + (syncReady && syncUser ? ' và đồng bộ thay đổi lên tài khoản đang đăng nhập' : '') + '. Tiếp tục?')) return;
      if (prompt('Để xác nhận, nhập đúng cụm: THAY THẾ') !== 'THAY THẾ') {
        toast('Đã hủy thao tác thay thế.');
        return;
      }
      downloadBackupDocument(createBackupDocument(accountPayload()), 'chill-english-before-import-' + today() + '.json');
      nextState = pending.data;
      message = 'Đã khôi phục ' + nextState.sets.length + ' Study Sets và ' + setDataCount(nextState).cards + ' Flashcards.';
    } else {
      try {
        const merged = mergeBackupData(state, pending.data, pending.backupId);
        nextState = merged.data;
        message = 'Đã gộp ' + merged.addedSets + ' Study Sets mới; ' + merged.mergedSets + ' bộ trùng được gộp thẻ và tiến độ.';
      } catch (error) {
        toast(error.message || 'Không thể gộp bản sao lưu.');
        return;
      }
    }
    try {
      state = nextState;
      save();
    } catch (error) {
      state = previousState;
      try {
        if (previousStorage === null) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, previousStorage);
      } catch (_) {}
      toast('Không lưu được bản sao lưu; dữ liệu trước đó đã được khôi phục.');
      return;
    }
    resetStudySessions();
    pendingBackupImport = null;
    original.closeModal();
    nav('home');
    toast(message);
  };

  window.exportData = function () {
    downloadBackupDocument(createBackupDocument(accountPayload()), 'chill-english-backup-' + today() + '.json');
    toast('Đã xuất Study Sets, Flashcards, tiến độ, lịch sử và lịch ôn SRS.');
  };

  window.validateBackupData = validateBackupData;
  window.importData = function (event) {
    const input = event && event.target;
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      input.value = '';
      toast('Tệp quá lớn. Giới hạn nhập là 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const data = validateBackupData(parsed);
        const backupId = parsed && typeof parsed.backupId === 'string' ? parsed.backupId : '';
        showImportPreview(data, backupId);
      } catch (error) {
        toast('Không thể nhập: ' + (error.message || 'tệp JSON không hợp lệ.'));
      } finally {
        input.value = '';
      }
    };
    reader.onerror = function () {
      input.value = '';
      toast('Không đọc được tệp sao lưu.');
    };
    reader.readAsText(file);
  };

  window.closeModal = function () {
    pendingBackupImport = null;
    return original.closeModal();
  };

  window.library = function () {
    return original.library().replace('<option value="alpha">Tên A–Z</option>', '<option value="alpha">Tên A–Z</option><option value="alpha-desc">Tên Z–A</option>');
  };

  window.drawSets = function () {
    const root = document.getElementById('sets');
    if (!root) return;
    const query = normalizedSearch(document.getElementById('setSearch') && document.getElementById('setSearch').value);
    const folder = (document.getElementById('folderFilter') && document.getElementById('folderFilter').value) || '';
    const sort = (document.getElementById('sortSets') && document.getElementById('sortSets').value) || 'recent';
    const sets = state.sets.filter(set => {
      const folderMatches = folder === '__shared__' ? !!set._shared : folder ? (!set._shared && set.folder === folder) : true;
      const textMatches = !query || normalizedSearch(set.title).includes(query) || (set.cards || []).some(card => normalizedSearch(card.term).includes(query) || normalizedSearch(card.meaning).includes(query));
      return folderMatches && textMatches;
    });
    if (sort === 'alpha' || sort === 'alpha-desc') {
      sets.sort((a, b) => {
        const order = NAME_SORTER.compare(String(a.title || ''), String(b.title || ''));
        return sort === 'alpha-desc' ? -order : order;
      });
    } else if (sort === 'created') {
      sets.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
    } else {
      sets.sort((a, b) => String(b.lastStudied || b.created || '').localeCompare(String(a.lastStudied || a.created || '')));
    }
    root.className = document.getElementById('viewType') && document.getElementById('viewType').value === 'list' ? '' : 'setgrid';
    root.innerHTML = sets.map(setCard).join('') || empty('Chưa có bộ thẻ', 'Bộ thẻ đã chia sẻ sẽ xuất hiện ở đây sau khi bạn đăng nhập.');
  };

  window.validateSetTitleInput = function (sid) {
    const field = document.getElementById('editTitle');
    const error = document.getElementById('editTitleError');
    if (!field || !error) return true;
    const title = field.value.trim();
    const folder = document.getElementById('editFolder') && document.getElementById('editFolder').value || '';
    let message = '';
    if (!title) message = 'Vui lòng nhập tên Study Set.';
    else if (Array.from(title).length > MAX_SET_TITLE_LENGTH) message = 'Tên Study Set tối đa ' + MAX_SET_TITLE_LENGTH + ' ký tự.';
    else if (/[\u0000-\u001f\u007f]/.test(title)) message = 'Tên Study Set không được chứa ký tự điều khiển.';
    else if (state.sets.some(set => !set._shared && set.id !== sid && (set.folder || '') === folder && NAME_MATCHER.compare(set.title || '', title) === 0)) {
      message = 'Đã có Study Set cùng tên trong thư mục này.';
    }
    field.setAttribute('aria-invalid', String(!!message));
    error.textContent = message;
    return !message;
  };

  window.cardEditor = function (card) {
    const value = card || {};
    return original.cardEditor(value)
      .replace('class="editcard"', 'class="editcard" data-card-id="' + esc(value.id || '') + '"')
      .replace('</div><button type="button" class="dots"', '</div><p class="field-error card-error" role="alert"></p><button type="button" class="dots" aria-label="Xóa thẻ"');
  };

  window.openEditor = function (sid) {
    original.openEditor(sid);
    const title = document.getElementById('editTitle');
    const folder = document.getElementById('editFolder');
    const cardList = document.getElementById('cardsEditor');
    if (title) {
      title.maxLength = MAX_SET_TITLE_LENGTH;
      title.setAttribute('aria-describedby', 'editTitleError');
      const error = document.createElement('p');
      error.id = 'editTitleError';
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      title.parentNode.appendChild(error);
      title.addEventListener('input', () => validateSetTitleInput(sid || ''));
    }
    if (folder) folder.addEventListener('change', () => validateSetTitleInput(sid || ''));
    if (cardList) {
      const error = document.createElement('p');
      error.id = 'cardsEditorError';
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      cardList.parentNode.insertBefore(error, cardList);
      if (sid) {
        const backupNote = document.createElement('p');
        backupNote.className = 'footnote';
        backupNote.textContent = 'Khi lưu thay đổi, một bản sao lưu sẽ được tải xuống để bảo vệ tiến độ và lịch sử hiện có.';
        cardList.parentNode.insertBefore(backupNote, cardList);
      }
    }
  };

  window.saveSet = async function (sid) {
    const titleField = document.getElementById('editTitle');
    if (!titleField || !validateSetTitleInput(sid || '')) {
      if (titleField) titleField.focus();
      return;
    }
    const existing = sid ? setObj(sid) : null;
    if (sid && (!existing || existing._shared)) return;
    const rows = Array.from(document.querySelectorAll('.editcard'));
    const cards = [];
    let invalidRow = null;
    let invalidField = null;
    const termSeen = [];
    for (const row of rows) {
      const termField = row.querySelector('.term-input');
      const meaningField = row.querySelector('.detail-input');
      const term = (termField && termField.value || '').trim();
      const meaning = (meaningField && meaningField.value || '').trim();
      const error = row.querySelector('.card-error');
      if (error) error.textContent = '';
      if (termField) termField.setAttribute('aria-invalid', 'false');
      if (meaningField) meaningField.setAttribute('aria-invalid', 'false');
      if (!term && !meaning) continue;
      let message = '';
      let rowField = null;
      if (!term || !meaning) {
        message = 'Mỗi Flashcard cần có cả từ tiếng Anh và nghĩa.';
        rowField = !term ? termField : meaningField;
      } else if (termSeen.some(value => TERM_MATCHER.compare(value, term) === 0)) {
        message = 'Từ này đã có trong Study Set.';
        rowField = termField;
      }
      if (message) {
        if (error) error.textContent = message;
        if (rowField) rowField.setAttribute('aria-invalid', 'true');
        invalidField = invalidField || rowField;
        invalidRow = invalidRow || row;
        continue;
      }
      termSeen.push(term);
      const prior = (existing && existing.cards || []).find(card => card.id && card.id === row.dataset.cardId)
        || (existing && existing.cards || []).find(card => TERM_MATCHER.compare(card.term || '', term) === 0);
      cards.push(Object.assign({}, prior || {}, {
        id: prior && prior.id || id(),
        term,
        pos: row.querySelector('.pos-input').value.trim(),
        meaning,
        ipa: row.querySelector('.ipa-input').value.trim(),
        definition: prior && prior.definition || '',
        example: row.querySelector('.example-input').value.trim(),
        image: row.querySelector('.image-input').value.trim()
      }));
    }
    const cardsError = document.getElementById('cardsEditorError');
    if (cardsError) cardsError.textContent = '';
    if (invalidRow) {
      if (cardsError) cardsError.textContent = 'Hãy hoàn thiện các Flashcard được đánh dấu trước khi lưu.';
      if (invalidField) invalidField.focus();
      return;
    }
    if (!cards.length) {
      if (cardsError) cardsError.textContent = 'Thêm ít nhất một Flashcard có đủ từ và nghĩa.';
      const firstTerm = document.querySelector('.term-input');
      if (firstTerm) firstTerm.focus();
      return;
    }
    const title = titleField.value.trim();
    const folder = document.getElementById('editFolder').value;
    const previousState = state;
    const previousStorage = localStorage.getItem(KEY);
    const nextState = JSON.parse(JSON.stringify(state));
    const object = existing ? nextState.sets.find(set => set.id === sid) : { id: id(), created: today() };
    if (existing) downloadBackupDocument(createBackupDocument(accountPayload()), 'chill-english-before-edit-' + String(sid).slice(0, 8) + '-' + today() + '.json');
    Object.assign(object, {
      title,
      description: document.getElementById('editDescription').value.trim(),
      folder,
      cards
    });
    if (!existing) nextState.sets.unshift(object);
    state = nextState;
    try {
      save();
    } catch (_) {
      state = previousState;
      try { if (previousStorage === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, previousStorage); } catch (_) {}
      toast('Không lưu được Study Set. Dữ liệu chưa được thay đổi.');
      return;
    }
    original.closeModal();
    let sharedUpdated = true;
    if (publishedDeckIds.has(object.id)) sharedUpdated = await upsertSharedDeck(object);
    render();
    toast(sharedUpdated ? 'Đã lưu Study Set.' : 'Đã lưu riêng, nhưng chưa cập nhật được bản chia sẻ.');
  };

  window.deleteSet = function (sid) {
    const set = setObj(sid);
    if (!set || set._shared) return;
    const published = publishedDeckIds.has(sid);
    document.getElementById('modalroot').innerHTML = '<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="deleteSetTitle"><div class="modalhead"><h2 id="deleteSetTitle">Xóa Study Set?</h2><button type="button" class="close" aria-label="Đóng" onclick="closeModal()">×</button></div><p><b>' + esc(set.title) + '</b></p><p class="confirm-copy">Thao tác này xóa ' + set.cards.length + ' Flashcard, tiến độ SRS và lịch sử gắn với bộ này trên thiết bị.' + (published ? ' Bản chia sẻ của bộ cũng sẽ bị gỡ.' : '') + '</p><p class="confirm-copy">Một bản sao lưu JSON sẽ được tải xuống trước khi xóa.</p><div class="confirm-actions"><button id="cancelDeleteSet" type="button" class="btn secondary" onclick="closeModal()">Hủy</button><button id="confirmDeleteSet" type="button" class="btn danger" onclick="confirmDeleteSet(' + jsLiteral(sid) + ')">Xác nhận xóa</button></div></div></div>';
    setTimeout(() => document.getElementById('cancelDeleteSet') && document.getElementById('cancelDeleteSet').focus(), 0);
  };

  window.confirmDeleteSet = async function (sid) {
    const set = setObj(sid);
    if (!set || set._shared) return;
    const button = document.getElementById('confirmDeleteSet');
    if (button) { button.disabled = true; button.textContent = 'Đang xóa…'; }
    const previous = state;
    const previousStorage = localStorage.getItem(KEY);
    downloadBackupDocument(createBackupDocument(accountPayload()), 'chill-english-before-delete-' + String(sid).slice(0, 8) + '-' + today() + '.json');
    const next = JSON.parse(JSON.stringify(state));
    next.sets = next.sets.filter(item => item.id !== sid);
    for (const key of Object.keys(next.progress || {})) if (key.startsWith(sid + ':')) delete next.progress[key];
    next.favorites = (next.favorites || []).filter(key => !key.startsWith(sid + ':'));
    next.activity = (next.activity || []).filter(item => item.sid !== sid);
    next.matchRecords = (next.matchRecords || []).filter(item => item.sid !== sid);
    state = next;
    try {
      save();
    } catch (_) {
      state = previous;
      try { if (previousStorage === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, previousStorage); } catch (_) {}
      if (button) { button.disabled = false; button.textContent = 'Xác nhận xóa'; }
      toast('Không lưu được thay đổi; Study Set vẫn được giữ lại trên thiết bị.');
      return;
    }
    if (publishedDeckIds.has(sid)) {
      try {
        if (!syncUser || !syncClient) throw new Error('Chưa kết nối tài khoản.');
        const result = await syncClient.from('shared_decks').delete().eq('owner_id', syncUser.id).eq('deck_id', sid);
        if (result.error) throw result.error;
      } catch (error) {
        state = previous;
        try { if (previousStorage === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, previousStorage); } catch (_) {}
        if (syncReady && syncUser) scheduleCloudSync();
        if (button) { button.disabled = false; button.textContent = 'Xác nhận xóa'; }
        toast('Không xóa được bản chia sẻ; Study Set và dữ liệu đã được khôi phục. ' + (error.message || ''));
        return;
      }
    }
    publishedDeckIds.delete(sid);
    if (activeSet === sid) {
      activeSet = null;
      session = null;
      matchState = null;
      flashSession = null;
    }
    original.closeModal();
    render();
    toast('Đã xóa Study Set và cập nhật tiến độ liên quan.');
  };

  window.clearData = function () {
    const counts = setDataCount(accountPayload());
    document.getElementById('modalroot').innerHTML = '<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="clearDataTitle"><div class="modalhead"><h2 id="clearDataTitle">Xóa dữ liệu trên thiết bị?</h2><button type="button" class="close" aria-label="Đóng" onclick="closeModal()">×</button></div><p class="confirm-copy">Thao tác xóa ' + counts.sets + ' Study Sets, ' + counts.cards + ' Flashcards, tiến độ SRS và lịch sử khỏi thiết bị này. Bản đồng bộ trên tài khoản vẫn được giữ nguyên.</p><p class="confirm-copy">Một bản sao lưu JSON sẽ được tải xuống trước khi xóa. Để tiếp tục, xác nhận thêm một bước và nhập cụm xác nhận.</p><div class="confirm-actions"><button type="button" class="btn secondary" onclick="closeModal()">Hủy</button><button type="button" class="btn danger" onclick="showClearDataStepTwo()">Tiếp tục</button></div></div></div>';
  };

  window.showClearDataStepTwo = function () {
    document.getElementById('modalroot').innerHTML = '<div class="overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="clearDataFinalTitle"><div class="modalhead"><h2 id="clearDataFinalTitle">Xác nhận lần cuối</h2><button type="button" class="close" aria-label="Đóng" onclick="closeModal()">×</button></div><p class="confirm-copy">Nhập chính xác <b>XOA DU LIEU</b> để tải bản sao lưu và xóa dữ liệu cục bộ. Thao tác này không xóa dữ liệu trên tài khoản đồng bộ.</p><div class="formgroup"><label for="clearDataPhrase">Cụm xác nhận</label><input id="clearDataPhrase" class="field clear-phrase" autocomplete="off"></div><div class="confirm-actions"><button type="button" class="btn secondary" onclick="closeModal()">Hủy</button><button id="confirmClearData" type="button" class="btn danger" disabled onclick="confirmClearData()">Tải backup và xóa</button></div></div></div>';
    const field = document.getElementById('clearDataPhrase');
    const button = document.getElementById('confirmClearData');
    field.addEventListener('input', () => { button.disabled = field.value !== 'XOA DU LIEU'; });
    field.focus();
  };

  window.confirmClearData = function () {
    const field = document.getElementById('clearDataPhrase');
    if (!field || field.value !== 'XOA DU LIEU') return;
    const previousState = state;
    const previousStorage = localStorage.getItem(KEY);
    try {
      downloadBackupDocument(createBackupDocument(accountPayload()), 'chill-english-before-clear-' + today() + '.json');
      localStorage.removeItem(KEY);
      state = load();
      syncReady = false;
      resetStudySessions();
      original.closeModal();
      render();
      toast(syncUser ? 'Đã xóa dữ liệu trên thiết bị. Bản đồng bộ trên tài khoản vẫn còn.' : 'Đã xóa dữ liệu trên thiết bị. Bản sao lưu đã được tải xuống.');
    } catch (_) {
      state = previousState;
      try { if (previousStorage === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, previousStorage); } catch (_) {}
      toast('Không thể xóa dữ liệu trên thiết bị. Dữ liệu hiện tại vẫn được giữ lại.');
    }
  };

  window.stopVocabularySpeech = function () {
    speechPlaybackToken++;
    clearTimeout(speechWatchdog);
    speechWatchdog = 0;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    document.querySelectorAll('.speech-button').forEach(button => {
      button.disabled = false;
      button.classList.remove('is-playing');
      button.setAttribute('aria-pressed', 'false');
      button.textContent = '🔊';
      const word = button.dataset.speechWord || '';
      button.setAttribute('aria-label', word ? 'Nghe ' + word : 'Nghe phát âm');
    });
  };

  window.speakVocabulary = function (term, speed, button) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      toast('Thiết bị chưa hỗ trợ đọc mẫu.');
      return;
    }
    if (button && button.getAttribute('aria-pressed') === 'true') {
      stopVocabularySpeech();
      return;
    }
    stopVocabularySpeech();
    const token = ++speechPlaybackToken;
    const word = String(term || '').trim();
    if (!word) { toast('Không có từ để phát âm.'); return; }
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = state.settings && state.settings.accent === 'British' ? 'en-GB' : 'en-US';
    const requestedRate = Number(speed) || Number(state.settings && state.settings.speechRate) || 1;
    utterance.rate = Math.max(0.5, Math.min(2, requestedRate));
    if (button) {
      button.dataset.speechWord = word;
      button.disabled = true;
      button.classList.add('is-playing');
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('aria-label', 'Đang chuẩn bị phát âm ' + word);
      button.textContent = '…';
    }
    const resetButton = () => {
      if (token !== speechPlaybackToken) return;
      clearTimeout(speechWatchdog);
      speechWatchdog = 0;
      if (button) {
        button.disabled = false;
        button.classList.remove('is-playing');
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Nghe ' + word);
        button.textContent = '🔊';
      }
    };
    utterance.onstart = () => {
      if (token !== speechPlaybackToken) return;
      if (button) {
        button.disabled = false;
        button.setAttribute('aria-label', 'Đang phát âm ' + word + ' · nhấn để dừng');
        button.textContent = '⏹';
      }
    };
    utterance.onend = resetButton;
    utterance.onerror = event => {
      resetButton();
      if (token === speechPlaybackToken && event && event.error !== 'canceled' && event.error !== 'interrupted') {
        toast('Không phát được âm thanh. Hãy kiểm tra giọng đọc và âm lượng của thiết bị.');
      }
    };
    try {
      window.speechSynthesis.speak(utterance);
      speechWatchdog = setTimeout(() => {
        if (token !== speechPlaybackToken) return;
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          resetButton();
          toast('Trình duyệt chưa có giọng đọc tiếng Anh khả dụng.');
        }
      }, 12000);
    } catch (_) {
      resetButton();
      toast('Không thể phát âm trên trình duyệt này.');
    }
  };

  const originalDrawFlash = original.drawFlash;
  window.drawFlash = function () {
    originalDrawFlash();
    document.querySelectorAll('.pron-inline-actions button[aria-label^="Nghe "]').forEach(button => {
      const word = button.getAttribute('aria-label').slice(5);
      button.classList.add('speech-button');
      button.dataset.speechWord = word;
      button.setAttribute('aria-pressed', 'false');
      button.onclick = event => {
        event.stopPropagation();
        speakVocabulary(word, undefined, button);
      };
    });
  };

  window.stepCard = function (direction) {
    stopVocabularySpeech();
    original.stepCard(direction);
  };

  window.launch = function (sid, mode) {
    const set = setObj(sid);
    if (!set || !Array.isArray(set.cards) || !set.cards.length) {
      toast('Study Set này chưa có Flashcard để học.');
      return;
    }
    stopVocabularySpeech();
    original.launch(sid, mode);
  };

  window.makeOptions = function (card) {
    const set = setObj(activeSet);
    const options = [];
    const add = value => {
      const text = String(value || '').trim();
      if (text && !options.some(existing => TERM_MATCHER.compare(existing, text) === 0)) options.push(text);
    };
    add(card.term);
    (set && set.cards || []).filter(item => item.id !== card.id).forEach(item => add(item.term));
    ['reliable', 'thoughtful', 'eventually', 'evidence', 'ordinary', 'accurate', 'curious', 'comfortable', 'discover', 'careful', 'patient', 'resourceful'].forEach(add);
    return options.slice(0, 4).sort(() => Math.random() - 0.5);
  };

  window.finishActivity = function (sid, correct, minutes, details) {
    const sessionDetails = Object.assign({}, details || {});
    if (!sessionDetails.type) {
      if (activeSet === REVIEW_SESSION_ID) sessionDetails.type = 'srs-review';
      else if (page === 'flashcards' && flashSession) {
        sessionDetails.type = 'flashcards';
        sessionDetails.total = flashSession.seen;
      } else if (page === 'test' && session) sessionDetails.type = 'quiz';
      else if (page === 'learn' && session) sessionDetails.type = 'practice';
      else if (page === 'match' && matchState) sessionDetails.type = 'match';
      else sessionDetails.type = 'study';
    }
    if (!sessionDetails.total) {
      if (session && Array.isArray(session.questions)) sessionDetails.total = session.questions.length;
      else if (activeSet === REVIEW_SESSION_ID) sessionDetails.total = reviewTotal;
      else if (page === 'match' && matchState) sessionDetails.total = matchState.cards.length;
    }
    if (!sessionDetails.answers && session && Array.isArray(session.answers)) {
      sessionDetails.answers = session.answers.map(answer => {
        const card = answer.card || answer.question && answer.question.card || {};
        return { cardId: card.id || answer.cardId || '', term: card.term || answer.term || '', correct: !!answer.correct };
      });
    }
    const date = today();
    const alreadyStudied = (state.activity || []).some(item => item.date === date);
    const before = calculateStudyStreak();
    state.activity = state.activity || [];
    state.activity.push(Object.assign({ sessionId: id(), date, sid, correct: Number(correct) || 0, minutes: Number(minutes) || 0 }, sessionDetails));
    const set = setObj(sid);
    if (set) set.lastStudied = date;
    save();
    const current = calculateStudyStreak();
    if (!alreadyStudied) {
      launchStreakConfetti();
      toast('Tuyệt vời! Bạn đã duy trì chuỗi ' + current.count + ' ngày học liên tiếp!');
      if (STREAK_MILESTONES.includes(current.count) && current.count > before.count) setTimeout(() => showStreakMilestone(current.count), 320);
    } else toast('Buổi học đã được ghi nhận, chuỗi hiện tại ' + current.count + ' ngày.');
  };

  window.streakLevelFor = function (days) {
    let level = 0;
    for (let index = 1; index < STREAK_TIERS.length; index++) if (days >= STREAK_TIERS[index].min) level = index;
    return level;
  };

  window.streakFlameMarkup = function (level, frozen) {
    const safeLevel = Math.max(0, Math.min(STREAK_TIERS.length - 1, Number(level) || 0));
    const html = original.streakFlameMarkup(safeLevel, frozen);
    const label = frozen ? 'Ngọn lửa đang đóng băng' : STREAK_TIERS[safeLevel].name;
    return html.replace(/aria-label="[^"]*"/, 'aria-label="' + esc(label) + '"');
  };

  window.calculateStudyStreak = function (now) {
    const result = original.calculateStudyStreak(now);
    result.level = window.streakLevelFor(result.count);
    return result;
  };

  window.streakWidget = function () {
    const streak = calculateStudyStreak();
    const tier = STREAK_TIERS[streak.level];
    const next = STREAK_TIERS.find((item, index) => index > streak.level);
    let message = 'Học một buổi hôm nay để thắp lên ngọn lửa đầu tiên.';
    if (streak.status === 'frozen') message = 'Nghỉ một ngày cuối tuần không làm bạn mất streak. Học hôm nay để rã đông nhé.';
    else if (streak.status === 'learned') message = 'Bạn đã hoàn thành mục tiêu hôm nay. Hẹn gặp lại ngọn lửa ngày mai!';
    else if (streak.count) message = 'Học một buổi hôm nay để giữ nhịp và thắp lửa tiếp.';
    const progress = next ? 'Còn ' + Math.max(0, next.min - streak.count) + ' ngày để mở khóa ' + next.name + '.' : 'Bạn đã mở khóa cấp lửa cao nhất.';
    const badge = streak.level === 0 ? 'Chưa thắp lửa · 0 ngày' : 'Cấp ' + streak.level + ' · ' + tier.name;
    return '<section class="streak-card ' + (streak.status === 'frozen' ? 'is-frozen' : '') + '"><div class="streak-glow"></div><div class="streak-main"><button type="button" class="streak-flame-button" aria-label="Mở lịch học tập" onclick="openStreakCalendar()">' + streakFlameMarkup(streak.level, streak.status === 'frozen') + '</button><div class="streak-copy"><div class="streak-kicker">Chuỗi học tập</div><div class="streak-count">' + streak.count + '<span>ngày</span></div><p class="streak-message">' + message + '</p><div class="streak-next">' + progress + '</div></div></div><div class="streak-side"><span class="streak-level-badge">' + esc(badge) + '</span><button type="button" class="streak-calendar-button" onclick="openStreakCalendar()">Lịch học</button></div></section>';
  };

  window.showStreakMilestone = function (days) {
    const level = window.streakLevelFor(days);
    const tier = STREAK_TIERS[level];
    const oldLevel = Math.max(0, level - 1);
    document.getElementById('modalroot').innerHTML = '<div class="overlay streak-overlay milestone-overlay" onclick="if(event.target===this)closeModal()"><div class="modal milestone-modal" role="dialog" aria-modal="true" aria-labelledby="streakMilestoneTitle"><button type="button" class="close milestone-close" aria-label="Đóng" onclick="closeModal()">×</button><p class="milestone-label">Bạn vừa đạt ' + days + ' ngày học liên tiếp</p><div class="flame-evolution"><div class="evolution-old">' + streakFlameMarkup(oldLevel) + '</div><span class="evolution-arrow">→</span><div class="evolution-new">' + streakFlameMarkup(level) + '</div></div><h2 id="streakMilestoneTitle">Ngọn lửa thăng cấp!</h2><h3>' + esc(tier.title) + '</h3><p>Bạn đã học ' + days + ' ngày. Sự bền bỉ của bạn vừa mở khóa một ngọn lửa mới.</p><button type="button" class="btn milestone-continue" onclick="closeModal()">Tiếp tục hành trình</button></div></div>';
    launchStreakConfetti();
  };

  window.finishMatch = function (won) {
    const match = matchState;
    if (!match || match.over) return;
    match.over = true;
    match.won = !!won;
    match.finalSeconds = Math.min(Number(match.timeLimit) || Infinity, Math.max(0, Math.ceil((Date.now() - match.start) / 1000)));
    if (matchTimer) clearInterval(matchTimer);
    if (matchFeedbackTimer) clearTimeout(matchFeedbackTimer);
    matchTimer = null;
    matchFeedbackTimer = null;
    state.matchRecords = state.matchRecords || [];
    state.matchRecords.push({ sessionId: id(), sid: activeSet, seconds: match.finalSeconds, date: today(), won: match.won, errors: Number(match.errors) || 0, matched: (match.matched || []).length, total: match.cards.length });
    save();
    if (match.won) finishActivity(activeSet, match.cards.length, Math.max(1, Math.ceil(match.finalSeconds / 60)), { type: 'match', total: match.cards.length, errors: Number(match.errors) || 0 });
    drawMatch();
  };

  window.nav = function (destination) {
    if (destination === 'view') destination = 'library';
    stopVocabularySpeech();
    if (destination !== 'match' && matchState) matchState = null;
    original.nav(destination);
  };

  window.syncRouteFromHash = function () {
    let route = location.hash.replace(/^#/, '');
    if (route === 'view') {
      window.nav('library');
      return;
    }
    if (route !== 'match' && matchState) matchState = null;
    if (page !== route) stopVocabularySpeech();
    original.syncRouteFromHash();
  };
  window.removeEventListener('hashchange', original.syncRouteFromHash);
  window.addEventListener('hashchange', window.syncRouteFromHash);

  window.settingsPage = (function (previousSettingsPage) {
    return function () {
      let html = previousSettingsPage();
      const options = SPEECH_RATES.map(rate => '<option value="' + rate + '" ' + (Number(state.settings.speechRate || 1) === rate ? 'selected' : '') + '>' + (rate === 1 ? '1× · bình thường' : String(rate).replace('.', ',') + '×') + '</option>').join('');
      html = html.replace(/(<div class="formgroup"><label>Phát âm mặc định<\/label><select id="accent" class="field">[\s\S]*?<\/select><\/div>)/, '$1<div class="formgroup"><label for="speechRate">Tốc độ đọc mẫu</label><select id="speechRate" class="field">' + options + '</select></div>');
      html = html.replace('Xóa toàn bộ dữ liệu</button>', 'Xóa dữ liệu trên thiết bị</button>');
      html = html.replace('<button type="button" class="btn small" style="background:var(--color-danger);margin-top:12px" onclick="clearData()">Xóa dữ liệu trên thiết bị</button>', '<p class="footnote">Xóa dữ liệu cục bộ; dữ liệu đã đồng bộ trên tài khoản vẫn được giữ.</p><button type="button" class="btn small" style="background:var(--color-danger);margin-top:12px" onclick="clearData()">Xóa dữ liệu trên thiết bị</button>');
      return html;
    };
  })(original.settingsPage);

  window.saveSettings = function () {
    const field = document.getElementById('speechRate');
    const rate = Number(field && field.value);
    state.settings.speechRate = SPEECH_RATES.includes(rate) ? rate : 1;
    original.saveSettings();
  };

  if (location.hash === '#view') window.nav('library');
  else if (typeof render === 'function') render();
})();
