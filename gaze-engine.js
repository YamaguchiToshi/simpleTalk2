// New gaze input stabilization engine for simpleTalk
// Spec: simpleTalk_gaze_input_reimplementation_spec.md
// Pipeline: pointermove → GazeFilter → TargetResolver → TargetLock → DwellController → action

(function () {
  'use strict';

  // ─── GazeSettings ────────────────────────────────────────────────────────────

  const SETTINGS_KEY = 'gazeEngineSettings_v1';

  const DEFAULTS = {
    enabled: false,
    alphaLow: 0.15,       // EMA coefficient when displacement < threshLowMid
    alphaMid: 0.45,       // EMA coefficient at mid-range displacement
    alphaHigh: 0.85,      // EMA coefficient for large movements
    threshLowMid: 60,     // px boundary between low/mid alpha
    threshMidHigh: 160,   // px boundary between mid/high alpha
    candidateTime: 200,   // ms before locking onto a candidate target
    dwellTime: 1000,      // ms dwell required for selection
    hysteresisRatio: 0.20,// hold-region = button size × this ratio
    deviationGrace: 100,  // ms of deviation before pausing dwell
    deviationPause: 300,  // ms of deviation before resetting dwell+lock
    cooldownTime: 700,    // ms after selection before next selection is allowed
    cursorDiameter: 56,   // px diameter of virtual cursor
    showVirtualCursor: true,
    showDebug: false,
  };

  let S = { ...DEFAULTS };

  function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) S = { ...DEFAULTS, ...JSON.parse(stored) };
    } catch (_) {}
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
  }

  // ─── GazeFilter (adaptive EMA) ────────────────────────────────────────────────

  let smoothX = null;
  let smoothY = null;
  let latestSmoothed = null;

  function filterSample(x, y) {
    if (!isFinite(x) || !isFinite(y)) return null;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;

    if (smoothX === null) {
      smoothX = x;
      smoothY = y;
      return { x, y };
    }

    const dx = x - smoothX;
    const dy = y - smoothY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let alpha;
    if (dist < S.threshLowMid) {
      alpha = S.alphaLow;
    } else if (dist < S.threshMidHigh) {
      const r = (dist - S.threshLowMid) / (S.threshMidHigh - S.threshLowMid);
      alpha = S.alphaLow + r * (S.alphaMid - S.alphaLow);
    } else {
      alpha = S.alphaHigh;
    }

    smoothX = alpha * x + (1 - alpha) * smoothX;
    smoothY = alpha * y + (1 - alpha) * smoothY;

    return { x: smoothX, y: smoothY };
  }

  function resetFilter() {
    smoothX = null;
    smoothY = null;
    latestSmoothed = null;
  }

  // ─── TargetResolver ──────────────────────────────────────────────────────────

  // Selector for all potential dwell targets
  const TARGET_SELECTOR = '.kana-btn, #speakBtn, #clearBtn';

  let buttonRects = []; // [{el, rect}]

  function cacheButtonRects() {
    buttonRects = [];
    document.querySelectorAll(TARGET_SELECTOR).forEach(el => {
      const rect = el.getBoundingClientRect();
      // Skip zero-size rects (hidden elements)
      if (rect.width === 0 || rect.height === 0) return;
      buttonRects.push({ el, rect });
    });
  }

  function isTargetActive(el) {
    return !el.disabled && !el.classList.contains('disabled') && el.style.opacity !== '0';
  }

  function resolveAt(x, y) {
    for (const { el, rect } of buttonRects) {
      if (!isTargetActive(el)) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return el;
      }
    }
    return null;
  }

  // Returns el if (x,y) is within el's hysteresis hold-region, otherwise resolveAt()
  function resolveWithHysteresis(x, y, preferEl) {
    if (preferEl) {
      for (const { el, rect } of buttonRects) {
        if (el !== preferEl) continue;
        const m = Math.min(rect.width, rect.height) * S.hysteresisRatio;
        if (x >= rect.left - m && x <= rect.right + m &&
            y >= rect.top - m && y <= rect.bottom + m) {
          return preferEl;
        }
      }
    }
    return resolveAt(x, y);
  }

  function setupRectCaching() {
    window.addEventListener('resize', cacheButtonRects, { passive: true });

    // Re-cache when modal opens/closes (class change on .modal)
    const mo = new MutationObserver(() => cacheButtonRects());
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // ─── State Machine ────────────────────────────────────────────────────────────

  const ST = {
    IDLE: 'IDLE',
    CANDIDATE: 'CANDIDATE',
    LOCKED: 'LOCKED',           // entered immediately, transitions to DWELLING synchronously
    DWELLING: 'DWELLING',
    ACTIVATED: 'ACTIVATED',
    COOLDOWN: 'COOLDOWN',
    RELEASE_REQUIRED: 'RELEASE_REQUIRED',
  };

  let state = ST.IDLE;
  let candidateEl = null;
  let lockedEl = null;

  // timers
  let tCandidate = null;
  let tDwell = null;
  let tCooldown = null;
  let tDeviation = null;

  // dwell progress tracking
  let dwellStart = null;        // performance.now() when dwell timer began this segment
  let dwellAccum = 0;           // ms already accumulated before current segment
  let dwellPaused = false;

  // deviation sub-state (within DWELLING)
  let isOffTarget = false;

  // ── State transition helpers ─────────────────────────────────────────────────

  function gotoState(s) {
    state = s;
    schedFeedback();
  }

  function enterCandidate(el) {
    candidateEl = el;
    gotoState(ST.CANDIDATE);

    clearTimeout(tCandidate);
    tCandidate = setTimeout(() => {
      if (state === ST.CANDIDATE && candidateEl) enterLocked(candidateEl);
    }, S.candidateTime);
  }

  function exitCandidate() {
    clearTimeout(tCandidate);
    tCandidate = null;
    candidateEl = null;
  }

  function enterLocked(el) {
    exitCandidate();
    lockedEl = el;
    isOffTarget = false;

    // LOCKED is transient; immediately start dwelling
    gotoState(ST.LOCKED);
    startDwell();
  }

  function startDwell() {
    dwellStart = performance.now();
    dwellAccum = 0;
    dwellPaused = false;
    gotoState(ST.DWELLING);
    scheduleDwellFire(S.dwellTime);
  }

  function scheduleDwellFire(remaining) {
    clearTimeout(tDwell);
    tDwell = setTimeout(() => {
      if (state === ST.DWELLING) activateTarget();
    }, remaining);
  }

  function pauseDwell() {
    if (dwellPaused) return;
    dwellPaused = true;
    clearTimeout(tDwell);
    dwellAccum += performance.now() - dwellStart;
  }

  function resumeDwell() {
    if (!dwellPaused) return;
    dwellPaused = false;
    dwellStart = performance.now();
    scheduleDwellFire(S.dwellTime - dwellAccum);
  }

  function resetDwellState() {
    clearTimeout(tDwell);
    tDwell = null;
    dwellStart = null;
    dwellAccum = 0;
    dwellPaused = false;
  }

  function getDwellProgress() {
    if (state !== ST.DWELLING) return 0;
    if (dwellPaused) return Math.min(dwellAccum / S.dwellTime, 1);
    if (!dwellStart) return 0;
    return Math.min((dwellAccum + (performance.now() - dwellStart)) / S.dwellTime, 1);
  }

  function clearLock() {
    clearTimeout(tDeviation);
    tDeviation = null;
    resetDwellState();
    lockedEl = null;
    isOffTarget = false;
  }

  function activateTarget() {
    const el = lockedEl;
    if (!el) return;

    clearLock();
    gotoState(ST.ACTIVATED);
    schedFeedback();

    fireAction(el);

    // Brief flash, then cooldown, then release-required (only if still on same target)
    tCooldown = setTimeout(() => {
      clearAllHighlights();
      clearProgressFromButton();
      gotoState(ST.COOLDOWN);

      tCooldown = setTimeout(() => {
        // If pointer already left the activated target during cooldown, go straight to IDLE
        const currentEl = latestSmoothed ? resolveAt(latestSmoothed.x, latestSmoothed.y) : null;
        if (currentEl !== el) {
          lockedEl = null;
          gotoState(ST.IDLE);
          if (currentEl) enterCandidate(currentEl);
        } else {
          lockedEl = el; // remember for RELEASE_REQUIRED
          gotoState(ST.RELEASE_REQUIRED);
        }
      }, S.cooldownTime);
    }, 120);
  }

  function fireAction(el) {
    // Synthetic click — audio is already initialized by the time gaze is used
    el.click();
  }

  // ─── Deviation handling (sub-state of DWELLING) ──────────────────────────────

  function onDeviationStart() {
    if (isOffTarget) return;
    isOffTarget = true;

    clearTimeout(tDeviation);
    tDeviation = setTimeout(() => {
      // Grace expired — pause dwell
      if (state === ST.DWELLING) {
        pauseDwell();
        schedFeedback();

        tDeviation = setTimeout(() => {
          // Pause limit reached — reset lock entirely
          const nextEl = latestSmoothed ? resolveAt(latestSmoothed.x, latestSmoothed.y) : null;
          clearLock();
          isOffTarget = false;
          if (nextEl) {
            enterCandidate(nextEl);
          } else {
            gotoState(ST.IDLE);
          }
        }, S.deviationPause - S.deviationGrace);
      } else {
        // Left target before dwell began; just unlock
        clearLock();
        isOffTarget = false;
        gotoState(ST.IDLE);
      }
    }, S.deviationGrace);
  }

  function onDeviationEnd() {
    if (!isOffTarget) return;
    isOffTarget = false;
    clearTimeout(tDeviation);
    tDeviation = null;
    if (dwellPaused) resumeDwell();
    schedFeedback();
  }

  // ─── Main processing loop ─────────────────────────────────────────────────────

  let prevEffectiveEl = null;

  function processSample(rawX, rawY) {
    const pt = filterSample(rawX, rawY);
    if (!pt) return;
    latestSmoothed = pt;

    // Position virtual cursor
    positionVirtualCursor(pt.x, pt.y);

    // Resolve effective target under smoothed position
    let effectiveEl;
    if (state === ST.DWELLING || state === ST.LOCKED) {
      effectiveEl = resolveWithHysteresis(pt.x, pt.y, lockedEl);
    } else if (state === ST.CANDIDATE) {
      effectiveEl = resolveWithHysteresis(pt.x, pt.y, candidateEl);
    } else if (state === ST.RELEASE_REQUIRED) {
      effectiveEl = resolveAt(pt.x, pt.y);
    } else {
      effectiveEl = resolveAt(pt.x, pt.y);
    }

    // Drive state machine from effective target transitions
    if (effectiveEl !== prevEffectiveEl) {
      prevEffectiveEl = effectiveEl;
      handleTargetTransition(effectiveEl);
    }

    schedFeedback();
  }

  function handleTargetTransition(newEl) {
    switch (state) {
      case ST.IDLE:
        if (newEl) enterCandidate(newEl);
        break;

      case ST.CANDIDATE:
        if (newEl !== candidateEl) {
          exitCandidate();
          if (newEl) {
            enterCandidate(newEl);
          } else {
            gotoState(ST.IDLE);
          }
        }
        break;

      case ST.LOCKED:
      case ST.DWELLING:
        if (newEl === lockedEl) {
          onDeviationEnd();
        } else {
          onDeviationStart();
        }
        break;

      case ST.ACTIVATED:
      case ST.COOLDOWN:
        // ignore pointer during activation flash and cooldown
        break;

      case ST.RELEASE_REQUIRED:
        // Allow re-entry on a different target, or idle-out
        if (newEl && newEl !== lockedEl) {
          lockedEl = null;
          gotoState(ST.IDLE);
          enterCandidate(newEl);
        } else if (!newEl) {
          lockedEl = null;
          gotoState(ST.IDLE);
        }
        break;
    }
  }

  // ─── PointerSampler ──────────────────────────────────────────────────────────

  function startPointerSampler() {
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave, { passive: true });
  }

  function onPointerMove(e) {
    if (!S.enabled) return;
    processSample(e.clientX, e.clientY);
  }

  function onPointerLeave() {
    if (!S.enabled) return;
    resetToIdle();
  }

  // ─── GazeFeedback ─────────────────────────────────────────────────────────────

  let virtualCursor = null;
  let feedbackPending = false;
  let progressEl = null;
  let progressBarEl = null;
  let progressOnBtn = null;
  const highlighted = new Set();

  function schedFeedback() {
    if (!feedbackPending) {
      feedbackPending = true;
      requestAnimationFrame(renderFeedback);
    }
  }

  function renderFeedback() {
    feedbackPending = false;
    if (!S.enabled) { clearAllFeedback(); return; }

    renderTargetHighlights();
    renderDwellProgress();
    renderCursorSize();
    renderDebugOverlay();
  }

  function clearAllHighlights() {
    highlighted.forEach(el => el.classList.remove('gaze-candidate', 'gaze-locked', 'gaze-activated'));
    highlighted.clear();
  }

  function renderTargetHighlights() {
    clearAllHighlights();
    switch (state) {
      case ST.CANDIDATE:
        if (candidateEl) { candidateEl.classList.add('gaze-candidate'); highlighted.add(candidateEl); }
        break;
      case ST.LOCKED:
      case ST.DWELLING:
        if (lockedEl) { lockedEl.classList.add('gaze-locked'); highlighted.add(lockedEl); }
        break;
      case ST.ACTIVATED:
        if (lockedEl) { lockedEl.classList.add('gaze-activated'); highlighted.add(lockedEl); }
        break;
    }
  }

  function renderDwellProgress() {
    const showProgress = (state === ST.DWELLING || state === ST.ACTIVATED) && lockedEl;

    if (!showProgress) {
      clearProgressFromButton();
      return;
    }

    if (progressOnBtn !== lockedEl) {
      clearProgressFromButton();
      attachProgressToButton(lockedEl);
    }

    const pct = state === ST.ACTIVATED ? 100 : getDwellProgress() * 100;
    if (progressBarEl) progressBarEl.style.width = pct + '%';
  }

  function attachProgressToButton(btn) {
    const wrap = document.createElement('div');
    wrap.className = 'gaze-dwell-indicator';
    progressBarEl = document.createElement('div');
    progressBarEl.className = 'gaze-dwell-bar';
    wrap.appendChild(progressBarEl);
    btn.style.position = 'relative';
    btn.appendChild(wrap);
    progressOnBtn = btn;
    progressEl = wrap;
  }

  function clearProgressFromButton() {
    if (progressEl && progressEl.parentNode) progressEl.parentNode.removeChild(progressEl);
    progressEl = null;
    progressBarEl = null;
    progressOnBtn = null;
  }

  function positionVirtualCursor(x, y) {
    if (!virtualCursor || !S.showVirtualCursor) return;
    virtualCursor.style.display = 'block';
    virtualCursor.style.left = x + 'px';
    virtualCursor.style.top = y + 'px';
  }

  function renderCursorSize() {
    if (!virtualCursor) return;
    const locked = state === ST.LOCKED || state === ST.DWELLING;
    const size = locked ? Math.round(S.cursorDiameter * 0.72) : S.cursorDiameter;
    virtualCursor.style.width = size + 'px';
    virtualCursor.style.height = size + 'px';
  }

  // ─── Debug overlay ────────────────────────────────────────────────────────────

  let debugEl = null;

  function renderDebugOverlay() {
    if (!S.showDebug) {
      if (debugEl) debugEl.style.display = 'none';
      return;
    }
    if (!debugEl) createDebugEl();
    debugEl.style.display = 'block';

    const raw = latestSmoothed ? `${Math.round(latestSmoothed.x)},${Math.round(latestSmoothed.y)}` : '—';
    const prog = Math.round(getDwellProgress() * 100);
    debugEl.textContent =
      `state: ${state}\nsmooth: ${raw}\nprogress: ${prog}%\n` +
      `locked: ${lockedEl ? (lockedEl.dataset.kana || lockedEl.id) : '—'}\n` +
      `candidate: ${candidateEl ? (candidateEl.dataset.kana || candidateEl.id) : '—'}`;
  }

  function createDebugEl() {
    debugEl = document.createElement('pre');
    debugEl.id = 'gaze-debug';
    debugEl.style.cssText =
      'position:fixed;bottom:80px;right:20px;background:rgba(0,0,0,0.75);' +
      'color:#0f0;font:11px monospace;padding:8px;border-radius:6px;' +
      'pointer-events:none;z-index:9998;white-space:pre;line-height:1.4;';
    document.body.appendChild(debugEl);
  }

  // ─── Full reset ───────────────────────────────────────────────────────────────

  function resetToIdle() {
    exitCandidate();
    clearLock();
    clearTimeout(tCooldown);
    tCooldown = null;
    isOffTarget = false;
    prevEffectiveEl = null;
    gotoState(ST.IDLE);
    clearAllFeedback();
    resetFilter();
  }

  function clearAllFeedback() {
    if (virtualCursor) virtualCursor.style.display = 'none';
    clearProgressFromButton();
    clearAllHighlights();
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  function enable() {
    S.enabled = true;
    // Prevent old dwell engine from double-firing
    if (typeof dwellSettings !== 'undefined') dwellSettings.enabled = false;
    resetToIdle();
    cacheButtonRects();
    saveSettings();
  }

  function disable() {
    S.enabled = false;
    resetToIdle();
    saveSettings();
  }

  function applySettings(patch) {
    S = { ...S, ...patch };
    if (!S.enabled) disable();
    saveSettings();
  }

  function getPublicSettings() { return { ...S }; }

  // ─── Settings UI wiring ────────────────────────────────────────────────────────

  function wireSettingsUI() {
    const toggle = document.getElementById('gazeEngineEnabled');
    const dwellTimeInput = document.getElementById('gazeDwellTime');
    const dwellTimeVal = document.getElementById('gazeDwellTimeValue');
    const candidateTimeInput = document.getElementById('gazeCandidateTime');
    const candidateTimeVal = document.getElementById('gazeCandidateTimeValue');
    const cursorToggle = document.getElementById('gazeShowCursor');
    const debugToggle = document.getElementById('gazeShowDebug');

    if (!toggle) return;

    function refreshUI() {
      toggle.checked = S.enabled;
      dwellTimeInput.value = S.dwellTime;
      dwellTimeVal.textContent = S.dwellTime + 'ms';
      candidateTimeInput.value = S.candidateTime;
      candidateTimeVal.textContent = S.candidateTime + 'ms';
      cursorToggle.checked = S.showVirtualCursor;
      debugToggle.checked = S.showDebug;

      // Disable old dwell settings UI when gaze engine is on
      const oldDwellSection = document.getElementById('oldDwellSection');
      if (oldDwellSection) oldDwellSection.style.opacity = S.enabled ? '0.4' : '1';
    }

    toggle.addEventListener('change', () => {
      if (toggle.checked) enable(); else disable();
      refreshUI();
    });

    dwellTimeInput.addEventListener('input', () => {
      dwellTimeVal.textContent = dwellTimeInput.value + 'ms';
    });

    candidateTimeInput.addEventListener('input', () => {
      candidateTimeVal.textContent = candidateTimeInput.value + 'ms';
    });

    // Save button (shared with existing settings)
    document.getElementById('saveSettings').addEventListener('click', () => {
      applySettings({
        enabled: toggle.checked,
        dwellTime: parseInt(dwellTimeInput.value) || S.dwellTime,
        candidateTime: parseInt(candidateTimeInput.value) || S.candidateTime,
        showVirtualCursor: cursorToggle.checked,
        showDebug: debugToggle.checked,
      });
      refreshUI();
    }, { capture: true }); // run before modal-close handler

    // Populate UI on modal open
    document.getElementById('settingsBtn').addEventListener('click', refreshUI);

    refreshUI();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  function createVirtualCursor() {
    virtualCursor = document.createElement('div');
    virtualCursor.id = 'gaze-cursor';
    document.body.appendChild(virtualCursor);
  }

  function init() {
    loadSettings();
    createVirtualCursor();
    startPointerSampler();
    setupRectCaching();

    // Cache after script.js has built the DOM
    setTimeout(cacheButtonRects, 400);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && S.enabled) resetToIdle();
    });

    window.addEventListener('resize', () => {
      if (S.enabled) resetToIdle();
    });

    wireSettingsUI();

    if (S.enabled) enable();

    window.GazeEngine = { enable, disable, applySettings, getSettings: getPublicSettings, cacheButtonRects };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
