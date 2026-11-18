/**
 * KAIGO Caregiver Web App v1.3
 * Zero-Screen-Complexity Caregiver Peace-of-Mind System
 * Caregiver Peace-of-Mind System
 */
(function () {
  'use strict';

  /* ----------------------------------------------------------
     CONFIG & STATE
     ---------------------------------------------------------- */
  var host = window.location.hostname || 'localhost';
  var API_BASE = window.location.protocol.indexOf('http') === 0
    ? window.location.protocol + '//' + host + ':5000'
    : 'http://localhost:5000';

  var C = {
    ink: '#000000', muted: '#595959', line: '#d5d5d5', axis: '#9b9b9b',
    blueBright: '#4a7ff7', orange: '#f8651b', blueDeep: '#1a28c4', sky: '#97d5fc', blue: '#305fdd',
    green: '#4a7ff7', red: '#f8651b', amber: '#f8651b'
  };

  var TAB_SLUG = {
    'tab-inicio': 'overview',
    'tab-enviar': 'ask',
    'tab-programar': 'schedule',
    'tab-historial': 'history',
    'tab-tendencias': 'insights'
  };

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

  var state = {
    connected: null,
    activeTab: 'tab-inicio',
    authToken: null,
    user: 'Cecil Howell',
    currentQuestion: null,
    schedules: [],
    history: [],
    historyLoaded: false,
    historyFilter: 'all',
    historySearch: '',
    lastAnswerId: null,
    spokenIds: {},
    activeSos: [],
    audio: null,
    analytics: null,
    aiInsights: null,
    charts: { pain: null, mood: null, meds: null, daily: null }
  };

  var dom = {};
  function $(id) { return document.getElementById(id); }

  function cacheDom() {
    // Auth & Overlays
    dom.loginOverlay = $('login-overlay');
    dom.loginForm = $('login-form');
    dom.loginUsername = $('login-username');
    dom.loginPassword = $('login-password');
    dom.loginRemember = $('login-remember');
    dom.loginSubmitBtn = $('login-submit-btn');
    dom.loginError = $('login-error');
    dom.btnSignOut = $('btn-sign-out');
    dom.userDisplayName = $('user-display-name');
    dom.userAvatarInitial = $('user-avatar-initial');

    // Gemini Modal
    dom.geminiModal = $('gemini-modal');
    dom.geminiKeyInput = $('gemini-key-input');
    dom.btnOpenGeminiModal = $('btn-open-gemini-modal');
    dom.btnCancelGemini = $('btn-cancel-gemini');
    dom.btnSaveGemini = $('btn-save-gemini');
    dom.btnRefreshAi = $('btn-refresh-ai');

    // Patient Profile & Onboarding Modals
    dom.patientModal = $('patient-modal');
    dom.btnOpenPatientModal = $('btn-edit-patient');
    dom.btnSidebarPatient = $('btn-sidebar-patient');
    dom.btnCancelPatient = $('btn-cancel-patient');
    dom.btnSavePatient = $('btn-save-patient');
    dom.patientNameInput = $('patient-name-input');
    dom.patientAgeInput = $('patient-age-input');
    dom.patientRelationInput = $('patient-relation-input');
    dom.patientConditionInput = $('patient-condition-input');

    // Full-Screen Interactive Onboarding & Judge Tour
    dom.onbScreen = $('onboarding-fullscreen');
    dom.onbStepIndicator = $('onb-step-indicator');
    dom.onbProgressDots = $('onb-progress-dots');
    dom.btnOnbSkip = $('btn-onb-skip');
    dom.onbDevice = $('onb-device-interactive');
    dom.onbTftFace = $('onb-tft-face');
    dom.onbSpeakerName = $('onb-speaker-name');
    dom.onbSpeechText = $('onb-speech-text');
    dom.onbSpeechSubtext = $('onb-speech-subtext');
    dom.btnOnbStart = $('btn-onb-start');

    // Step 1
    dom.onbNameInput = $('onb-name-input');
    dom.btnChipElena = $('btn-chip-elena');
    dom.btnOnbBack1 = $('btn-onb-back-1');
    dom.btnOnbNext1 = $('btn-onb-next-1');

    // Step 2
    dom.onbStep2Title = $('onb-step2-title');
    dom.onbAgeInput = $('onb-age-input');
    dom.onbRelationChips = $('onb-relation-chips');
    dom.onbRelationVal = $('onb-relation-val');
    dom.btnOnbBack2 = $('btn-onb-back-2');
    dom.btnOnbNext2 = $('btn-onb-next-2');

    // Step 3
    dom.onbStep3Title = $('onb-step3-title');
    dom.onbHealthTags = $('onb-health-tags');
    dom.onbConditionInput = $('onb-condition-input');
    dom.btnOnbBack3 = $('btn-onb-back-3');
    dom.btnOnbSaveProfile = $('btn-onb-save-profile');
    dom.btnOnbSkipTour = $('btn-onb-skip-tour');

    // Interactive Dashboard Spotlight Tour Elements
    dom.spotlightOverlay = $('dashboard-spotlight-tour');
    dom.spotlightFrame = $('tour-spotlight-frame');
    dom.spotlightCard = $('tour-callout-card');
    dom.btnSkipGuidedTour = $('btn-skip-guided-tour');
    dom.btnTourSpotPrev = $('btn-tour-spot-prev');
    dom.btnTourSpotNext = $('btn-tour-spot-next');
    dom.btnOpenTour = $('btn-open-tour');
    dom.btnSidebarTour = $('btn-sidebar-tour');
    dom.btnResetCleanSlate = $('btn-reset-clean-slate');
    dom.btnSidebarResetSlate = $('btn-sidebar-reset-slate');

    // Navigation & Status
    dom.statusDot = $('status-dot');
    dom.statusLabel = $('status-label');
    dom.offline = $('offline-banner');
    dom.navItems = document.querySelectorAll('.nav-item');
    dom.tabPanels = document.querySelectorAll('.tab-panel');

    // Home / Overview Tab
    dom.welcomeGreeting = $('welcome-greeting');
    dom.patientBannerName = $('patient-banner-name');
    dom.patientBannerDesc = $('patient-banner-desc');
    dom.hubStatusBadge = $('hub-status-badge');
    dom.hubStatusText = $('hub-status-text');
    dom.homeValWellness = $('home-val-wellness');
    dom.homeBasisWellness = $('home-basis-wellness');
    dom.homeChipWellness = $('home-chip-wellness');
    dom.homeValMeds = $('home-val-meds');
    dom.homeChipMeds = $('home-chip-meds');
    dom.homeValPain = $('home-val-pain');
    dom.homeChipPain = $('home-chip-pain');
    dom.homeValSos = $('home-val-sos');
    dom.homeChipSos = $('home-chip-sos');
    dom.aiSummaryText = $('ai-summary-text');
    dom.aiModelSource = $('ai-model-source');
    dom.aiRiskList = $('ai-risk-list');
    dom.aiActionList = $('ai-action-list');
    dom.btnGoToInsights = $('btn-go-to-insights');
    dom.homeRecentFeed = $('home-recent-feed');
    dom.quickCheckBtns = document.querySelectorAll('.btn-quick-check');

    // Ask Tab
    dom.questionInput = $('question-input');
    dom.charCount = $('char-count');
    dom.speechCheckbox = $('speech-checkbox');
    dom.sendBtn = $('send-question-btn');
    dom.presetBtns = document.querySelectorAll('.preset-btn');
    dom.currentQContent = $('current-question-content');
    dom.rangeScaleGuide = $('range-scale-guide');
    dom.typeRadios = document.querySelectorAll('input[name="question-type"]');
    dom.polarityRadios = document.querySelectorAll('input[name="scale-polarity"]');
    dom.scaleVisualBar = $('scale-visual-bar');
    dom.scaleGuideDesc = $('scale-guide-desc');
    dom.tickMin = $('tick-min');
    dom.tickMax = $('tick-max');

    // Schedule Tab
    dom.scheduleQuestion = $('schedule-question');
    dom.scheduleType = $('schedule-type');
    dom.schedulePolarity = $('schedule-polarity');
    dom.schedPolarityWrap = $('sched-polarity-wrap');
    dom.scheduleTime = $('schedule-time');
    dom.dayCbs = document.querySelectorAll('.day-cb');
    dom.addScheduleBtn = $('add-schedule-btn');
    dom.scheduleList = $('schedule-list');

    // History Tab
    dom.historyTbody = $('history-tbody');
    dom.historySearch = $('history-search');
    dom.filterBtns = document.querySelectorAll('.filter-btn');
    dom.btnClearHistory = $('btn-clear-history');

    // Insights Tab
    dom.statWellnessScore = $('stat-wellness-score');
    dom.statMedCompliance = $('stat-med-compliance');
    dom.statAvgPain = $('stat-avg-pain');
    dom.statAvgMood = $('stat-avg-mood');

    // SOS Overlay
    dom.sosOverlay = $('sos-overlay');
    dom.sosTimestamp = $('sos-timestamp');
    dom.sosCount = $('sos-count');
    dom.sosAckBtn = $('sos-ack-btn');

    dom.toastContainer = $('toast-container');
  }

  /* ----------------------------------------------------------
     HELPERS & SCALE POLARITY DISAMBIGUATION
     ---------------------------------------------------------- */
  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  function localKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function timeOf(d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function relTime(d) {
    if (!d) return '';
    var sec = Math.round((Date.now() - d.getTime()) / 1000);
    if (sec < 45) return 'just now';
    var min = Math.round(sec / 60);
    if (min < 60) return min + ' min ago';
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + ' h ago';
    return dayHeading(d) + ', ' + timeOf(d);
  }

  function dayHeading(d) {
    var today = localKey(new Date());
    var y = new Date(); y.setDate(y.getDate() - 1);
    var k = localKey(d);
    if (k === today) return 'Today';
    if (k === localKey(y)) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function isYes(a) {
    if (!a) return false;
    var s = String(a).trim().toUpperCase();
    return s === 'YES' || s === 'SI' || s === 'SÍ' || s === '1';
  }

  function isSos(r) { return r.sos || r.question_type === 'sos'; }

  function isPainQuestion(text) {
    var t = (text || '').toLowerCase();
    var keys = ['pain', 'dolor', 'ache', 'hurt', 'knee', 'back', 'head', 'rodilla', 'espalda', 'molestia', 'sore', 'joint', 'shoulder'];
    return keys.some(function (k) { return t.indexOf(k) !== -1; });
  }

  function isBetterHighQuestion(text) {
    var t = (text || '').toLowerCase();
    var keys = ['mood', 'ánimo', 'animo', 'sleep', 'dormi', 'energy', 'energía', 'energia', 'feel', 'feeling', 'sentir', 'bienestar', 'wellness', 'happy', 'rest'];
    return keys.some(function (k) { return t.indexOf(k) !== -1; });
  }

  function isMedicationQuestion(text) {
    var t = (text || '').toLowerCase();
    var keys = ['med', 'pill', 'pastilla', 'medicamento', 'medicine', 'remedio', 'dosis'];
    return keys.some(function (k) { return t.indexOf(k) !== -1; });
  }

  /**
   * Formats answer with clinical interpretation based on scale direction.
   * - worse_high: 1 is No Pain, 10 is Severe Pain
   * - better_high: 10 is Great/Optimal, 1 is Low/Poor
   */
  function formatAnswerInterpretation(qText, qType, answer, polarity) {
    if (qType === 'boolean') {
      var y = isYes(answer);
      if (isMedicationQuestion(qText)) {
        return y
          ? '<span class="badge-clinical badge-pain-none">YES · Taken</span>'
          : '<span class="badge-clinical badge-pain-severe">NO · Missed</span>';
      }
      return y
        ? '<span class="badge-clinical badge-pain-none">YES</span>'
        : '<span class="badge-clinical badge-pain-moderate">NO</span>';
    }

    if (qType === 'range') {
      var s = String(answer || '').trim();
      var num = parseFloat(s.indexOf('/') !== -1 ? s.split('/')[0] : s);
      if (isNaN(num)) return escapeHtml(answer);

      var pol = polarity || (isBetterHighQuestion(qText) ? 'better_high' : 'worse_high');

      if (pol === 'better_high') {
        // Higher is Better (Mood, Sleep, Energy)
        if (num >= 9) return '<span class="badge-clinical badge-wellness-great">' + num + '/10 · Great / Optimal</span>';
        if (num >= 7) return '<span class="badge-clinical badge-pain-mild">' + num + '/10 · Good</span>';
        if (num >= 5) return '<span class="badge-clinical badge-pain-moderate">' + num + '/10 · Fair / Moderate</span>';
        if (num >= 3) return '<span class="badge-clinical badge-pain-severe">' + num + '/10 · Low Mood</span>';
        return '<span class="badge-clinical badge-pain-critical">' + num + '/10 · Very Low / Poor</span>';
      } else {
        // Higher is Worse (Pain, Discomfort)
        if (num <= 1) return '<span class="badge-clinical badge-pain-none">' + num + '/10 · No Pain</span>';
        if (num <= 3) return '<span class="badge-clinical badge-pain-mild">' + num + '/10 · Mild Pain</span>';
        if (num <= 6) return '<span class="badge-clinical badge-pain-moderate">' + num + '/10 · Moderate Pain</span>';
        if (num <= 8) return '<span class="badge-clinical badge-pain-severe">' + num + '/10 · Severe Pain</span>';
        return '<span class="badge-clinical badge-pain-critical">' + num + '/10 · Unbearable</span>';
      }
    }

    return escapeHtml(answer);
  }

  function parseDays(days) {
    if (!days || days === 'all') return DAYS.slice();
    return String(days).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function dayNames(days) {
    var arr = parseDays(days);
    if (arr.length === 7) return 'Every day';
    if (arr.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every(function (d) { return arr.indexOf(d) !== -1; })) return 'Weekdays';
    if (arr.length === 2 && arr.indexOf('sat') !== -1 && arr.indexOf('sun') !== -1) return 'Weekends';
    return arr.map(function (d) { return DAY_LABEL[d] || d; }).join(', ');
  }

  function nextRun(s) {
    var days = parseDays(s.days);
    var parts = (s.schedule_time || '00:00').split(':');
    var now = new Date();
    for (var i = 0; i < 8; i++) {
      var d = new Date(now);
      d.setDate(now.getDate() + i);
      d.setHours(+parts[0], +parts[1], 0, 0);
      var key = DAYS[(d.getDay() + 6) % 7];
      if (days.indexOf(key) !== -1 && d > now) return d;
    }
    return null;
  }

  function fmt12(hhmm) {
    var p = (hhmm || '').split(':');
    if (p.length < 2) return hhmm || '';
    var d = new Date(); d.setHours(+p[0], +p[1], 0, 0);
    return timeOf(d);
  }

  function getInitials(name) {
    if (!name) return 'C';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  /* ----------------------------------------------------------
     TOASTS
     ---------------------------------------------------------- */
  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', function () { toast.remove(); });
    }, type === 'error' ? 5000 : 3200);
  }

  /* ----------------------------------------------------------
     API FETCH WITH AUTH HEADER
     ---------------------------------------------------------- */
  function apiFetch(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.authToken) headers['Authorization'] = 'Bearer ' + state.authToken;
    var fetchOpts = { method: opts.method || 'GET', headers: headers };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
    return fetch(API_BASE + path, fetchOpts)
      .then(function (res) {
        setConnected(true);
        var ct = res.headers.get('content-type') || '';
        var parse = ct.indexOf('application/json') !== -1 ? res.json() : res.text();
        return parse.then(function (data) {
          if (!res.ok) {
            var msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
            var e = new Error(msg); e.status = res.status; throw e;
          }
          return data;
        });
      })
      .catch(function (err) {
        if (err instanceof TypeError) {
          setConnected(false);
          err.message = 'Server not reachable';
        }
        throw err;
      });
  }

  function setConnected(val) {
    if (state.connected === val) return;
    state.connected = val;
    dom.statusDot.className = 'status-dot ' + (val ? 'connected' : 'disconnected');
    dom.statusLabel.textContent = val ? 'Server online' : 'Server offline';
    dom.offline.classList.toggle('hidden', val);
    if (dom.hubStatusBadge) {
      dom.hubStatusBadge.className = 'hub-status-badge ' + (val ? 'online' : 'offline');
      dom.hubStatusText.textContent = val ? 'Server connected' : 'Server offline';
    }
  }

  /* ----------------------------------------------------------
     AUTHENTICATION & LOGIN (Fades smoothly into dashboard)
     ---------------------------------------------------------- */
  // "Keep me signed in" -> localStorage, otherwise sessionStorage (cleared when the tab closes)
  function authGet(k) {
    try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function authSet(k, v, remember) {
    try {
      (remember ? localStorage : sessionStorage).setItem(k, v);
      (remember ? sessionStorage : localStorage).removeItem(k);
    } catch (e) {}
  }
  function authClear() {
    ['kaigo_token', 'kaigo_user', 'kaigo_account'].forEach(function (k) {
      try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {}
    });
  }

  function showLogin() {
    dom.loginOverlay.classList.remove('fade-out');
    dom.loginPassword.value = '';
    setTimeout(function () {
      var sel = document.querySelector('.account-row.selected');
      (sel ? dom.loginPassword : (document.querySelector('.account-row') || dom.loginPassword)).focus();
    }, 50);
  }

  function applySignedIn(user, account) {
    state.user = user;
    state.account = (account || '').toLowerCase();
    dom.userDisplayName.textContent = user;
    dom.userAvatarInitial.textContent = getInitials(user);
    dom.loginOverlay.classList.add('fade-out');
  }

  function checkAuth() {
    var token = authGet('kaigo_token');
    var user = authGet('kaigo_user');
    if (!token || !user) { showLogin(); return; }
    state.authToken = token;
    applySignedIn(user, authGet('kaigo_account'));
    // A stale token silently falls back to Cecil's data on the server, so verify it.
    apiFetch('/api/auth/verify').catch(function (err) {
      if (err && err.status === 401) {
        authClear();
        state.authToken = null;
        showLogin();
        showToast('Your session expired. Please sign in again.', 'info');
      }
    });
  }

  function selectAccount(btn) {
    document.querySelectorAll('.account-row').forEach(function (b) {
      b.classList.toggle('selected', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    dom.loginUsername.value = btn.getAttribute('data-user');
    $('login-username-group').classList.add('hidden');
    dom.loginPassword.value = '';
    dom.loginError.classList.add('hidden');
    dom.loginPassword.focus();
  }

  function bindAuth() {
    $('btn-login-other').addEventListener('click', function () {
      document.querySelectorAll('.account-row').forEach(function (b) { b.classList.remove('selected'); });
      $('login-username-group').classList.remove('hidden');
      dom.loginUsername.value = '';
      dom.loginUsername.focus();
    });

    dom.loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = dom.loginUsername.value.trim();
      var password = dom.loginPassword.value.trim();
      if (!username) {
        dom.loginError.textContent = 'Choose an account or enter a username.';
        dom.loginError.classList.remove('hidden');
        return;
      }
      if (!password) {
        dom.loginError.textContent = 'Enter your password.';
        dom.loginError.classList.remove('hidden');
        dom.loginPassword.focus();
        return;
      }

      dom.loginSubmitBtn.disabled = true;
      dom.loginSubmitBtn.textContent = 'Signing in';
      dom.loginError.classList.add('hidden');

      apiFetch('/api/auth/login', { method: 'POST', body: { username: username, password: password } })
        .then(function (res) {
          var remember = dom.loginRemember.checked;
          state.authToken = res.token;
          var display = res.username || username;
          var account = res.account_username || username;
          authSet('kaigo_token', res.token, remember);
          authSet('kaigo_user', display, remember);
          authSet('kaigo_account', account, remember);
          try { localStorage.setItem('kaigo_last_account', account.toLowerCase()); } catch (e) {}
          applySignedIn(display, account);
          updateGreeting();
          checkPatientProfile();
          refreshAll();
        })
        .catch(function (err) {
          dom.loginError.textContent = err.status === 401
            ? 'That password is not right. Try again.'
            : (err.message === 'Server not reachable' ? 'Can\'t reach the Kaigo server. Is server.py running?' : (err.message || 'Sign in failed.'));
          dom.loginError.classList.remove('hidden');
          dom.loginPassword.select();
        })
        .finally(function () {
          dom.loginSubmitBtn.disabled = false;
          dom.loginSubmitBtn.textContent = 'Sign in';
        });
    });

    dom.btnSignOut.addEventListener('click', function () {
      apiFetch('/api/auth/logout', { method: 'POST' }).catch(function () {});
      state.authToken = null;
      state.user = null;
      state.account = null;
      state.patientProfile = null;
      authClear();
      closeDashboardSpotlightTour();
      showLogin();
    });
  }

  /* ----------------------------------------------------------
     USER MANAGEMENT (LOGIN SCREEN - CREATE / DELETE CAREGIVERS)
     ---------------------------------------------------------- */
  function loadQuickUsers() {
    var container = $('login-quick-users');
    if (!container) return;
    apiFetch('/api/users')
      .then(function (res) {
        var users = (res && res.users) || [];
        container.innerHTML = '';
        if (!users.length) { $('login-username-group').classList.remove('hidden'); return; }
        users.forEach(function (u) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'account-row';
          btn.setAttribute('role', 'option');
          btn.setAttribute('data-user', u.username);
          btn.innerHTML =
            '<span class="account-avatar">' + escapeHtml(getInitials(u.display_name || u.username)) + '</span>' +
            '<span class="account-name">' + escapeHtml(u.display_name || u.username) + '</span>' +
            '<span class="account-role">' + escapeHtml(u.role || 'Caregiver') + '</span>';
          btn.addEventListener('click', function () { selectAccount(this); });
          container.appendChild(btn);
        });
        var last = null;
        try { last = localStorage.getItem('kaigo_last_account'); } catch (e) {}
        var match = last && container.querySelector('[data-user="' + last.replace(/"/g, '') + '" i]');
        if (match && !dom.loginOverlay.classList.contains('fade-out')) selectAccount(match);
      })
      .catch(function () {
        container.innerHTML = '';
        $('login-username-group').classList.remove('hidden');
        dom.loginError.textContent = 'Can\'t reach the Kaigo server. Start server.py, then refresh.';
        dom.loginError.classList.remove('hidden');
      });
  }

  function renderManageUsersList(users) {
    var list = $('manage-users-list');
    if (!list) return;
    if (!users || !users.length) {
      list.innerHTML = '<p style="font-size:12px;color:var(--ink-muted);text-align:center;padding:12px;">No users found.</p>';
      return;
    }
    list.innerHTML = '';
    users.forEach(function (u) {
      var item = document.createElement('div');
      item.className = 'user-mgmt-item';
      var initials = (u.display_name || u.username).charAt(0).toUpperCase();

      var rightAction = u.is_protected
        ? '<span class="badge-protected">Built-in</span>'
        : '<button type="button" class="btn-delete-user" data-user="' + escapeHtml(u.username) + '" data-name="' + escapeHtml(u.display_name) + '">Delete</button>';

      item.innerHTML =
        '<div class="user-mgmt-left">' +
          '<div class="user-mgmt-avatar">' + initials + '</div>' +
          '<div>' +
            '<div class="user-mgmt-name">' + escapeHtml(u.display_name) + '</div>' +
            '<div class="user-mgmt-sub">@' + escapeHtml(u.username) + ' &bull; ' + escapeHtml(u.role || 'Caregiver') + '</div>' +
          '</div>' +
        '</div>' +
        '<div>' + rightAction + '</div>';

      list.appendChild(item);
    });

    // Bind delete actions
    list.querySelectorAll('.btn-delete-user').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var uname = this.getAttribute('data-user');
        var dname = this.getAttribute('data-name');
        if (!confirm('Are you sure you want to delete caregiver account "' + dname + '"?')) return;

        apiFetch('/api/users/' + encodeURIComponent(uname), { method: 'DELETE' })
          .then(function () {
            showToast('Account "' + dname + '" deleted.', 'success');
            openManageUsersModal();
            loadQuickUsers();
          })
          .catch(function (err) {
            showToast('Cannot delete user: ' + (err.message || err), 'error');
          });
      });
    });
  }

  function openManageUsersModal() {
    var modal = $('manage-users-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    apiFetch('/api/users')
      .then(function (res) {
        if (res && res.users) renderManageUsersList(res.users);
      })
      .catch(function (err) {
        showToast('Could not load users: ' + (err.message || err), 'error');
      });
  }

  function bindManageUsers() {
    loadQuickUsers();

    var btnOpen = $('btn-open-manage-users');
    if (btnOpen) btnOpen.addEventListener('click', openManageUsersModal);

    var btnClose = $('btn-close-manage-users');
    if (btnClose) btnClose.addEventListener('click', function () {
      var modal = $('manage-users-modal');
      if (modal) modal.classList.add('hidden');
    });

    var btnDone = $('btn-done-manage-users');
    if (btnDone) btnDone.addEventListener('click', function () {
      var modal = $('manage-users-modal');
      if (modal) modal.classList.add('hidden');
    });

    var btnCreate = $('btn-create-user');
    if (btnCreate) {
      btnCreate.addEventListener('click', function () {
        var fullNameInput = $('new-user-fullname');
        var usernameInput = $('new-user-username');
        var passwordInput = $('new-user-password');
        var roleInput = $('new-user-role');

        var fullName = (fullNameInput ? fullNameInput.value : '').trim();
        var username = (usernameInput ? usernameInput.value : '').trim().toLowerCase();
        var password = (passwordInput ? passwordInput.value : '').trim() || '1234';
        var role = roleInput ? roleInput.value : 'Caregiver';

        if (!fullName) {
          showToast('Please enter a full name / display name.', 'warning');
          if (fullNameInput) fullNameInput.focus();
          return;
        }
        if (!username) {
          showToast('Please enter a login username.', 'warning');
          if (usernameInput) usernameInput.focus();
          return;
        }

        btnCreate.disabled = true;
        btnCreate.textContent = 'Creating...';

        apiFetch('/api/users', {
          method: 'POST',
          body: { username: username, display_name: fullName, password: password, role: role }
        })
          .then(function () {
            showToast('Account "' + fullName + '" created! You can now sign in.', 'success');
            if (fullNameInput) fullNameInput.value = '';
            if (usernameInput) usernameInput.value = '';
            if (passwordInput) passwordInput.value = '1234';
            openManageUsersModal();
            loadQuickUsers();
          })
          .catch(function (err) {
            showToast('Error creating user: ' + (err.message || err), 'error');
          })
          .finally(function () {
            btnCreate.disabled = false;
            btnCreate.textContent = 'Create account';
          });
      });
    }
  }

  /* ----------------------------------------------------------
     GEMINI API CONFIGURATION MODAL
     ---------------------------------------------------------- */
  function bindGeminiModal() {
    dom.btnOpenGeminiModal.addEventListener('click', function () {
      apiFetch('/api/settings/gemini')
        .then(function (res) {
          dom.geminiKeyInput.placeholder = res.has_key ? (res.preview || 'Configured') : 'AIzaSy...';
          dom.geminiKeyInput.value = '';
          dom.geminiModal.classList.remove('hidden');
        })
        .catch(function () { dom.geminiModal.classList.remove('hidden'); });
    });

    dom.btnCancelGemini.addEventListener('click', function () {
      dom.geminiModal.classList.add('hidden');
    });

    dom.btnSaveGemini.addEventListener('click', function () {
      var key = dom.geminiKeyInput.value.trim();
      if (!key) { showToast('Please enter an API key.', 'warning'); return; }
      dom.btnSaveGemini.disabled = true;
      dom.btnSaveGemini.textContent = 'Saving...';
      apiFetch('/api/settings/gemini', { method: 'POST', body: { api_key: key } })
        .then(function () {
          showToast('Gemini API key saved successfully!', 'success');
          dom.geminiModal.classList.add('hidden');
          fetchAiInsights(true);
        })
        .catch(function (err) { showToast('Failed to save key: ' + err.message, 'error'); })
        .finally(function () {
          dom.btnSaveGemini.disabled = false;
          dom.btnSaveGemini.textContent = 'Save Key';
        });
    });

    dom.btnRefreshAi.addEventListener('click', function () {
      dom.btnRefreshAi.disabled = true;
        dom.btnRefreshAi.textContent = 'Refreshing';
      fetchAiInsights(true).finally(function () {
        dom.btnRefreshAi.disabled = false;
        dom.btnRefreshAi.textContent = 'Refresh';
      });
    });

    dom.btnGoToInsights.addEventListener('click', function () { switchTab('tab-tendencias'); });
  }

  /* ----------------------------------------------------------
     FULL-SCREEN INTERACTIVE ONBOARDING & JUDGE PITCH WALKTHROUGH
     ---------------------------------------------------------- */
  var onbCurrentStep = 0;
  var currentTourSlide = 0;
  var onbExpressions = [
    { name: 'Classic Anime Sparkle', class: 'face-sparkle', say: 'I am excited to help you care for your family!' },
    { name: 'Cat Sparkle (ω)', class: 'face-cat', say: 'Nya~ I am ready for our daily check-in questions!' },
    { name: 'Playful Wink', class: 'face-wink', say: 'Don\'t worry! I keep track of all morning medications.' },
    { name: 'Heart Eyes (ᗜ)', class: 'face-hearts', say: 'I love keeping seniors safe, happy, and connected!' },
    { name: 'Laughing Squint (⌒ ⌒)', class: 'face-squint', say: 'Zero confusing touchscreens—just big tactile buttons!' }
  ];
  var onbFaceIdx = 0;

  var tourSlideDetails = [
    { badge: 'Platform Tour • Step 1 of 4', title: 'Zero-Friction Physical Hub', subtitle: 'How Kaigo bridges the physical senior world with clinical AI intelligence.' },
    { badge: 'Platform Tour • Step 2 of 4', title: 'Proactive Routines & Adaptive Dials', subtitle: 'Automating morning pills, pain checks, and smart inverted scales.' },
    { badge: 'Platform Tour • Step 3 of 4', title: 'Google Gemini AI Copilot', subtitle: 'Longitudinal clinical pattern intelligence & 0-100 wellness index.' },
    { badge: 'Platform Tour • Step 4 of 4', title: 'Panic-Free 3-Second SOS', subtitle: 'Deliberate press filtering, calm chimes, and instant WhatsApp dispatch.' }
  ];

  function setTourSlide(idx) {
    currentTourSlide = Math.max(0, Math.min(3, idx));
    var slides = document.querySelectorAll('.tour-slide');
    slides.forEach(function (s) {
      var n = parseInt(s.getAttribute('data-slide'), 10);
      s.classList.toggle('active', n === currentTourSlide);
    });
    var dots = document.querySelectorAll('.tour-dot');
    dots.forEach(function (d) {
      var n = parseInt(d.getAttribute('data-dot'), 10);
      d.classList.toggle('active', n === currentTourSlide);
    });

    var detail = tourSlideDetails[currentTourSlide];
    if (dom.onbTourStepBadge) dom.onbTourStepBadge.textContent = detail.badge;
    if (dom.onbTourTitle) dom.onbTourTitle.textContent = detail.title;
    if (dom.onbTourSubtitle) dom.onbTourSubtitle.textContent = detail.subtitle;

    if (dom.btnTourPrev) dom.btnTourPrev.disabled = (currentTourSlide === 0);
    if (dom.btnTourNext) {
      dom.btnTourNext.textContent = (currentTourSlide === 3) ? 'Finish & Open Dashboard' : 'Next Step →';
    }
  }

  function getCaregiverFirstName() {
    var full = (typeof state.user === 'string' && state.user) ? state.user : (state.user && state.user.name ? state.user.name : 'Caregiver');
    return full.split(' ')[0] || 'Caregiver';
  }

  function getLovedOneFirstName() {
    var raw = '';
    if (state.patientProfile && state.patientProfile.name) {
      raw = state.patientProfile.name;
    } else if (state.analytics && state.analytics.patient && state.analytics.patient.name) {
      raw = state.analytics.patient.name;
    } else if (dom.onbNameInput && dom.onbNameInput.value) {
      raw = dom.onbNameInput.value.trim();
    }
    return raw ? raw.split(' ')[0] : 'Loved One';
  }

  function updateDynamicPatientLabels() {
    var pName = getLovedOneFirstName();
    var presetsTitle = $('presets-card-title');
    if (presetsTitle) presetsTitle.textContent = (pName === 'Loved One') ? 'Quick Presets' : ('Presets for ' + pName);
    var schedLabel = $('schedule-page-label');
    if (schedLabel) schedLabel.textContent = (pName === 'Loved One') ? 'Recurring check-ins' : ('Recurring check-ins for ' + pName);
  }

  function setOnboardingStep(step) {
    onbCurrentStep = Math.max(0, Math.min(4, step));

    // Update Progress Indicator & Dots
    var stepNames = ['Welcome', 'Name', 'Details', 'Health', 'Done'];
    if (dom.onbStepIndicator) dom.onbStepIndicator.textContent = stepNames[onbCurrentStep];

    document.querySelectorAll('.onb-dot').forEach(function (dot) {
      var n = parseInt(dot.getAttribute('data-step'), 10);
      dot.classList.toggle('active', n === onbCurrentStep);
      dot.classList.toggle('completed', n < onbCurrentStep);
    });

    // Update Kaigo-kun Expression & Speech
    var caregiver = getCaregiverFirstName();
    var lovedOne = getLovedOneFirstName();

    if (dom.onbTftFace) {
      dom.onbTftFace.className = 'tft-face-canvas face-online';
    }

    if (onbCurrentStep === 0) {
      if (dom.onbTftFace) dom.onbTftFace.classList.add('face-sparkle');
      if (dom.onbSpeechText) dom.onbSpeechText.textContent = "Hi " + caregiver + ", I'm Kaigo.";
      if (dom.onbSpeechSubtext) {
        dom.onbSpeechSubtext.textContent = "I sit by their bed, ask simple questions, and tell you if something's wrong.";
      }
    } else if (onbCurrentStep === 1) {
      if (dom.onbTftFace) dom.onbTftFace.classList.add('face-cat');
      if (dom.onbSpeechText) dom.onbSpeechText.textContent = "Who are we caring for?";
      if (dom.onbSpeechSubtext) {
        dom.onbSpeechSubtext.textContent = "I'll greet them by name every morning.";
      }
    } else if (onbCurrentStep === 2) {
      if (dom.onbTftFace) dom.onbTftFace.classList.add('face-wink');
      if (dom.onbSpeechText) dom.onbSpeechText.textContent = "Nice to meet " + lovedOne + ".";
      if (dom.onbSpeechSubtext) {
        dom.onbSpeechSubtext.textContent = "Calibrates baseline health metrics.";
      }
      if (dom.onbStep2Title) dom.onbStep2Title.textContent = "How old is " + lovedOne + "?";
    } else if (onbCurrentStep === 3) {
      if (dom.onbTftFace) dom.onbTftFace.classList.add('face-sparkle');
      if (dom.onbSpeechText) dom.onbSpeechText.textContent = "What should I watch for?";
      if (dom.onbSpeechSubtext) {
        dom.onbSpeechSubtext.textContent = "I'll focus daily questions on these habits.";
      }
      if (dom.onbStep3Title) dom.onbStep3Title.textContent = "What should I watch for?";
    } else if (onbCurrentStep === 4) {
      if (dom.onbTftFace) dom.onbTftFace.classList.add('face-squint');
      if (dom.onbSpeechText) dom.onbSpeechText.textContent = "I'm ready.";
      if (dom.onbSpeechSubtext) dom.onbSpeechSubtext.textContent = "I'll say good morning to " + lovedOne + " tomorrow.";
      var dl = $('onb-done-lead');
      if (dl) dl.textContent = "Kaigo will start checking in with " + lovedOne + ". Answers show up on your dashboard as they come in.";
    }

    // Toggle Step Cards
    for (var s = 0; s <= 4; s++) {
      var card = $('onb-step-' + s);
      if (card) {
        if (s === onbCurrentStep) {
          card.classList.remove('hidden');
          // Restart animation
          card.style.animation = 'none';
          card.offsetHeight; // trigger reflow
          card.style.animation = '';
        } else {
          card.classList.add('hidden');
        }
      }
    }

    // Focus input when entering step 1
    if (onbCurrentStep === 1 && dom.onbNameInput) {
      setTimeout(function () { dom.onbNameInput.focus(); }, 150);
    }
  }

  function showOnboardingScreen(step) {
    if (!dom.onbScreen) return;
    dom.onbScreen.classList.remove('hidden');
    dom.onbScreen.style.opacity = '1';
    setOnboardingStep(typeof step === 'number' ? step : 0);
  }

  function closeOnboardingScreen() {
    if (!dom.onbScreen) return;
    dom.onbScreen.style.opacity = '0';
    setTimeout(function () {
      dom.onbScreen.classList.add('hidden');
    }, 350);
  }

  function checkPatientProfile() {
    return apiFetch('/api/patient')
      .then(function (res) {
        if (!res) return;
        state.patientProfile = res.patient;
        if (res.has_patient && res.patient) {
          if (dom.patientBannerName) dom.patientBannerName.textContent = 'Caring for ' + res.patient.name;
          if (dom.patientBannerDesc) {
            var details = [res.patient.relation || 'Loved One'];
            if (res.patient.age) details.push(res.patient.age + ' yrs old');
            if (res.patient.condition) details.push(res.patient.condition);
            dom.patientBannerDesc.textContent = details.join(' • ');
          }
          if (dom.patientNameInput) dom.patientNameInput.value = res.patient.name || '';
          if (dom.patientAgeInput) dom.patientAgeInput.value = res.patient.age || '';
          if (dom.patientRelationInput) dom.patientRelationInput.value = res.patient.relation || 'Loved One';
          if (dom.patientConditionInput) dom.patientConditionInput.value = res.patient.condition || '';
          updateDynamicPatientLabels();
        } else {
          // Brand-new caregiver with NO patient registered yet!
          if (dom.patientBannerName) dom.patientBannerName.textContent = 'No loved one registered yet';
          if (dom.patientBannerDesc) dom.patientBannerDesc.textContent = 'Use Edit to add their profile.';
          updateDynamicPatientLabels();
          showOnboardingScreen(0);
        }
      })
      .catch(function () {});
  }

  function bindOnboardingControls() {
    // Interactive click on Kaigo-kun device
    if (dom.onbDevice) {
      dom.onbDevice.addEventListener('click', function () {
        onbFaceIdx = (onbFaceIdx + 1) % onbExpressions.length;
        var cur = onbExpressions[onbFaceIdx];
        if (dom.onbTftFace) {
          dom.onbTftFace.className = 'tft-face-canvas face-online ' + cur.class;
        }
        if (dom.onbSpeechText) {
          dom.onbSpeechText.textContent = 'Kaigo: ' + cur.name + '';
        }
        if (dom.onbSpeechSubtext) {
          dom.onbSpeechSubtext.textContent = cur.say;
        }
      });
    }

    // Direct dot navigation
    var dots = document.querySelectorAll('.onb-dot');
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var s = parseInt(this.getAttribute('data-step'), 10);
        if (!isNaN(s)) setOnboardingStep(s);
      });
    });

    // Skip Button
    if (dom.btnOnbSkip) {
      dom.btnOnbSkip.addEventListener('click', function () {
        closeOnboardingScreen();
      });
    }

    // Step 0 -> Step 1
    if (dom.btnOnbStart) {
      dom.btnOnbStart.addEventListener('click', function () {
        setOnboardingStep(1);
      });
    }

    // Step 1: Continue
    if (dom.btnOnbNext1) {
      dom.btnOnbNext1.addEventListener('click', function () {
        var name = (dom.onbNameInput.value || '').trim();
        if (!name) {
          showToast('Please enter your loved one\'s name to continue.', 'warning');
          if (dom.onbNameInput) dom.onbNameInput.focus();
          return;
        }
        setOnboardingStep(2);
      });
    }
    if (dom.btnOnbBack1) {
      dom.btnOnbBack1.addEventListener('click', function () {
        setOnboardingStep(0);
      });
    }

    // Step 2: Relationship Chips
    var relChips = document.querySelectorAll('.onb-rel-chip');
    relChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        relChips.forEach(function (c) { c.classList.remove('active'); });
        this.classList.add('active');
        if (dom.onbRelationVal) {
          dom.onbRelationVal.value = this.getAttribute('data-rel') || 'Mother';
        }
      });
    });

    // Step 2: Continue
    if (dom.btnOnbNext2) {
      dom.btnOnbNext2.addEventListener('click', function () {
        setOnboardingStep(3);
      });
    }
    if (dom.btnOnbBack2) {
      dom.btnOnbBack2.addEventListener('click', function () {
        setOnboardingStep(1);
      });
    }

    // Step 3: Health Tag Chips (Clean toggle without pre-selected values)
    var healthTags = document.querySelectorAll('.onb-tag-chip');
    healthTags.forEach(function (tag) {
      tag.addEventListener('click', function () {
        this.classList.toggle('active');
        // Rebuild textarea notes
        var activeTags = [];
        healthTags.forEach(function (t) {
          if (t.classList.contains('active')) {
            activeTags.push(t.getAttribute('data-tag'));
          }
        });
        if (dom.onbConditionInput) {
          dom.onbConditionInput.value = activeTags.length ? (activeTags.join('. ') + '.') : '';
        }
      });
    });

    // Step 3: Save Profile & Advance to Platform Tour
    if (dom.btnOnbSaveProfile) {
      dom.btnOnbSaveProfile.addEventListener('click', function () {
        var name = (dom.onbNameInput ? dom.onbNameInput.value : '').trim();
        var age = (dom.onbAgeInput ? dom.onbAgeInput.value : '').trim();
        var relation = (dom.onbRelationVal ? dom.onbRelationVal.value : 'Mother') || 'Mother';
        var condition = (dom.onbConditionInput ? dom.onbConditionInput.value : '').trim();

        if (!name) {
          showToast('Please enter your loved one\'s name to continue.', 'warning');
          setOnboardingStep(1);
          return;
        }

        dom.btnOnbSaveProfile.disabled = true;
        dom.btnOnbSaveProfile.textContent = 'Saving';

        apiFetch('/api/patient', {
          method: 'POST',
          body: { name: name, age: age, relation: relation, condition: condition }
        })
          .then(function (res) {
            checkPatientProfile();
            fetchAnalytics();
            fetchAiInsights(true);
            setOnboardingStep(4);
          })
          .catch(function (err) {
            showToast('Error saving profile: ' + (err.message || err), 'error');
          })
          .finally(function () {
            dom.btnOnbSaveProfile.disabled = false;
            dom.btnOnbSaveProfile.textContent = 'Finish setup';
          });
      });
    }
    if (dom.btnOnbBack3) {
      dom.btnOnbBack3.addEventListener('click', function () {
        setOnboardingStep(2);
      });
    }

    var btnFinish = $('btn-onb-finish');
    if (btnFinish) btnFinish.addEventListener('click', function () {
      closeOnboardingScreen();
      switchTab('tab-inicio');
    });
    var btnTour = $('btn-onb-tour');
    if (btnTour) btnTour.addEventListener('click', function () {
      closeOnboardingScreen();
      setTimeout(function () { startDashboardSpotlightTour(0); }, 350);
    });

    // Enter advances onboarding steps
    document.querySelectorAll('[data-enter]').forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var b = $(this.getAttribute('data-enter'));
        if (b) b.click();
      });
    });

    if (dom.btnOnbSkipTour) {
      dom.btnOnbSkipTour.addEventListener('click', function () {
        closeOnboardingScreen();
        showToast('Onboarding completed! Welcome to Kaigo Dashboard.', 'info');
      });
    }

    // Header buttons to open spotlight tour / onboarding
    if (dom.btnOpenTour) {
      dom.btnOpenTour.addEventListener('click', function () {
        if (state.patientProfile && state.patientProfile.name) {
          startDashboardSpotlightTour(0);
        } else {
          showOnboardingScreen(0);
        }
      });
    }
    if (dom.btnSidebarTour) {
      dom.btnSidebarTour.addEventListener('click', function () {
        if (state.patientProfile && state.patientProfile.name) {
          startDashboardSpotlightTour(0);
        } else {
          showOnboardingScreen(0);
        }
      });
    }

    // Reset Clean Slate actions (for Diego / fresh judge walk-throughs)
    function resetCaregiverToCleanSlate(silent) {
      var isDiego = state.account === 'diego';
      var confirmMsg = isDiego
        ? 'Reset Diego\'s account to a clean slate? This will clear his loved one profile so you can present the onboarding and interactive tutorial from the beginning.'
        : 'Reset account to demo defaults?';

      if (!silent && !confirm(confirmMsg)) {
        return;
      }

      apiFetch('/api/patient/reset', { method: 'POST' })
        .then(function () {
          state.patientProfile = null;
          if (dom.onbNameInput) dom.onbNameInput.value = '';
          if (dom.onbAgeInput) dom.onbAgeInput.value = '';
          if (dom.onbConditionInput) dom.onbConditionInput.value = '';
          var tags = document.querySelectorAll('.onb-tag-chip');
          tags.forEach(function (t) { t.classList.remove('active'); });

          showToast('Account reset to clean slate! Ready for demo.', 'success');
          closeDashboardSpotlightTour();
          checkPatientProfile();
          fetchAnalytics();
          fetchAiInsights(true);
        })
        .catch(function (err) {
          showToast('Reset failed: ' + (err.message || err), 'error');
        });
    }

    if (dom.btnResetCleanSlate) {
      dom.btnResetCleanSlate.addEventListener('click', function () {
        resetCaregiverToCleanSlate(false);
      });
    }
    if (dom.btnSidebarResetSlate) {
      dom.btnSidebarResetSlate.addEventListener('click', function () {
        resetCaregiverToCleanSlate(false);
      });
    }

    // Small Manage Loved One modal (for later edits)
    function openPatientModal() {
      apiFetch('/api/patient')
        .then(function (res) {
          if (res && res.has_patient && res.patient) {
            if (dom.patientNameInput) dom.patientNameInput.value = res.patient.name || '';
            if (dom.patientAgeInput) dom.patientAgeInput.value = res.patient.age || '';
            if (dom.patientRelationInput) dom.patientRelationInput.value = res.patient.relation || 'Mother';
            if (dom.patientConditionInput) dom.patientConditionInput.value = res.patient.condition || '';
          }
          if (dom.patientModal) dom.patientModal.classList.remove('hidden');
        })
        .catch(function () {
          if (dom.patientModal) dom.patientModal.classList.remove('hidden');
        });
    }

    if (dom.btnOpenPatientModal) dom.btnOpenPatientModal.addEventListener('click', openPatientModal);
    if (dom.btnSidebarPatient) dom.btnSidebarPatient.addEventListener('click', openPatientModal);
    if (dom.btnCancelPatient) {
      dom.btnCancelPatient.addEventListener('click', function () {
        if (dom.patientModal) dom.patientModal.classList.add('hidden');
      });
    }

    if (dom.btnSavePatient) {
      dom.btnSavePatient.addEventListener('click', function () {
        var name = (dom.patientNameInput.value || '').trim();
        var age = (dom.patientAgeInput.value || '').trim();
        var relation = (dom.patientRelationInput.value || '').trim();
        var condition = (dom.patientConditionInput.value || '').trim();

        if (!name) {
          showToast('Please enter your loved one\'s name.', 'warning');
          return;
        }

        dom.btnSavePatient.disabled = true;
        dom.btnSavePatient.textContent = 'Saving...';

        apiFetch('/api/patient', {
          method: 'POST',
          body: { name: name, age: age, relation: relation, condition: condition }
        })
          .then(function (res) {
            showToast('Profile updated for ' + name + '!', 'success');
            if (dom.patientModal) dom.patientModal.classList.add('hidden');
            checkPatientProfile();
            fetchAnalytics();
            fetchAiInsights(true);
          })
          .catch(function (err) {
            showToast('Error saving profile: ' + (err.message || err), 'error');
          })
          .finally(function () {
            dom.btnSavePatient.disabled = false;
            dom.btnSavePatient.textContent = 'Save Profile';
          });
      });
    }
  }

  /* ----------------------------------------------------------
     INTERACTIVE DASHBOARD SPOTLIGHT TOUR (GUIDED LIVE POINTER)
     ---------------------------------------------------------- */
  var currentSpotlightStep = 0;
  // tab: which panel to show behind the step. placement 'right' puts the card
  // beside a sidebar item on desktop (on phones the nav is a bottom bar).
  var spotlightSteps = [
    { tab: 'tab-inicio', targetSelector: '#companion-hub-box', title: 'Kaigo at a glance',
      body: 'This is the same face your loved one sees on the bedside hub. Its expression follows how they are doing.',
      hint: 'Tap the face to preview each mood.' },
    { tab: 'tab-inicio', targetSelector: '.ai-copilot-card', title: 'Summary',
      body: 'Kaigo reads recent answers and writes a short summary, with anything that needs your attention.' },
    { tab: 'tab-inicio', targetSelector: '.wellness-hero-grid', title: 'Key numbers',
      body: 'Wellness score, medication taken, latest pain, and SOS alerts. They update as answers come in.' },
    { tab: 'tab-inicio', targetSelector: '#card-quick-checkin', title: 'Ask in one tap',
      body: 'These send straight to the hub and are read aloud.' },
    { tab: 'tab-inicio', targetSelector: '.nav-list', placement: 'right', title: 'Five tabs',
      body: 'Everything lives in this sidebar. You are on Today. Next, a quick look at the other four.' },
    { tab: 'tab-enviar', targetSelector: '.nav-item[data-tab="tab-enviar"]', placement: 'right', title: 'Ask',
      body: 'Write your own yes/no or 1 to 10 question, or start from a preset. It shows on the hub and is read aloud.' },
    { tab: 'tab-programar', targetSelector: '.nav-item[data-tab="tab-programar"]', placement: 'right', title: 'Schedule',
      body: 'Set recurring check-ins like morning pills or an evening pain check. The server sends them on time, even with this page closed.' },
    { tab: 'tab-historial', targetSelector: '.nav-item[data-tab="tab-historial"]', placement: 'right', title: 'History',
      body: 'Every answer and SOS alert with the time it happened, newest first.' },
    { tab: 'tab-tendencias', targetSelector: '.nav-item[data-tab="tab-tendencias"]', placement: 'right', title: 'Insights',
      body: 'Charts for pain, mood and energy, medication, and daily activity over time.' }
  ];

  function renderSpotlightDots() {
    var wrap = $('tour-spot-dots');
    if (!wrap || wrap.childElementCount === spotlightSteps.length) return;
    wrap.innerHTML = '';
    spotlightSteps.forEach(function (_, i) {
      var dot = document.createElement('span');
      dot.className = 'tour-spot-dot';
      dot.setAttribute('data-step', String(i));
      wrap.appendChild(dot);
    });
  }

  // Shows the step's tab behind the overlay, then positions the spotlight on it
  function goToSpotlightStep(idx) {
    currentSpotlightStep = Math.max(0, Math.min(spotlightSteps.length - 1, idx));
    var step = spotlightSteps[currentSpotlightStep];
    if (step.tab && state.activeTab !== step.tab) {
      switchTab(step.tab);
      window.scrollTo(0, 0);
      setTimeout(function () { updateSpotlightPosition(currentSpotlightStep); }, 80);
    } else {
      updateSpotlightPosition(currentSpotlightStep);
    }
  }

  function updateSpotlightPosition(stepIdx, shouldScroll) {
    var overlay = $('dashboard-spotlight-tour');
    var frame = $('tour-spotlight-frame');
    var card = $('tour-callout-card');
    if (!overlay || !frame || !card || overlay.classList.contains('hidden')) return;

    var step = spotlightSteps[stepIdx];
    if (!step) return;

    var target = document.querySelector(step.targetSelector);
    if (!target) return;

    // Smooth scroll target into view if needed
    if (shouldScroll !== false) {
      var rTarget = target.getBoundingClientRect();
      if (rTarget.top < 70 || rTarget.bottom > window.innerHeight - 70) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () { updateSpotlightPosition(stepIdx, false); }, 260);
      }
    }

    var r = target.getBoundingClientRect();
    var pad = 8;
    // Parent overlay is position:fixed; inset:0;
    // Coordinates MUST be viewport-relative (NO scrollY / scrollX added!)
    var fTop = r.top - pad;
    var fLeft = r.left - pad;
    var fWidth = r.width + (pad * 2);
    var fHeight = r.height + (pad * 2);

    frame.style.top = fTop + 'px';
    frame.style.left = fLeft + 'px';
    frame.style.width = fWidth + 'px';
    frame.style.height = fHeight + 'px';

    var badgeEl = $('tour-callout-badge');
    var titleEl = $('tour-callout-title');
    var bodyEl = $('tour-callout-body');
    var hintEl = $('tour-interactive-hint');
    var btnNext = $('btn-tour-spot-next');
    var btnPrev = $('btn-tour-spot-prev');

    if (badgeEl) badgeEl.textContent = (stepIdx + 1) + ' of ' + spotlightSteps.length;
    if (titleEl) titleEl.textContent = step.title;
    if (bodyEl) bodyEl.textContent = step.body;
    if (hintEl) hintEl.textContent = step.hint || '';
    if (btnPrev) btnPrev.disabled = (stepIdx === 0);

    var isDiego = state.account === 'diego';
    if (btnNext) {
      if (stepIdx === spotlightSteps.length - 1) {
        btnNext.textContent = isDiego ? 'Done (resets demo)' : 'Done';
      } else {
        btnNext.textContent = 'Next';
      }
    }

    // Update dots
    var dots = document.querySelectorAll('.tour-spot-dot');
    dots.forEach(function (dot, i) {
      dot.classList.toggle('active', i === stepIdx);
    });

    // Position Callout Card strictly within viewport bounds
    var cardWidth = Math.min(340, window.innerWidth - 32);
    var cardHeight = card.offsetHeight || 220;

    // Default: position below element
    var cTop = fTop + fHeight + 14;
    var cLeft = fLeft + (fWidth / 2) - (cardWidth / 2);

    if (step.placement === 'right' && window.innerWidth > 900) {
      // Beside a sidebar item, vertically aligned with it
      cLeft = fLeft + fWidth + 14;
      cTop = Math.min(fTop, window.innerHeight - cardHeight - 16);
    } else if (cTop + cardHeight > window.innerHeight - 16) {
      // If overflowing bottom of viewport, position above element
      cTop = Math.max(16, fTop - cardHeight - 14);
    }

    // Keep horizontally inside viewport
    if (cLeft < 16) cLeft = 16;
    if (cLeft + cardWidth > window.innerWidth - 16) {
      cLeft = window.innerWidth - cardWidth - 16;
    }

    card.style.top = cTop + 'px';
    card.style.left = cLeft + 'px';
    card.style.width = cardWidth + 'px';
  }

  function startDashboardSpotlightTour(step) {
    var overlay = $('dashboard-spotlight-tour');
    if (!overlay) return;
    renderSpotlightDots();
    overlay.classList.remove('hidden');
    var first = (typeof step === 'number') ? step : 0;
    switchTab(spotlightSteps[first].tab || 'tab-inicio');
    window.scrollTo(0, 0);
    setTimeout(function () { goToSpotlightStep(first); }, 120);
  }

  function closeDashboardSpotlightTour() {
    var overlay = $('dashboard-spotlight-tour');
    if (overlay) overlay.classList.add('hidden');
  }

  function bindSpotlightTourEvents() {
    var btnSkip = $('btn-skip-guided-tour');
    if (btnSkip) btnSkip.addEventListener('click', function () {
      closeDashboardSpotlightTour();
      showToast('Tour closed. Explore the dashboard at your own pace!', 'info');
    });

    var backdrop = $('tour-spotlight-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () {
      closeDashboardSpotlightTour();
    });

    var btnPrev = $('btn-tour-spot-prev');
    if (btnPrev) btnPrev.addEventListener('click', function () {
      if (currentSpotlightStep > 0) goToSpotlightStep(currentSpotlightStep - 1);
    });

    var btnNext = $('btn-tour-spot-next');
    if (btnNext) btnNext.addEventListener('click', function () {
      if (currentSpotlightStep < spotlightSteps.length - 1) {
        goToSpotlightStep(currentSpotlightStep + 1);
      } else {
        // Last step: back to Today
        closeDashboardSpotlightTour();
        switchTab('tab-inicio');
        var isDiego = state.account === 'diego';
        if (isDiego) {
          // Reset Diego to clean slate as requested
          apiFetch('/api/patient/reset', { method: 'POST' })
            .then(function () {
              state.patientProfile = null;
              if (dom.onbNameInput) dom.onbNameInput.value = '';
              if (dom.onbAgeInput) dom.onbAgeInput.value = '';
              if (dom.onbConditionInput) dom.onbConditionInput.value = '';
              var tags = document.querySelectorAll('.onb-tag-chip');
              tags.forEach(function (t) { t.classList.remove('active'); });
              showToast('Tutorial complete! Diego reset to clean slate for your next demo.', 'success');
              checkPatientProfile();
              fetchAnalytics();
              fetchAiInsights(true);
            })
            .catch(function () {
              showToast('Tutorial finished! Welcome to Kaigo.', 'success');
            });
        } else {
          showToast('Tutorial finished! Welcome to Kaigo.', 'success');
        }
      }
    });

    // Dots are generated per step, so listen on their container
    var dotWrap = $('tour-spot-dots');
    if (dotWrap) dotWrap.addEventListener('click', function (e) {
      var dot = e.target.closest('.tour-spot-dot');
      if (!dot) return;
      var s = parseInt(dot.getAttribute('data-step'), 10);
      if (!isNaN(s) && s >= 0 && s < spotlightSteps.length) goToSpotlightStep(s);
    });

    window.addEventListener('scroll', function () {
      if (dom.spotlightOverlay && !dom.spotlightOverlay.classList.contains('hidden')) {
        updateSpotlightPosition(currentSpotlightStep, false);
      }
    }, { passive: true });

    window.addEventListener('resize', function () {
      if (dom.spotlightOverlay && !dom.spotlightOverlay.classList.contains('hidden')) {
        updateSpotlightPosition(currentSpotlightStep, false);
      }
    });
  }

  /* ----------------------------------------------------------
     TABS
     ---------------------------------------------------------- */
  function switchTab(tabId) {
    state.activeTab = tabId;
    dom.navItems.forEach(function (n) {
      var on = n.getAttribute('data-tab') === tabId;
      n.classList.toggle('active', on);
      n.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    dom.tabPanels.forEach(function (p) { p.classList.toggle('active', p.id === tabId); });
    try { history.replaceState(null, '', '#' + (TAB_SLUG[tabId] || 'overview')); } catch (e) {}

    if (tabId === 'tab-inicio') { fetchAnalytics(); fetchAiInsights(); }
    if (tabId === 'tab-historial') fetchHistory();
    if (tabId === 'tab-programar') fetchSchedules();
    if (tabId === 'tab-tendencias') { fetchAnalytics(); renderCharts(); }
  }

  function bindTabs() {
    dom.navItems.forEach(function (n) {
      n.addEventListener('click', function () { switchTab(this.getAttribute('data-tab')); });
    });
    var hash = (location.hash || '').replace('#', '');
    for (var id in TAB_SLUG) { if (TAB_SLUG[id] === hash) switchTab(id); }
    window.addEventListener('hashchange', function () {
      var h = (location.hash || '').replace('#', '');
      for (var k in TAB_SLUG) { if (TAB_SLUG[k] === h && k !== state.activeTab) switchTab(k); }
    });
  }

  /* ----------------------------------------------------------
     SPEECH (TTS)
     ---------------------------------------------------------- */
  function loadSpeechPref() {
    try {
      var v = localStorage.getItem('kaigo.speak');
      if (v !== null) dom.speechCheckbox.checked = v === '1';
    } catch (e) {}
    dom.speechCheckbox.addEventListener('change', function () {
      try { localStorage.setItem('kaigo.speak', this.checked ? '1' : '0'); } catch (e) {}
    });
    $('test-voice-btn').addEventListener('click', function () {
      speakText('This is KAIGO. The speaker is working.', true);
    });
  }

  function speakText(text, force) {
    if (!force && !dom.speechCheckbox.checked) return;
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.85;
    window.speechSynthesis.speak(utter);
  }

  /* ----------------------------------------------------------
     ASK & SCALE POLARITY CONTROLS
     ---------------------------------------------------------- */
  function selectedType() {
    var r = document.querySelector('input[name="question-type"]:checked');
    return r ? r.value : 'boolean';
  }

  function selectedPolarity() {
    var r = document.querySelector('input[name="scale-polarity"]:checked');
    return r ? r.value : 'worse_high';
  }

  function bindScaleGuide() {
    dom.typeRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        dom.rangeScaleGuide.classList.toggle('hidden', this.value !== 'range');
      });
    });

    dom.polarityRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        var isBetterHigh = this.value === 'better_high';
        if (dom.scaleVisualBar) dom.scaleVisualBar.classList.toggle('reversed', isBetterHigh);
        if (dom.scaleGuideDesc) {
          dom.scaleGuideDesc.textContent = isBetterHigh
            ? '1 = Poor / Low, 5 = Fair / Moderate, 10 = Great / Optimal (Higher is better).'
            : '1 = No pain (Comfortable), 5 = Moderate, 10 = Severe / Unbearable (Higher is worse).';
        }
        if (dom.tickMin) dom.tickMin.textContent = isBetterHigh ? '1: Poor' : '1: None';
        if (dom.tickMax) dom.tickMax.textContent = isBetterHigh ? '9-10: Great' : '9-10: Unbearable';
      });
    });

    if (dom.scheduleType && dom.schedPolarityWrap) {
      dom.scheduleType.addEventListener('change', function () {
        dom.schedPolarityWrap.style.display = this.value === 'range' ? 'block' : 'none';
      });
    }
  }

  function sendQuestion(text, type, polarity) {
    text = text || dom.questionInput.value.trim();
    type = type || selectedType();
    if (!polarity && type === 'range') {
      polarity = selectedPolarity();
    }
    if (!text) {
      showToast('Type a question first.', 'warning');
      dom.questionInput.focus();
      return;
    }
    var q = state.currentQuestion;
    if (q && q.active && !confirm('The hub is still waiting on "' + q.text + '". Replace it?')) return;

    dom.sendBtn.disabled = true;
    dom.sendBtn.textContent = 'Sending...';
    apiFetch('/api/question', { method: 'POST', body: { text: text, type: type, scale_polarity: polarity } })
      .then(function (data) {
        showToast('Sent to the hub.', 'success');
        dom.questionInput.value = '';
        updateCharCount();
        clearPresetSelection();
        if (data && data.question) {
          state.spokenIds[data.question.id] = true;
          speakText(data.question.text);
        }
        fetchCurrentQuestion();
        fetchAnalytics();
      })
      .catch(function (err) { showToast('Could not send: ' + err.message, 'error'); })
      .finally(function () {
        dom.sendBtn.disabled = false;
        dom.sendBtn.textContent = 'Send to Hub';
      });
  }

  function cancelCurrentQuestion() {
    apiFetch('/api/question', { method: 'DELETE' })
      .then(function () {
        showToast('Question cancelled.', 'info');
        fetchCurrentQuestion();
      })
      .catch(function (err) { showToast('Could not cancel: ' + err.message, 'error'); });
  }

  function updateCharCount() {
    dom.charCount.textContent = dom.questionInput.value.length;
  }

  function clearPresetSelection() {
    dom.presetBtns.forEach(function (b) { b.classList.remove('selected'); });
  }

  function bindAsk() {
    dom.questionInput.addEventListener('input', updateCharCount);
    dom.questionInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendQuestion();
    });
    dom.sendBtn.addEventListener('click', function () { sendQuestion(); });

    dom.presetBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        clearPresetSelection();
        btn.classList.add('selected');
        dom.questionInput.value = btn.getAttribute('data-text');
        var t = btn.getAttribute('data-type');
        var pol = btn.getAttribute('data-polarity') || 'worse_high';
        var r = document.querySelector('input[name="question-type"][value="' + t + '"]');
        if (r) {
          r.checked = true;
          dom.rangeScaleGuide.classList.toggle('hidden', t !== 'range');
        }
        var polRadio = document.querySelector('input[name="scale-polarity"][value="' + pol + '"]');
        if (polRadio) {
          polRadio.checked = true;
          polRadio.dispatchEvent(new Event('change'));
        }
        updateCharCount();
        dom.questionInput.focus();
      });
    });

    dom.quickCheckBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var txt = this.getAttribute('data-text');
        var typ = this.getAttribute('data-type');
        var pol = isBetterHighQuestion(txt) ? 'better_high' : 'worse_high';
        sendQuestion(txt, typ, pol);
      });
    });

    bindScaleGuide();
  }

  /* ----------------------------------------------------------
     CURRENT QUESTION POLLING
     ---------------------------------------------------------- */
  function fetchCurrentQuestion() {
    return apiFetch('/api/question')
      .then(function (data) {
        state.currentQuestion = data;
        renderCurrentQuestion(data);
      })
      .catch(function () {});
  }

  function renderCurrentQuestion(q) {
    if (!q || !q.active) {
      dom.currentQContent.innerHTML = '<p class="text-muted">No question on the hub right now. The screen is showing the companion face.</p>';
      return;
    }
    var polTag = q.type === 'range' ? (q.scale_polarity === 'better_high' ? ' · 10 is Great' : ' · 10 is Severe') : '';
    var html = ''
      + '<div class="cq-active">'
      + '  <div class="cq-meta"><span class="cq-badge">Waiting on ' + escapeHtml(getLovedOneFirstName()) + '</span><span class="cq-type">' + (q.type === 'range' ? 'Dial 1 to 10' : 'Yes / No') + polTag + '</span></div>'
      + '  <div class="cq-text">' + escapeHtml(q.text) + '</div>'
      + '  <div class="cq-actions"><button class="link-btn link-danger" id="cancel-question-btn">Cancel this question</button></div>'
      + '</div>';
    dom.currentQContent.innerHTML = html;
    var btn = $('cancel-question-btn');
    if (btn) btn.addEventListener('click', cancelCurrentQuestion);
  }

  /* ----------------------------------------------------------
     SCHEDULES
     ---------------------------------------------------------- */
  function fetchSchedules() {
    return apiFetch('/api/schedules')
      .then(function (data) {
        state.schedules = (data && data.schedules) || [];
        renderSchedules();
      })
      .catch(function () {});
  }

  function renderSchedules() {
    var list = state.schedules.slice().sort(function (a, b) {
      return (a.schedule_time || '').localeCompare(b.schedule_time || '');
    });
    if (!list.length) {
      dom.scheduleList.innerHTML = '<p class="empty">No check-ins yet. Add one to have the hub ask automatically.</p>';
      return;
    }
    var html = list.map(function (s) {
      var n = nextRun(s);
      var nextStr = !s.enabled ? 'Paused' : (n ? ('Next ' + relTime(n)) : 'No upcoming runs');
      var typeDesc = s.type === 'range' ? (s.scale_polarity === 'better_high' ? 'Scale (10=Great)' : 'Scale (10=Severe)') : 'Yes / No';
      return ''
        + '<div class="schedule-item' + (s.enabled ? '' : ' paused') + '" data-id="' + s.id + '">'
        + '  <div class="schedule-time">' + fmt12(s.schedule_time) + '</div>'
        + '  <div class="schedule-info">'
        + '    <div class="schedule-q">' + escapeHtml(s.text) + '</div>'
        + '    <div class="schedule-meta">' + dayNames(s.days) + ' &bull; ' + typeDesc + ' &bull; ' + nextStr + '</div>'
        + '  </div>'
        + '  <div class="schedule-controls">'
        + '    <button class="icon-btn btn-toggle-sched" title="' + (s.enabled ? 'Pause' : 'Enable') + '">' + (s.enabled ? 'Pause' : 'Enable') + '</button>'
        + '    <button class="icon-btn icon-danger btn-del-sched" title="Delete">Delete</button>'
        + '  </div>'
        + '</div>';
    }).join('');
    dom.scheduleList.innerHTML = html;
  }

  function bindSchedule() {
    dom.addScheduleBtn.addEventListener('click', function () {
      var text = dom.scheduleQuestion.value.trim();
      var type = dom.scheduleType.value;
      var time = dom.scheduleTime.value;
      var pol = dom.schedulePolarity ? dom.schedulePolarity.value : (isBetterHighQuestion(text) ? 'better_high' : 'worse_high');
      var selDays = [];
      dom.dayCbs.forEach(function (cb) { if (cb.checked) selDays.push(cb.value); });
      var daysStr = selDays.length === 7 ? 'all' : (selDays.length ? selDays.join(',') : 'all');

      if (!text) { showToast('Type a question first.', 'warning'); return; }
      if (!time) { showToast('Pick a time.', 'warning'); return; }

      dom.addScheduleBtn.disabled = true;
      apiFetch('/api/schedules', { method: 'POST', body: { text: text, type: type, schedule_time: time, days: daysStr, scale_polarity: pol } })
        .then(function () {
          showToast('Check-in scheduled for ' + getLovedOneFirstName() + '.', 'success');
          dom.scheduleQuestion.value = '';
          fetchSchedules();
        })
        .catch(function (err) { showToast('Could not schedule: ' + err.message, 'error'); })
        .finally(function () { dom.addScheduleBtn.disabled = false; });
    });

    document.querySelectorAll('.day-shortcuts button').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = this.getAttribute('data-days');
        dom.dayCbs.forEach(function (cb) {
          if (mode === 'all') cb.checked = true;
          else if (mode === 'none') cb.checked = false;
          else if (mode === 'weekdays') cb.checked = ['mon', 'tue', 'wed', 'thu', 'fri'].indexOf(cb.value) !== -1;
        });
      });
    });

    dom.scheduleList.addEventListener('click', function (e) {
      var item = e.target.closest('.schedule-item');
      if (!item) return;
      var id = item.getAttribute('data-id');
      if (e.target.classList.contains('btn-del-sched')) {
        if (!confirm('Delete this scheduled check-in?')) return;
        apiFetch('/api/schedules/' + id, { method: 'DELETE' })
          .then(function () { showToast('Deleted.', 'info'); fetchSchedules(); })
          .catch(function (err) { showToast('Could not delete: ' + err.message, 'error'); });
      } else if (e.target.classList.contains('btn-toggle-sched')) {
        var isPaused = item.classList.contains('paused');
        apiFetch('/api/schedules/' + id, { method: 'PATCH', body: { enabled: isPaused } })
          .then(fetchSchedules)
          .catch(function (err) { showToast('Could not update: ' + err.message, 'error'); });
      }
    });
  }

  /* ----------------------------------------------------------
     HISTORY & DELETE
     ---------------------------------------------------------- */
  function fetchHistory() {
    return apiFetch('/api/history')
      .then(function (data) {
        var ans = (data && data.answers) || [];
        var sos = (data && data.sos_events) || [];
        var combined = ans.concat(sos.map(function (s) {
          return { id: s.id, sos_id: s.id, question_text: 'Emergency SOS Alert', question_type: 'sos', answer: 'EMERGENCY', answered_at: s.triggered_at, sos: true };
        }));
        combined.sort(function (a, b) { return (b.answered_at || '').localeCompare(a.answered_at || ''); });
        state.history = combined;
        state.historyLoaded = true;
        renderHistory();
        renderHomeRecentFeed();
      })
      .catch(function () {});
  }

  function renderHistory() {
    var term = state.historySearch.toLowerCase();
    var filtered = state.history.filter(function (r) {
      if (state.historyFilter === 'boolean' && r.question_type !== 'boolean') return false;
      if (state.historyFilter === 'range' && r.question_type !== 'range') return false;
      if (state.historyFilter === 'sos' && !isSos(r)) return false;
      if (term && (r.question_text || '').toLowerCase().indexOf(term) === -1) return false;
      return true;
    });

    if (!filtered.length) {
      dom.historyTbody.innerHTML = '<tr class="empty-row"><td colspan="4">No history matching filters.</td></tr>';
      return;
    }

    var html = filtered.map(function (r) {
      var d = parseDate(r.answered_at);
      var whenStr = d ? (dayHeading(d) + ', ' + timeOf(d)) : escapeHtml(r.answered_at);
      var isEmergency = isSos(r);
      var answerHtml = isEmergency
        ? '<span class="badge-clinical badge-pain-critical">EMERGENCY SOS</span>'
        : formatAnswerInterpretation(r.question_text, r.question_type, r.answer, r.scale_polarity);

      var delBtn = isEmergency
        ? '<button class="link-btn link-danger btn-delete-sos" data-id="' + r.id + '" title="Delete this SOS alert">Delete</button>'
        : '<button class="link-btn link-danger btn-delete-answer" data-id="' + r.id + '" title="Delete this past question">Delete</button>';

      return ''
        + '<tr class="' + (isEmergency ? 'row-sos' : '') + '">'
        + '  <td class="td-when">' + whenStr + '</td>'
        + '  <td class="td-question">' + escapeHtml(r.question_text) + '</td>'
        + '  <td class="td-answer">' + answerHtml + '</td>'
        + '  <td class="col-action">' + delBtn + '</td>'
        + '</tr>';
    }).join('');
    dom.historyTbody.innerHTML = html;
  }

  function renderHomeRecentFeed() {
    if (!dom.homeRecentFeed) return;
    var list = state.history.slice(0, 5);
    if (!list.length) {
      dom.homeRecentFeed.innerHTML = '<p class="empty">No answers yet. Try a quick check-in.</p>';
      return;
    }
    var html = list.map(function (r) {
      var d = parseDate(r.answered_at);
      var whenStr = d ? relTime(d) : '';
      var isEmergency = isSos(r);
      var answerBadge = isEmergency
        ? '<span class="badge-clinical badge-pain-critical">SOS Alert</span>'
        : formatAnswerInterpretation(r.question_text, r.question_type, r.answer, r.scale_polarity);

      return ''
        + '<div class="feed-row">'
        + '  <div>'
        + '    <div class="feed-q">' + escapeHtml(r.question_text) + '</div>'
        + '    <div class="feed-when">' + whenStr + '</div>'
        + '  </div>'
        + '  <div>' + answerBadge + '</div>'
        + '</div>';
    }).join('');
    dom.homeRecentFeed.innerHTML = html;
  }

  function bindHistory() {
    dom.historySearch.addEventListener('input', function () {
      state.historySearch = this.value;
      renderHistory();
    });

    dom.filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        dom.filterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.historyFilter = btn.getAttribute('data-filter');
        renderHistory();
      });
    });

    dom.btnClearHistory.addEventListener('click', function () {
      if (!confirm('Clear all past check-in answers and SOS alerts from history?')) return;
      apiFetch('/api/history/clear', { method: 'POST' })
        .then(function () {
          showToast('History cleared.', 'info');
          fetchHistory();
          fetchAnalytics();
        })
        .catch(function (err) { showToast('Could not clear history: ' + err.message, 'error'); });
    });

    dom.historyTbody.addEventListener('click', function (e) {
      var delAns = e.target.closest('.btn-delete-answer');
      if (delAns) {
        var id = delAns.getAttribute('data-id');
        apiFetch('/api/history/answer/' + id, { method: 'DELETE' })
          .then(function () {
            showToast('Answer deleted from history.', 'info');
            fetchHistory();
            fetchAnalytics();
          })
          .catch(function (err) { showToast('Could not delete: ' + err.message, 'error'); });
        return;
      }

      var delSos = e.target.closest('.btn-delete-sos');
      if (delSos) {
        var sosId = delSos.getAttribute('data-id');
        apiFetch('/api/history/sos/' + sosId, { method: 'DELETE' })
          .then(function () {
            showToast('SOS alert deleted from history.', 'info');
            fetchHistory();
            fetchAnalytics();
          })
          .catch(function (err) { showToast('Could not delete SOS: ' + err.message, 'error'); });
      }
    });
  }

  /* ----------------------------------------------------------
     ANALYTICS & AI COPILOT
     ---------------------------------------------------------- */
  function fetchAnalytics(scope) {
    scope = scope || state.currentScope || '1m';
    state.currentScope = scope;
    return apiFetch('/api/analytics?scope=' + encodeURIComponent(scope))
      .then(function (res) {
        if (!res || !res.analytics) return;
        state.analytics = res.analytics;
        renderAnalyticsUI(res.analytics);
        renderCharts();
      })
      .catch(function () {});
  }

  function renderAnalyticsUI(a) {
    if (a.has_patient === false) {
      if (dom.patientBannerName) dom.patientBannerName.textContent = 'No loved one registered yet';
      if (dom.patientBannerDesc) dom.patientBannerDesc.textContent = 'Use Edit to add their profile.';
      if (dom.homeValWellness) {
        dom.homeValWellness.innerHTML = '--<span style="font-size:20px;font-weight:400;color:var(--ink-muted);">/100</span>';
        dom.homeChipWellness.textContent = 'Awaiting Profile';
        dom.homeChipWellness.className = 'wellness-hero-chip chip-warning';
      }
      if (dom.homeValMeds) {
        dom.homeValMeds.textContent = '--';
        dom.homeChipMeds.textContent = 'Awaiting Check-ins';
        dom.homeChipMeds.className = 'wellness-hero-chip chip-good';
      }
      if (dom.homeValPain) {
        dom.homeValPain.textContent = '--';
        dom.homeChipPain.textContent = 'No Data';
        dom.homeChipPain.className = 'wellness-hero-chip chip-good';
      }
      if (dom.homeValSos) {
        dom.homeValSos.textContent = '0';
        dom.homeChipSos.textContent = 'All Safe';
        dom.homeChipSos.className = 'wellness-hero-chip chip-optimal';
      }
      return;
    }

    if (a.patient && dom.patientBannerName) {
      dom.patientBannerName.textContent = 'Caring for ' + a.patient.name;
      var pSummary = [a.patient.relation || 'Loved One'];
      if (a.patient.age) pSummary.push(a.patient.age + ' yrs old');
      if (a.patient.condition) pSummary.push(a.patient.condition);
      dom.patientBannerDesc.textContent = pSummary.join(' • ');
      updateDynamicPatientLabels();
    }

    // Overview KPI Cards
    if (dom.homeValWellness) {
      if (a.wellness_index !== null && a.wellness_index !== undefined) {
        dom.homeValWellness.innerHTML = a.wellness_index + '<span style="font-size:20px;font-weight:400;color:var(--ink-muted);">/100</span>';
        dom.homeChipWellness.textContent = a.wellness_badge || 'Active';
        dom.homeChipWellness.className = 'wellness-hero-chip ' + (
          a.wellness_index >= 85 ? 'chip-optimal' :
          a.wellness_index >= 70 ? 'chip-good' :
          a.wellness_index >= 50 ? 'chip-warning' : 'chip-critical'
        );
      } else {
        dom.homeValWellness.innerHTML = '--<span style="font-size:20px;font-weight:400;color:var(--ink-muted);">/100</span>';
        dom.homeChipWellness.textContent = a.wellness_badge || 'Awaiting Check-ins';
        dom.homeChipWellness.className = 'wellness-hero-chip chip-good';
      }
    }

    // What the score is made of, so it can be checked against the answers
    if (dom.homeBasisWellness) {
      var wl = a.wellness;
      if (wl && wl.components && wl.components.length) {
        var bits = wl.components.map(function (c) { return c.label + ' ' + c.detail; });
        (wl.penalties || []).forEach(function (p) { bits.push('\u2212' + p.points + ' ' + p.label); });
        dom.homeBasisWellness.textContent = bits.join(' \u00b7 ') + '. ' + wl.basis + '.';
        dom.homeBasisWellness.title = wl.explanation || '';
      } else {
        dom.homeBasisWellness.textContent = '';
        dom.homeBasisWellness.title = '';
      }
    }

    if (dom.homeValMeds) {
      if (a.medication && a.medication.compliance_pct !== null && a.medication.compliance_pct !== undefined) {
        dom.homeValMeds.textContent = a.medication.compliance_pct + '%';
        dom.homeChipMeds.textContent = a.medication.missed_count > 0 ? (a.medication.missed_count + ' Missed (' + a.scope_days + 'd)') : '100% Taken';
        dom.homeChipMeds.className = 'wellness-hero-chip ' + (a.medication.compliance_pct >= 85 ? 'chip-optimal' : 'chip-critical');
      } else {
        dom.homeValMeds.textContent = '--';
        dom.homeChipMeds.textContent = 'Pending Check-ins';
        dom.homeChipMeds.className = 'wellness-hero-chip chip-good';
      }
    }

    if (dom.homeValPain) {
      if (a.pain && a.pain.latest) {
        dom.homeValPain.textContent = a.pain.latest.score + '/10';
        dom.homeChipPain.textContent = a.pain.latest.level + ' Pain';
        dom.homeChipPain.className = 'wellness-hero-chip ' + (
          a.pain.latest.score <= 1 ? 'chip-optimal' :
          a.pain.latest.score <= 3 ? 'chip-good' :
          a.pain.latest.score <= 6 ? 'chip-warning' : 'chip-critical'
        );
      } else {
        dom.homeValPain.textContent = '--';
        dom.homeChipPain.textContent = 'No Pain Reported';
        dom.homeChipPain.className = 'wellness-hero-chip chip-optimal';
      }
    }

    if (dom.homeValSos) {
      var inScopeSos = a.sos ? (a.sos.in_scope !== undefined ? a.sos.in_scope : a.sos.last_7d) : 0;
      var activeSos = a.sos ? (a.sos.active_unacknowledged || 0) : 0;
      dom.homeValSos.textContent = inScopeSos;
      dom.homeChipSos.textContent = activeSos > 0 ? (activeSos + ' Active Alert!') : (inScopeSos > 0 ? inScopeSos + ' in ' + a.scope_days + 'd' : 'All Safe');
      dom.homeChipSos.className = 'wellness-hero-chip ' + (activeSos > 0 ? 'chip-critical' : 'chip-optimal');
    }

    // Insights KPI Cards
    if (dom.statWellnessScore) dom.statWellnessScore.textContent = (a.wellness_index !== null && a.wellness_index !== undefined) ? a.wellness_index : '--';
    if (dom.statMedCompliance) dom.statMedCompliance.textContent = (a.medication && a.medication.compliance_pct !== null && a.medication.compliance_pct !== undefined) ? (a.medication.compliance_pct + '%') : '--';
    if (dom.statAvgPain) dom.statAvgPain.textContent = (a.pain && a.pain.average_7d !== null && a.pain.average_7d !== undefined) ? (a.pain.average_7d + '/10') : 'None';
    if (dom.statAvgMood) dom.statAvgMood.textContent = (a.mood && a.mood.average_7d !== null && a.mood.average_7d !== undefined) ? (a.mood.average_7d + '/10') : '--';

    var medsTitle = $('chart-meds-title');
    if (medsTitle) {
      var scopeTxt = a.scope_days >= 365 ? '1-Year' : (a.scope_days >= 180 ? '6-Month' : (a.scope_days <= 7 ? '7-Day' : '30-Day'));
      medsTitle.textContent = 'Medication Adherence (' + scopeTxt + ')';
    }

    // Update Kaigo-kun's Face Expression to reflect dependee health!
    updateKaigoDependeeFace(a);
  }

  /* ----------------------------------------------------------
     KAIGO-KUN DEPENDEE HEALTH REFLECTION ENGINE
     ---------------------------------------------------------- */
  function updateKaigoDependeeFace(analytics) {
    var compFrame = document.querySelector('.companion-device-frame');
    var compFace = $('companion-face');
    var tftPill = $('tft-status-pill');
    var statusBadge = $('dependee-status-badge');
    var statusIcon = $('dependee-status-icon');
    var statusText = $('dependee-status-text');
    var statusSub = $('dependee-status-sub');
    if (!compFace) return;

    var a = analytics || (state && state.analytics);
    var patientName = (state.patientProfile && state.patientProfile.name)
      ? state.patientProfile.name.split(' ')[0]
      : (a && a.patient && a.patient.name ? a.patient.name.split(' ')[0] : 'Loved One');

    if (!a || a.has_patient === false) {
      if (compFrame) compFrame.className = 'companion-device-frame status-empty';
      compFace.className = 'tft-face-canvas face-online face-sparkle';
      if (tftPill) { tftPill.className = 'tft-status-pill online'; tftPill.textContent = 'WAITING'; }
      if (statusBadge) statusBadge.className = 'dependee-status-badge status-empty';
      if (statusIcon) statusIcon.textContent = '';
      if (statusText) statusText.textContent = 'No Loved One Configured';
      if (statusSub) statusSub.textContent = 'Click Platform Tour or Manage Loved One to begin';
      return;
    }

    // Fresh profile with 0 check-in answers recorded yet
    if (a.wellness_index === null || a.total_answers === 0) {
      if (compFrame) compFrame.className = 'companion-device-frame status-thriving';
      compFace.className = 'tft-face-canvas face-online face-sparkle';
      if (tftPill) { tftPill.className = 'tft-status-pill online'; tftPill.textContent = 'ONLINE • READY'; }
      if (statusBadge) statusBadge.className = 'dependee-status-badge status-thriving';
      if (statusIcon) statusIcon.textContent = '';
      if (statusText) statusText.textContent = patientName + ': Ready for First Check-in';
      if (statusSub) statusSub.textContent = 'Bedside hub connected • Send a question from Ask tab to begin tracking';
      return;
    }

    // Only real readings: null means "no answer of that kind yet"
    var wellness = typeof a.wellness_index === 'number' ? a.wellness_index : null;
    var hasPain = !!(a.pain && a.pain.latest);
    var painScore = hasPain ? a.pain.latest.score : null;
    var medPct = (a.medication && typeof a.medication.compliance_pct === 'number') ? a.medication.compliance_pct : null;
    var lowest = (a.wellness && a.wellness.lowest) ? a.wellness.lowest : null;
    var facts = [];
    if (medPct !== null) facts.push('Meds ' + medPct + '%');
    if (hasPain) facts.push('Pain ' + painScore + '/10');
    if (a.mood && a.mood.latest) facts.push('Mood ' + a.mood.latest.score + '/10');
    var factsLine = facts.join(' \u2022 ') || 'Waiting for more answers';
    var activeSos = (a.sos && a.sos.active_unacknowledged > 0);

    // 1. SOS Emergency Active
    if (activeSos) {
      if (compFrame) compFrame.className = 'companion-device-frame status-sos-alert';
      compFace.className = 'tft-face-canvas face-online face-sos-alert';
      if (tftPill) { tftPill.className = 'tft-status-pill alert'; tftPill.textContent = 'SOS ALERT'; }
      if (statusBadge) statusBadge.className = 'dependee-status-badge status-sos-alert';
      if (statusIcon) statusIcon.textContent = '';
      if (statusText) statusText.textContent = patientName + ': EMERGENCY SOS!';
      if (statusSub) statusSub.textContent = 'Physical emergency button pressed on bedside hub!';
      return;
    }

    // 2. Needs attention: high pain (>= 6) or a wellness score below 70
    var highPain = hasPain && painScore >= 6;
    if (highPain || (wellness !== null && wellness < 70)) {
      if (compFrame) compFrame.className = 'companion-device-frame status-high-pain';
      compFace.className = 'tft-face-canvas face-online face-high-pain';
      if (tftPill) { tftPill.className = 'tft-status-pill alert'; tftPill.textContent = highPain ? 'HIGH PAIN' : 'NEEDS CARE'; }
      if (statusBadge) statusBadge.className = 'dependee-status-badge status-high-pain';
      if (statusIcon) statusIcon.textContent = '';
      if (highPain) {
        if (statusText) statusText.textContent = patientName + ': High Pain (' + painScore + '/10)';
        if (statusSub) statusSub.textContent = 'Elevated discomfort detected \u2014 caregiver check-in advised';
      } else {
        if (statusText) statusText.textContent = patientName + ': Needs Attention (' + wellness + '/100)';
        if (statusSub) statusSub.textContent = (lowest ? ('Lowest: ' + lowest.label + ' ' + lowest.detail) : 'Low answers recently') + ' \u2014 check-in advised';
      }
      return;
    }

    // 3. Mild concern: pain 3-5, medication below 85%, or wellness 70-84
    var mildPain = hasPain && painScore >= 3;
    if (mildPain || (medPct !== null && medPct < 85) || (wellness !== null && wellness < 85)) {
      if (compFrame) compFrame.className = 'companion-device-frame status-mild-concern';
      compFace.className = 'tft-face-canvas face-online face-mild-concern';
      if (tftPill) { tftPill.className = 'tft-status-pill attention'; tftPill.textContent = 'ATTENTION'; }
      if (statusBadge) statusBadge.className = 'dependee-status-badge status-mild-concern';
      if (statusIcon) statusIcon.textContent = '';
      if (statusText) statusText.textContent = patientName + ': Mild Concern (' + (mildPain ? ('Pain ' + painScore + '/10') : ('Wellness ' + wellness + '/100')) + ')';
      if (statusSub) statusSub.textContent = factsLine;
      return;
    }

    // 4. Thriving & Happy (Wellness >= 85, Pain <= 2, Meds >= 85%)
    if (compFrame) compFrame.className = 'companion-device-frame status-thriving';
    compFace.className = 'tft-face-canvas face-online face-thriving';
    if (tftPill) { tftPill.className = 'tft-status-pill online'; tftPill.textContent = 'ONLINE • STABLE'; }
    if (statusBadge) statusBadge.className = 'dependee-status-badge status-thriving';
    if (statusIcon) statusIcon.textContent = '';
    if (statusText) statusText.textContent = patientName + ': Thriving & Stable' + (wellness !== null ? ' (' + wellness + '/100)' : '');
    if (statusSub) statusSub.textContent = factsLine;
  }

  function fetchAiInsights(force, scope) {
    scope = scope || state.currentScope || '1m';
    if (dom.aiSummaryText && force) {
      dom.aiSummaryText.textContent = 'Reading recent answers…';
    }
    return apiFetch('/api/ai/insights?scope=' + encodeURIComponent(scope), {
      method: 'POST',
      body: { force: !!force, scope: scope }
    })
      .then(function (res) {
        if (!res) return;
        state.aiInsights = res;
        renderAiInsights(res);
      })
      .catch(function () {});
  }

  var moodPreviewStep = 0;
  function bindCompanionInteraction() {
    var compBox = $('companion-hub-box');
    var compFrame = document.querySelector('.companion-device-frame');
    var compFace = $('companion-face');
    var tftPill = $('tft-status-pill');
    var statusBadge = $('dependee-status-badge');
    var statusIcon = $('dependee-status-icon');
    var statusText = $('dependee-status-text');
    var statusSub = $('dependee-status-sub');
    if (!compBox || !compFace) return;

    compBox.addEventListener('click', function () {
      moodPreviewStep = (moodPreviewStep + 1) % 5;
      var patientName = (state.patientProfile && state.patientProfile.name)
        ? state.patientProfile.name.split(' ')[0]
        : (state.analytics && state.analytics.patient ? state.analytics.patient.name.split(' ')[0] : 'Loved One');

      if (moodPreviewStep === 0) {
        // Return to live status
        updateKaigoDependeeFace();
        showToast('Kaigo-kun: Showing live real-time status', 'info');
      } else if (moodPreviewStep === 1) {
        // Preview: Thriving
        if (compFrame) compFrame.className = 'companion-device-frame status-thriving';
        compFace.className = 'tft-face-canvas face-online face-thriving';
        if (tftPill) { tftPill.className = 'tft-status-pill online'; tftPill.textContent = 'STABLE (98)'; }
        if (statusBadge) statusBadge.className = 'dependee-status-badge status-thriving';
        if (statusIcon) statusIcon.textContent = '';
        if (statusText) statusText.textContent = patientName + ': Thriving & Healthy (98/100)';
        if (statusSub) statusSub.textContent = 'Preview: Radiant sparkle eyes & big smile show high vitality';
        showToast('Mood: Thriving (98/100) — Kaigo is radiant & happy!', 'success');
      } else if (moodPreviewStep === 2) {
        // Preview: Mild Discomfort
        if (compFrame) compFrame.className = 'companion-device-frame status-mild-concern';
        compFace.className = 'tft-face-canvas face-online face-mild-concern';
        if (tftPill) { tftPill.className = 'tft-status-pill attention'; tftPill.textContent = 'ATTENTION'; }
        if (statusBadge) statusBadge.className = 'dependee-status-badge status-mild-concern';
        if (statusIcon) statusIcon.textContent = '';
        if (statusText) statusText.textContent = patientName + ': Mild Concern (Pain 4/10)';
        if (statusSub) statusSub.textContent = 'Preview: Angled eyebrows & amber glow indicate discomfort';
        showToast('Mood: Mild Concern (Pain 4/10) — Kaigo looks attentive & concerned', 'warning');
      } else if (moodPreviewStep === 3) {
        // Preview: High Pain
        if (compFrame) compFrame.className = 'companion-device-frame status-high-pain';
        compFace.className = 'tft-face-canvas face-online face-high-pain';
        if (tftPill) { tftPill.className = 'tft-status-pill alert'; tftPill.textContent = 'HIGH PAIN'; }
        if (statusBadge) statusBadge.className = 'dependee-status-badge status-high-pain';
        if (statusIcon) statusIcon.textContent = '';
        if (statusText) statusText.textContent = patientName + ': High Pain (8/10)';
        if (statusSub) statusSub.textContent = 'Preview: Furrowed brow & frowning mouth signal acute pain';
        showToast('Mood: High Pain (8/10) — Kaigo is furrowed and distressed', 'error');
      } else if (moodPreviewStep === 4) {
        // Preview: SOS Emergency
        if (compFrame) compFrame.className = 'companion-device-frame status-sos-alert';
        compFace.className = 'tft-face-canvas face-online face-sos-alert';
        if (tftPill) { tftPill.className = 'tft-status-pill alert'; tftPill.textContent = 'SOS ALERT'; }
        if (statusBadge) statusBadge.className = 'dependee-status-badge status-sos-alert';
        if (statusIcon) statusIcon.textContent = '';
        if (statusText) statusText.textContent = patientName + ': EMERGENCY SOS!';
        if (statusSub) statusSub.textContent = 'Preview: Flashing red emergency aura & wide alert eyes';
        showToast('Mood: SOS Emergency — Kaigo is on urgent alert!', 'error');
      }
    });
  }

  function renderAiInsights(res) {
    if (!dom.aiSummaryText) return;

    var isGemini = res.source === 'gemini';
    var modelName = 'Gemini 3.1 Flash-Lite';
    if (res.model) {
      modelName = res.model.replace('gemini-', 'Gemini ').replace('-preview', '');
    }
    if (dom.aiModelSource) {
      dom.aiModelSource.textContent = isGemini ? modelName : 'Built-in rules';
      dom.aiModelSource.style.color = isGemini ? 'var(--blue-deep)' : 'var(--ink-muted)';
    }

    // Refresh Kaigo-kun Dependee Health Reflection
    updateKaigoDependeeFace();

    var scopeBadge = $('companion-scope-badge');
    var scopeTitles = {
      '1w': 'Last week',
      '1m': 'Last month',
      '6m': 'Last 6 months',
      '1y': 'Last year'
    };
    if (scopeBadge) {
      scopeBadge.textContent = scopeTitles[state.currentScope || '1m'] || 'Longitudinal Clinical Trajectory';
    }

    if (isGemini && res.insights) {
      dom.aiSummaryText.textContent = res.insights.summary || '';
      var risks = res.insights.risk_flags || [];
      dom.aiRiskList.innerHTML = risks.length
        ? risks.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('')
        : '<li>No acute clinical risks identified for ' + escapeHtml(getLovedOneFirstName()) + '. Status remains stable.</li>';

      var acts = res.insights.recommendations || [];
      dom.aiActionList.innerHTML = acts.length
        ? acts.map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('')
        : '<li>Continue routine morning medication and evening check-ins.</li>';
    } else {
      dom.aiSummaryText.textContent = res.summary || (getLovedOneFirstName() + ' vitals evaluated.');
      var rFlags = (state.analytics && state.analytics.risk_flags) || [];
      dom.aiRiskList.innerHTML = rFlags.length
        ? rFlags.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('')
        : '<li>No acute risks detected from recent check-ins.</li>';

      var recs = res.recommendations || [];
      dom.aiActionList.innerHTML = recs.length
        ? recs.map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('')
        : '<li>Maintain current check-in routine.</li>';
    }
  }

  /* ----------------------------------------------------------
     CHARTS (PAIN & REVERSED MOOD/ENERGY TRAJECTORIES)
     ---------------------------------------------------------- */
  function chartDefaults() {
    if (!window.Chart) return false;
    Chart.defaults.font.family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = C.ink;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.plugins.tooltip.backgroundColor = C.ink;
    Chart.defaults.plugins.tooltip.cornerRadius = 0;
    return true;
  }

  function axes(extraY) {
    var y = { grid: { color: C.line, drawTicks: false }, border: { display: false }, ticks: { padding: 8 } };
    for (var k in extraY) y[k] = extraY[k];
    return {
      x: { grid: { display: false }, border: { color: C.axis }, ticks: { padding: 6 } },
      y: y
    };
  }

  function lastDaysKeys(n) {
    var keys = [], labels = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      keys.push(localKey(d));
      labels.push(i === 0 ? 'Today' : (d.getMonth() + 1) + '/' + d.getDate());
    }
    return { keys: keys, labels: labels };
  }

  function renderCharts() {
    if (!chartDefaults()) return;
    renderPainChart();
    renderMoodChart();
    renderMedsChart();
    renderDailyChart();
  }

  function renderPainChart() {
    var canvas = $('chart-pain-trend');
    if (!canvas) return;

    var labels = [];
    var avgData = [];

    if (state.analytics && state.analytics.charts && state.analytics.charts.pain && state.analytics.charts.pain.labels && state.analytics.charts.pain.labels.length) {
      labels = state.analytics.charts.pain.labels;
      avgData = state.analytics.charts.pain.values;
    } else {
      var w = lastDaysKeys(14);
      labels = w.labels;
      var painVals = w.keys.map(function () { return []; });
      state.history.forEach(function (r) {
        if (r.question_type !== 'range') return;
        var pol = r.scale_polarity || (isBetterHighQuestion(r.question_text) ? 'better_high' : 'worse_high');
        if (pol !== 'worse_high') return;
        var d = parseDate(r.answered_at); if (!d) return;
        var idx = w.keys.indexOf(localKey(d)); if (idx === -1) return;
        var s = String(r.answer).trim();
        var v = parseFloat(s.indexOf('/') !== -1 ? s.split('/')[0] : s);
        if (!isNaN(v)) painVals[idx].push(v);
      });
      avgData = painVals.map(function (arr) {
        return arr.length ? +(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length).toFixed(1) : null;
      });
    }

    var hasPainData = avgData && avgData.some(function (v) { return v !== null; });
    var emptyEl = $('pain-empty');
    if (emptyEl) emptyEl.classList.toggle('hidden', hasPainData);

    if (state.charts.pain) state.charts.pain.destroy();
    state.charts.pain = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Back Pain Severity (10 = Severe, 1 = None)',
          data: avgData,
          borderColor: C.red,
          backgroundColor: 'rgba(248, 101, 27, 0.06)',
          fill: true,
          borderWidth: 3,
          tension: 0.35,
          spanGaps: true,
          pointRadius: labels.length > 40 ? 2 : 4,
          pointBackgroundColor: avgData.map(function (val) {
            if (val === null) return C.red;
            return val <= 3 ? C.green : (val <= 6 ? C.amber : C.red);
          }),
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: axes({
          min: 0, max: 10,
          ticks: {
            stepSize: 2, padding: 8,
            callback: function (val) {
              if (val === 0) return '0 (None)';
              if (val === 4) return '4 (Moderate)';
              if (val === 8) return '8 (Severe)';
              return val;
            }
          }
        }),
        plugins: {
          legend: { position: 'bottom', align: 'start' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed.y;
                var desc = v <= 1 ? 'No pain' : (v <= 3 ? 'Mild pain' : (v <= 6 ? 'Moderate pain' : 'Severe pain'));
                return ' Pain Level: ' + v + ' / 10 (' + desc + ')';
              }
            }
          }
        }
      }
    });
  }

  function renderMoodChart() {
    var canvas = $('chart-mood-trend');
    if (!canvas) return;

    var labels = [];
    var avgData = [];

    if (state.analytics && state.analytics.charts && state.analytics.charts.mood && state.analytics.charts.mood.labels && state.analytics.charts.mood.labels.length) {
      labels = state.analytics.charts.mood.labels;
      avgData = state.analytics.charts.mood.values;
    } else {
      var w = lastDaysKeys(14);
      labels = w.labels;
      var moodVals = w.keys.map(function () { return []; });
      state.history.forEach(function (r) {
        if (r.question_type !== 'range') return;
        var pol = r.scale_polarity || (isBetterHighQuestion(r.question_text) ? 'better_high' : 'worse_high');
        if (pol !== 'better_high') return;
        var d = parseDate(r.answered_at); if (!d) return;
        var idx = w.keys.indexOf(localKey(d)); if (idx === -1) return;
        var s = String(r.answer).trim();
        var v = parseFloat(s.indexOf('/') !== -1 ? s.split('/')[0] : s);
        if (!isNaN(v)) moodVals[idx].push(v);
      });
      avgData = moodVals.map(function (arr) {
        return arr.length ? +(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length).toFixed(1) : null;
      });
    }

    var hasData = avgData && avgData.some(function (v) { return v !== null; });
    var emptyEl = $('mood-empty');
    if (emptyEl) emptyEl.classList.toggle('hidden', hasData);

    if (state.charts.mood) state.charts.mood.destroy();
    state.charts.mood = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Mood & Energy (10 = Great / Restful, 1 = Low)',
          data: avgData,
          borderColor: C.green,
          backgroundColor: 'rgba(74, 127, 247, 0.06)',
          fill: true,
          borderWidth: 3,
          tension: 0.35,
          spanGaps: true,
          pointRadius: labels.length > 40 ? 2 : 4,
          pointBackgroundColor: avgData.map(function (val) {
            if (val === null) return C.green;
            return val >= 8 ? C.green : (val >= 6 ? C.sky : (val >= 4 ? C.amber : C.red));
          }),
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: axes({
          min: 0, max: 10,
          ticks: {
            stepSize: 2, padding: 8,
            callback: function (val) {
              if (val === 0) return '0 (Low)';
              if (val === 4) return '4 (Fair)';
              if (val === 8) return '8 (Good)';
              if (val === 10) return '10 (Great)';
              return val;
            }
          }
        }),
        plugins: {
          legend: { position: 'bottom', align: 'start' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = ctx.parsed.y;
                var desc = v >= 8 ? 'Great / High energy' : (v >= 6 ? 'Good' : (v >= 4 ? 'Fair' : 'Low / Depressed'));
                return ' Mood Score: ' + v + ' / 10 (' + desc + ')';
              }
            }
          }
        }
      }
    });
  }

  function renderMedsChart() {
    var canvas = $('chart-meds');
    if (!canvas) return;

    var taken = (state.analytics && state.analytics.charts && state.analytics.charts.adherence && state.analytics.charts.adherence.taken) ||
                (state.analytics && state.analytics.medication && state.analytics.medication.taken_count) || 0;
    var missed = (state.analytics && state.analytics.charts && state.analytics.charts.adherence && state.analytics.charts.adherence.missed) ||
                 (state.analytics && state.analytics.medication && state.analytics.medication.missed_count) || 0;

    var emptyEl = $('meds-empty');
    if (emptyEl) emptyEl.classList.toggle('hidden', (taken + missed) > 0);

    if (state.charts.meds) state.charts.meds.destroy();
    state.charts.meds = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Taken as Prescribed (' + taken + ')', 'Missed (' + missed + ')'],
        datasets: [{
          data: [taken, missed],
          backgroundColor: [C.green, C.orange],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', align: 'center' }
        }
      }
    });
  }

  function renderDailyChart() {
    var canvas = $('chart-daily');
    if (!canvas) return;
    var w = lastDaysKeys(14);
    var ans = w.keys.map(function () { return 0; });
    var sos = w.keys.map(function () { return 0; });

    state.history.forEach(function (r) {
      var d = parseDate(r.answered_at); if (!d) return;
      var idx = w.keys.indexOf(localKey(d)); if (idx === -1) return;
      if (isSos(r)) sos[idx]++; else ans[idx]++;
    });

    if (state.charts.daily) state.charts.daily.destroy();
    state.charts.daily = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: w.labels,
        datasets: [
          { label: 'Check-ins Answered', data: ans, backgroundColor: C.blueBright, borderRadius: 0 },
          { label: 'Emergency Alerts (SOS)', data: sos, backgroundColor: C.red, borderRadius: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: (function () { var a = axes({ beginAtZero: true, stacked: true, ticks: { precision: 0, padding: 8 } }); a.x.stacked = true; return a; })(),
        plugins: { legend: { position: 'bottom', align: 'start' } }
      }
    });
  }

  /* ----------------------------------------------------------
     SOS EMERGENCY POLLING (SILENT ON DASHBOARD - NO SIREN)
     ---------------------------------------------------------- */
  function checkSos() {
    return apiFetch('/api/sos/active')
      .then(function (data) {
        var events = (data && data.sos_events) || [];
        state.activeSos = events;
        if (events.length > 0) {
          var latest = events[0];
          var d = parseDate(latest.triggered_at);
          dom.sosTimestamp.textContent = d ? (dayHeading(d) + ', ' + timeOf(d)) : latest.triggered_at;
          dom.sosCount.textContent = events.length > 1 ? (events.length + ' active emergencies') : '';
          dom.sosOverlay.classList.remove('hidden');
        } else {
          dom.sosOverlay.classList.add('hidden');
        }
      })
      .catch(function () {});
  }

  function acknowledgeSos() {
    if (!state.activeSos.length) {
      dom.sosOverlay.classList.add('hidden');
      return;
    }
    var promises = state.activeSos.map(function (ev) {
      return apiFetch('/api/sos/' + ev.id + '/acknowledge', { method: 'POST' });
    });
    Promise.all(promises)
      .then(function () {
        showToast('Emergency acknowledged.', 'info');
        dom.sosOverlay.classList.add('hidden');
        fetchAnalytics();
        fetchHistory();
      })
      .catch(function (err) { showToast('Could not acknowledge: ' + err.message, 'error'); });
  }

  /* ----------------------------------------------------------
     POLLING & REFRESH
     ---------------------------------------------------------- */
  function refreshAll() {
    fetchCurrentQuestion();
    fetchAnalytics();
    fetchAiInsights();
    fetchHistory();
    fetchSchedules();
    checkSos();
  }

  function startPolling() {
    setInterval(fetchCurrentQuestion, 2500);
    setInterval(checkSos, 2500);
    setInterval(function () {
      fetchAnalytics();
      fetchHistory().then(function () {
        if (state.activeTab === 'tab-tendencias') renderCharts();
      });
    }, 6000);
    setInterval(function () {
      if (state.activeTab === 'tab-programar') renderSchedules();
    }, 60000);
  }

  function updateGreeting() {
    if (!dom.welcomeGreeting) return;
    var hr = new Date().getHours();
    var greet = 'Good day';
    if (hr >= 5 && hr < 12) greet = 'Good morning';
    else if (hr >= 12 && hr < 18) greet = 'Good afternoon';
    else if (hr >= 18 || hr < 5) greet = 'Good evening';
    dom.welcomeGreeting.textContent = greet + ', ' + getCaregiverFirstName();
  }

  function bindScopeControls() {
    document.querySelectorAll('.scope-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = btn.getAttribute('data-scope');
        if (!s) return;
        setScope(s);
      });
    });
  }

  function setScope(scope) {
    state.currentScope = scope;
    document.querySelectorAll('.scope-pill').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-scope') === scope);
    });
    fetchAnalytics(scope);
    fetchAiInsights(true, scope);
  }

  /* ----------------------------------------------------------
     INIT
     ---------------------------------------------------------- */
  function init() {
    cacheDom();
    bindAuth();
    bindManageUsers();
    checkAuth();
    loadSpeechPref();
    updateGreeting();
    bindTabs();
    bindAsk();
    bindSchedule();
    bindHistory();
    bindGeminiModal();
    bindScopeControls();
    bindCompanionInteraction();
    bindOnboardingControls();
    bindSpotlightTourEvents();
    checkPatientProfile();

    dom.sosAckBtn.addEventListener('click', acknowledgeSos);

    refreshAll();
    startPolling();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
