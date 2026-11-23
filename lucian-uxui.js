/* Chill English adaptation layer for Lucian UX/UI Prompt #003, #008, #009, #012,
   #036, #037, #039, #062, #274 and #355. Original component licenses are noted
   in lucian-uxui.css. Existing app and Supabase handlers remain the source of truth. */
(() => {
  'use strict';

  document.body.classList.add('ux');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const holdTargets = '#confirmDeleteSet, #confirmClearData';
  let refreshQueued = false;

  function prepareRollingLabel(button) {
    if (!button.matches('.btn, .nav, .circlebtn, .answer, .matchtile')) return;
    button.classList.add('u009-btn');
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim() || node.parentElement.closest('.u009-word, svg, .u003-hint')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const label = node.nodeValue;
      const word = document.createElement('span');
      const face = document.createElement('span');
      word.className = 'u009-word';
      word.dataset.label = label;
      face.className = 'u009-face';
      face.textContent = label;
      word.append(face);
      node.replaceWith(word);
    }
  }

  function prepareAccountControl() {
    const control = document.getElementById('syncAccountControl');
    if (!control) return;
    const wrap = control.querySelector('.account-menu-wrap');
    const menu = document.getElementById('accountDropdown');
    const pill = document.getElementById('accountPill');
    if (wrap) wrap.classList.add('u037');
    if (menu) {
      menu.classList.add('u037-menu');
      menu.querySelectorAll('button[role="menuitem"]').forEach(item => item.classList.add('u037-it', 'u009-btn'));
      menu.querySelectorAll('button[role="menuitem"]').forEach(prepareRollingLabel);
      menu.querySelectorAll('button[onclick*="openAuthModal"]').forEach(button => button.classList.add('u274-btn'));
    }
    if (pill) {
      pill.classList.add('u037-switcher');
      const summary = document.getElementById('syncSettingsSummary');
      const guest = !!pill.querySelector('.account-copy small');
      if (guest) {
        pill.classList.remove('is-connected', 'is-pending', 'is-error');
        pill.classList.add('u274-btn');
        const title = pill.querySelector('.account-copy strong');
        if (title && title.textContent !== 'Đăng nhập') title.textContent = 'Đăng nhập';
        pill.setAttribute('aria-label', 'Đăng nhập hoặc tạo tài khoản');
        pill.setAttribute('aria-haspopup', 'dialog');
        pill.removeAttribute('aria-expanded');
        if (pill.dataset.uxLoginTrigger !== 'true') {
          pill.dataset.uxLoginTrigger = 'true';
          pill.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.openAuthModal?.('signin');
          }, true);
        }
        if (wrap && !wrap.querySelector('.u037-options')) {
          const options = document.createElement('button');
          options.type = 'button';
          options.className = 'circlebtn u037-options';
          options.setAttribute('aria-label', 'Tùy chọn tài khoản');
          options.setAttribute('aria-haspopup', 'menu');
          options.setAttribute('aria-expanded', 'false');
          options.setAttribute('title', 'Tùy chọn tài khoản');
          options.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
          options.addEventListener('click', event => {
            event.stopPropagation();
            window.toggleAccountMenu?.(event);
            options.setAttribute('aria-expanded', String(document.getElementById('accountDropdown')?.hidden === false));
          });
          wrap.append(options);
          const dropdown = wrap.querySelector('.account-dropdown');
          if (dropdown) new MutationObserver(() => options.setAttribute('aria-expanded', String(!dropdown.hidden))).observe(dropdown, { attributes: true, attributeFilter: ['hidden'] });
        }
      }
      else if (summary?.dataset.uxState === 'saved') pill.classList.add('is-connected');
      else if (summary?.dataset.uxState === 'sync') pill.classList.add('is-pending');
      else if (summary?.dataset.uxState === 'error') pill.classList.add('is-error');
    }
  }

  function prepareCloudStatus() {
    const summary = document.getElementById('syncSettingsSummary');
    if (!summary) return;
    summary.classList.add('u355');
    const status = (summary.textContent || '').toLocaleLowerCase('vi-VN');
    const dot = summary.querySelector('.sync-dot');
    let state = 'local';
    if (status.includes('đang đồng bộ') || status.includes('đang kết nối')) state = 'sync';
    else if (dot?.classList.contains('is-error') || status.includes('chưa đồng bộ') || status.includes('lỗi kết nối')) state = 'error';
    else if (status.includes('đã đồng bộ') || status.includes('đã kết nối đám mây')) state = 'saved';
    summary.dataset.uxState = state;

    const pill = document.getElementById('accountPill');
    if (pill && !pill.querySelector('.account-copy small')) {
      pill.classList.toggle('is-connected', state === 'saved');
      pill.classList.toggle('is-pending', state === 'sync');
      pill.classList.toggle('is-error', state === 'error');
    }
  }

  function updateStrength(field) {
    const input = field.querySelector('#authPassword');
    const meter = field.querySelector('.u036-meter');
    const rules = field.querySelector('.u036-rules');
    if (!input || !meter || !rules) return;
    const value = input.value;
    const checks = [value.length >= 8, /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)];
    const level = checks.filter(Boolean).length;
    meter.dataset.level = String(level);
    [...rules.children].forEach((rule, index) => rule.classList.toggle('is-met', checks[index]));
  }

  function prepareAuthModal() {
    const modal = document.getElementById('authModal');
    if (!modal || modal.dataset.uxPrepared === 'true') return;
    modal.dataset.uxPrepared = 'true';
    modal.classList.add('ux', 'u062');

    const tabs = document.getElementById('authTabs');
    if (tabs) {
      tabs.classList.add('u039-tabs');
      if (!tabs.querySelector('.u039-pill')) {
        const pill = document.createElement('span');
        pill.className = 'u039-pill';
        pill.setAttribute('aria-hidden', 'true');
        tabs.prepend(pill);
      }
      tabs.addEventListener('click', event => {
        if (event.target.closest('#authSigninTab, #authSignupTab')) {
          modal.classList.remove('bad', 'shake', 'ok');
        }
      });
    }

    const field = document.getElementById('authPassword')?.closest('.auth-field');
    if (field) {
      field.classList.add('u036');
      if (!field.querySelector('.u036-meter')) {
        const meter = document.createElement('div');
        meter.className = 'u036-meter';
        meter.dataset.level = '0';
        meter.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 4; i++) meter.append(document.createElement('span'));
        const rules = document.createElement('div');
        rules.className = 'u036-rules';
        rules.setAttribute('aria-hidden', 'true');
        ['8+ ký tự', 'Chữ hoa', 'Số', 'Ký hiệu'].forEach(text => {
          const item = document.createElement('span');
          item.textContent = text;
          rules.append(item);
        });
        const hint = field.querySelector('#authPasswordHint');
        hint?.after(meter, rules);
      }
      field.querySelector('#authPassword')?.addEventListener('input', () => updateStrength(field));
      updateStrength(field);
    }

    const submit = document.getElementById('authSubmit');
    if (submit) submit.classList.add('u062-go');
    const form = document.getElementById('authForm');
    form?.addEventListener('input', () => modal.classList.remove('bad', 'shake', 'ok'));

    const notice = document.getElementById('authNotice');
    const syncFeedback = () => {
      const type = (notice?.className || '').match(/is-(error|loading|success)/)?.[1] || '';
      modal.classList.toggle('busy', type === 'loading' || submit?.getAttribute('aria-busy') === 'true');
      if (type === 'error') {
        modal.classList.remove('shake', 'ok');
        modal.classList.add('bad');
        if (!reducedMotion.matches) {
          void modal.offsetWidth;
          modal.classList.add('shake');
          window.setTimeout(() => modal.classList.remove('shake'), 420);
        }
      } else if (type === 'success') {
        modal.classList.remove('bad', 'shake');
        modal.classList.add('ok');
      } else if (type !== 'loading' && !form?.contains(document.activeElement)) {
        modal.classList.remove('bad', 'shake', 'ok');
      }
    };
    if (notice) new MutationObserver(syncFeedback).observe(notice, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    if (submit) new MutationObserver(syncFeedback).observe(submit, { attributes: true, attributeFilter: ['aria-busy', 'disabled'] });
    syncFeedback();
  }

  function prepareDangerButtons() {
    const hintId = 'ux003HoldHint';
    if (!document.getElementById(hintId)) {
      const hint = document.createElement('span');
      hint.id = hintId;
      hint.className = 'u003-hint';
      hint.textContent = 'Giữ nút trong 1,2 giây để xác nhận thao tác xóa.';
      document.body.append(hint);
    }
    document.querySelectorAll(holdTargets).forEach(button => {
      button.classList.add('u003-btn');
      const descriptions = new Set((button.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      descriptions.add(hintId);
      button.setAttribute('aria-describedby', [...descriptions].join(' '));
    });
  }

  function prepareFavoriteButton() {
    const button = document.querySelector('button[onclick="starCard()"]');
    if (!button) return;
    button.classList.add('u012-btn');
    const saved = button.textContent.includes('Đã lưu');
    button.classList.toggle('is-on', saved);
    button.setAttribute('aria-pressed', String(saved));
  }

  function prepareExportButtons() {
    document.querySelectorAll('button[onclick*="exportData"], button[onclick*="exportSet"], button[onclick*="exportCsv"]').forEach(button => button.classList.add('u008-btn'));
  }

  function refresh() {
    refreshQueued = false;
    prepareAccountControl();
    prepareCloudStatus();
    prepareAuthModal();
    prepareDangerButtons();
    prepareFavoriteButton();
    prepareExportButtons();
    document.querySelectorAll('.btn, .nav, .circlebtn, .answer, .matchtile').forEach(prepareRollingLabel);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(refresh);
  }

  const appObserver = new MutationObserver(scheduleRefresh);
  appObserver.observe(document.body, { subtree: true, childList: true, characterData: true });

  document.addEventListener('click', event => {
    const trigger = event.target.closest('.u274-btn');
    if (!trigger) return;
    trigger.dataset.uxMorph = 'form';
    window.setTimeout(() => { if (trigger.isConnected) delete trigger.dataset.uxMorph; }, 520);
  }, true);

  const holdState = new WeakMap();
  const holdDuration = 1200;
  function clearHold(button, keepArmed = false) {
    const state = holdState.get(button);
    if (state?.frame) cancelAnimationFrame(state.frame);
    button.classList.remove('is-holding');
    button.style.removeProperty('--u003-progress');
    if (keepArmed && state?.ready) {
      button.dataset.uxHoldArmed = 'true';
      button.dataset.holdReady = 'true';
      return;
    }
    button.removeAttribute('data-hold-ready');
    button.removeAttribute('data-ux-hold-armed');
    holdState.delete(button);
  }
  function startHold(button, source) {
    if (!button || button.disabled || holdState.has(button)) return;
    const state = { started: performance.now(), ready: false, frame: 0, source };
    holdState.set(button, state);
    button.classList.add('is-holding');
    const tick = now => {
      if (holdState.get(button) !== state) return;
      const progress = Math.min(1, Math.max(0, (now - state.started) / holdDuration));
      button.style.setProperty('--u003-progress', String(progress));
      if (progress === 1) {
        state.ready = true;
        button.classList.remove('is-holding');
        button.dataset.holdReady = 'true';
      } else state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target.closest(holdTargets);
    if (button) startHold(button, 'pointer');
  });
  document.addEventListener('pointerup', event => {
    const button = event.target.closest(holdTargets);
    if (button) clearHold(button, true);
  });
  document.addEventListener('pointercancel', event => {
    const button = event.target.closest(holdTargets);
    if (button) clearHold(button);
  });
  document.addEventListener('pointerout', event => {
    const button = event.target.closest(holdTargets);
    if (button && !button.contains(event.relatedTarget)) clearHold(button);
  });
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat) return;
    const button = event.target.closest(holdTargets);
    if (button) startHold(button, 'keyboard');
  });
  document.addEventListener('keyup', event => {
    if (event.code !== 'Space') return;
    const button = event.target.closest(holdTargets);
    if (button) clearHold(button, true);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest(holdTargets);
    if (!button) return;
    if (button.dataset.uxHoldArmed !== 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    button.removeAttribute('data-ux-hold-armed');
    button.removeAttribute('data-hold-ready');
    button.style.removeProperty('--u003-progress');
    holdState.delete(button);
  }, true);

  const exportTimers = new WeakMap();
  document.addEventListener('click', event => {
    const button = event.target.closest('.u008-btn');
    if (!button) return;
    button.classList.add('is-copied');
    window.clearTimeout(exportTimers.get(button));
    exportTimers.set(button, window.setTimeout(() => button.classList.remove('is-copied'), 1700));
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('button[onclick="starCard()"]')) return;
    queueMicrotask(() => {
      const favorite = document.querySelector('button[onclick="starCard()"]');
      if (!favorite) return;
      favorite.classList.add('is-burst');
      window.setTimeout(() => favorite.classList.remove('is-burst'), 460);
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
  refresh();
})();
