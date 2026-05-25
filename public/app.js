const STORAGE_KEY = 'hermes_telegram_chat_ui_threads_v2';
const SIDEBAR_WIDTH_KEY = 'hermes_telegram_chat_ui_sidebar_width_v1';
const THEME_KEY = 'hermes_telegram_chat_ui_theme_v1';
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const SUPPORTED_COMMANDS = ['/help', '/commands', '/new', '/reset', '/clear', '/status', '/title', '/sessions', '/resume'];
const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 560;

function stripDisplayLeadingSymbols(text) {
  return String(text || '').replace(/^[^A-Za-z0-9가-힣/[\]]+/u, '').trim();
}

function isVerboseDisplayLine(line) {
  const normalized = stripDisplayLeadingSymbols(line);
  return /^(AI Agent initialized|Using custom base|Using API key:|Enabled toolset|Final tool selection|Loaded \d+ tools|Enabled toolsets:|Some tools may|Context limit:)/i.test(normalized);
}

function looksLikeThinkingDisplayContinuation(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return true;
  if (/[가-힣]/.test(trimmed)) return false;
  if (/^(```|#{1,6}\s|[-*]\s|\d+\.\s)/.test(trimmed)) return false;
  return /^[A-Za-z0-9 "'`()[\]{}.,:;!?/_-]+$/.test(trimmed);
}

function looksLikeInternalEnglishDisplayLine(line) {
  const trimmed = stripDisplayLeadingSymbols(line);
  if (!trimmed) return true;
  if (/[가-힣]/.test(trimmed)) return false;
  if (/^(```|#{1,6}\s|[-*]\s|\d+\.\s)/.test(trimmed)) return false;

  return (
    /^At\s+\/.+\.(md|txt|json|ya?ml|py|js|ts)\b/i.test(trimmed)
    || /^Here'?s?\s+(a\s+)?/i.test(trimmed)
    || /^Maybe\s+/i.test(trimmed)
    || /^Now\s+I\s+can\s+/i.test(trimmed)
    || /^I\s+(should|need|can|will|have|think|see|found|created)\b/i.test(trimmed)
    || /^This\s+(is|should|could|will|would)\b/i.test(trimmed)
    || /^The\s+user\s+(asked|wants|needs|is)\b/i.test(trimmed)
    || /^User\s+(asked|wants|needs)\b/i.test(trimmed)
    || /^It\s+looks\s+like\b/i.test(trimmed)
    || /^contains?\s+\d+\s+/i.test(trimmed)
    || /\b(subagent|sub-agent|agent instruction|agent command|skill levels?|additional files?|private info|confidential|system prompt|tool calls?|thinking)\b/i.test(trimmed)
  );
}

function isUsefulKoreanDisplayLine(line) {
  const trimmed = String(line || '').trim();
  if (!/[가-힣]/.test(trimmed)) return false;
  if (/^[가-힣]{1,4}[.。!?]?$/.test(trimmed)) return false;
  return true;
}

function stripLeadingInternalDisplayPreamble(lines) {
  const firstUsefulKorean = lines.findIndex((line) => isUsefulKoreanDisplayLine(line));
  if (firstUsefulKorean <= 0) return lines;

  const leading = lines.slice(0, firstUsefulKorean);
  const hasInternalSignal = leading.some((line) => {
    const trimmed = line.trim();
    return isVerboseDisplayLine(trimmed) || looksLikeInternalEnglishDisplayLine(trimmed);
  });

  return hasInternalSignal ? lines.slice(firstUsefulKorean) : lines;
}

function cleanAssistantDisplayText(raw) {
  const lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  const cleaned = [];
  let skippingThinking = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[thinking\]\s*/i.test(trimmed)) {
      skippingThinking = true;
      continue;
    }

    if (skippingThinking) {
      if (looksLikeThinkingDisplayContinuation(trimmed)) continue;
      skippingThinking = false;
    }

    if (isVerboseDisplayLine(trimmed)) continue;
    if (/^session_id:\s*\S+\s*$/i.test(trimmed)) continue;
    if (cleaned.length === 0 && looksLikeInternalEnglishDisplayLine(trimmed)) continue;
    cleaned.push(line);
  }

  const withoutInternalPreamble = stripLeadingInternalDisplayPreamble(cleaned);
  return normalizeAssistantMarkdown(withoutInternalPreamble.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

function normalizeAssistantMarkdown(raw) {
  const lines = String(raw || '').split('\n');
  let orderedIndex = 0;
  let inFence = false;

  return lines.map((line) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      return line;
    }

    if (inFence) return line;

    const orderedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (orderedMatch) {
      orderedIndex += 1;
      return `${orderedMatch[1]}${orderedIndex}. ${orderedMatch[2]}`;
    }

    return line;
  }).join('\n');
}

const state = {
  threads: [],
  activeThreadId: null,
  busy: false,
  pendingFiles: [],
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  isComposing: false,
  pendingSendAfterComposition: false,
  activityLog: [],
  abortController: null,
  health: null,
  execTimer: null,
  execStartTime: null,
  execLogKeys: new Set(),
  messageAnchorId: null,
  deferredInstallPrompt: null,
};

const els = {
  appShell: document.getElementById('app-shell'),
  threadList: document.getElementById('thread-list'),
  chatTitle: document.getElementById('chat-title'),
  chatSubtitle: document.getElementById('chat-subtitle'),
  messageList: document.getElementById('message-list'),
  messageTemplate: document.getElementById('message-template'),
  newChatBtn: document.getElementById('new-chat-btn'),
  composerForm: document.getElementById('composer-form'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  stopBtn: document.getElementById('stop-btn'),
  statusLine: document.getElementById('status-line'),
  attachBtn: document.getElementById('attach-btn'),
  fileInput: document.getElementById('file-input'),
  pendingFiles: document.getElementById('pending-files'),
  activityLog: document.getElementById('activity-log'),
  sidebarSubtitle: document.getElementById('sidebar-subtitle'),
  sidebarFooterMode: document.getElementById('sidebar-footer-mode'),
  chatHeaderBadge: document.getElementById('chat-header-badge'),
  sidebarResizer: document.getElementById('sidebar-resizer'),
  execPanel: document.getElementById('exec-panel'),
  execStatusBadge: document.getElementById('exec-status-badge'),
  execElapsed: document.getElementById('exec-elapsed'),
  execSteps: document.getElementById('exec-steps'),
  execPreview: document.getElementById('exec-preview'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIconMoon: document.getElementById('theme-icon-moon'),
  themeIconSun: document.getElementById('theme-icon-sun'),
  installAppBtn: document.getElementById('install-app-btn'),
};

function applyTheme(theme) {
  const isDark = theme !== 'light';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  if (els.themeIconMoon) els.themeIconMoon.hidden = !isDark;
  if (els.themeIconSun) els.themeIconSun.hidden = isDark;
  if (els.themeToggleBtn) {
    els.themeToggleBtn.title = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);
}

function clampSidebarWidth(width) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width || DEFAULT_SIDEBAR_WIDTH)));
}

function isNarrowLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function applySidebarWidth() {
  const width = clampSidebarWidth(state.sidebarWidth);
  state.sidebarWidth = width;
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
}

function saveSidebarWidth() {
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(state.sidebarWidth)));
}

function loadSidebarWidth() {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const parsed = Number(raw);
  state.sidebarWidth = Number.isFinite(parsed) ? clampSidebarWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
  applySidebarWidth();
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowTime() {
  return new Date().toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createThread(title = '새 채팅') {
  return {
    id: uid('thread'),
    title,
    sessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

function normalizeThreads(rawThreads) {
  if (!Array.isArray(rawThreads) || !rawThreads.length) {
    const thread = createThread();
    return { threads: [thread], activeThreadId: thread.id };
  }

  const threads = rawThreads.map((thread) => ({
    id: typeof thread.id === 'string' ? thread.id : uid('thread'),
    title: typeof thread.title === 'string' && thread.title.trim() ? thread.title : '새 채팅',
    sessionId: typeof thread.sessionId === 'string' && thread.sessionId.trim() ? thread.sessionId.trim() : null,
    createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt : Date.now(),
    updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : Date.now(),
    messages: Array.isArray(thread.messages)
      ? thread.messages.map((message) => ({
          id: typeof message.id === 'string' ? message.id : uid('msg'),
          role: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'system',
          text: typeof message.text === 'string' ? message.text : '',
          time: typeof message.time === 'string' ? message.time : nowTime(),
          typing: Boolean(message.typing),
          attachments: Array.isArray(message.attachments)
            ? message.attachments.map((attachment) => ({
                name: typeof attachment.name === 'string' ? attachment.name : 'file',
                size: Number.isFinite(attachment.size) ? attachment.size : 0,
                type: typeof attachment.type === 'string' ? attachment.type : '',
                path: typeof attachment.path === 'string' ? attachment.path : '',
                kind: typeof attachment.kind === 'string' ? attachment.kind : '',
              }))
            : [],
        }))
      : [],
  }));

  return { threads, activeThreadId: threads[0].id };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.threads));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const normalized = normalizeThreads([]);
      state.threads = normalized.threads;
      state.activeThreadId = normalized.activeThreadId;
      save();
      return;
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeThreads(parsed);
    state.threads = normalized.threads;
    state.activeThreadId = normalized.activeThreadId;
  } catch {
    const normalized = normalizeThreads([]);
    state.threads = normalized.threads;
    state.activeThreadId = normalized.activeThreadId;
    save();
  }
}

function getActiveThread() {
  return state.threads.find((thread) => thread.id === state.activeThreadId) || null;
}

function setStatus(text, tone = '') {
  els.statusLine.textContent = text;
  els.statusLine.className = `status-line${tone ? ` ${tone}` : ''}`;
}

function pushActivity(text, tone = '') {
  const cleaned = String(text || '').trim();
  if (!cleaned) return;

  const last = state.activityLog[state.activityLog.length - 1];
  if (last && last.text === cleaned && last.tone === tone) {
    last.time = nowTime();
  } else {
    state.activityLog.push({ id: uid('activity'), text: cleaned, tone, time: nowTime() });
    if (state.activityLog.length > 40) {
      state.activityLog = state.activityLog.slice(-40);
    }
  }

  renderActivityLog();
}

function renderActivityLog() {
  if (!els.activityLog) return;
  els.activityLog.innerHTML = '';

  if (!state.activityLog.length) {
    const empty = document.createElement('div');
    empty.className = 'activity-item';
    empty.textContent = '아직 실행 로그가 없습니다.';
    els.activityLog.appendChild(empty);
    return;
  }

  for (const entry of state.activityLog.slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'activity-item';
    row.textContent = `[${entry.time}] ${entry.text}`;
    if (entry.tone) row.dataset.tone = entry.tone;
    els.activityLog.appendChild(row);
  }
}

function startExecPanel() {
  state.execStartTime = Date.now();
  clearInterval(state.execTimer);
  state.execTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.execStartTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    if (els.execElapsed) els.execElapsed.textContent = `${min}:${sec}`;
  }, 1000);

  showExecPanel();
  if (els.execElapsed) els.execElapsed.textContent = '00:00';
  if (els.execStatusBadge) {
    els.execStatusBadge.className = 'exec-status-badge running';
    els.execStatusBadge.textContent = '실행 중';
  }
  if (els.execSteps) els.execSteps.innerHTML = '';
  if (els.execPreview) els.execPreview.innerHTML = '';
  if (els.execSteps) els.execSteps.scrollTop = 0;
  if (els.execPreview) els.execPreview.scrollTop = 0;
  state.execLogKeys = new Set();
  appendExecLog('Hermes 프로세스 연결 준비', 'status');
}

function showExecPanel() {
  if (els.execPanel) els.execPanel.hidden = false;
}

function addExecStep(text, state_ = '') {
  if (!els.execSteps) return;
  const cleanText = String(text || '').slice(0, 120);

  // 동일 텍스트의 active 단계가 이미 있으면 시간만 갱신하고 중복 추가하지 않음
  if (state_ === 'active') {
    const lastRow = els.execSteps.lastElementChild;
    if (lastRow) {
      const lastDot = lastRow.querySelector('.exec-step-dot');
      const lastText = lastRow.querySelector('.exec-step-text')?.textContent;
      if (lastDot?.classList.contains('active') && lastText === cleanText) {
        const timeEl = lastRow.querySelector('.exec-step-time');
        if (timeEl) timeEl.textContent = nowTime();
        return;
      }
    }
  }

  const prev = els.execSteps.querySelector('.exec-step-dot.active');
  if (prev) {
    prev.classList.remove('active');
    prev.classList.add('done');
    prev.nextElementSibling?.classList.remove('active');
  }
  const row = document.createElement('div');
  row.className = 'exec-step';
  const dotClass = `exec-step-dot${state_ === 'active' ? ' active' : state_ === 'done' ? ' done' : state_ === 'fail' ? ' fail' : ''}`;
  const textClass = `exec-step-text${state_ === 'active' ? ' active' : ''}`;
  row.innerHTML = `
    <span class="${dotClass}"></span>
    <span class="${textClass}">${escapeHtml(cleanText)}</span>
    <span class="exec-step-time">${nowTime()}</span>
  `;
  els.execSteps.appendChild(row);
  els.execSteps.scrollTop = els.execSteps.scrollHeight;
}

function execToneForLine(line) {
  if (/^(🔧|   ✓)/.test(line)) return 'tool';
  if (/^(💭|🧠|💬)/.test(line)) return 'thinking';
  if (/^(✅|응답 완료)/.test(line)) return 'complete';
  if (/^(⚠️|오류|중단)/.test(line)) return 'warn';
  return 'status';
}

function appendExecLog(text, tone = '') {
  if (!els.execPreview) return;
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());

  for (const line of lines) {
    const key = line.trim();
    if (state.execLogKeys.has(key)) continue;
    state.execLogKeys.add(key);

    const row = document.createElement('div');
    row.className = `exec-log-row ${tone || execToneForLine(key)}`;
    row.innerHTML = `
      <span class="exec-log-time">${nowTime()}</span>
      <span class="exec-log-text">${escapeHtml(line)}</span>
    `;
    els.execPreview.appendChild(row);
  }

  if (els.execPreview.scrollTop < 4) {
    els.execPreview.scrollTop = 0;
  }
}

function updateExecProcess(text) {
  appendExecLog(text);
}

function updateExecDraft(text) {
  if (!els.execPreview) return;
  const cleanText = String(text || '').trim();
  if (!cleanText) return;

  let row = els.execPreview.querySelector('.exec-log-row.draft');
  if (!row) {
    row = document.createElement('div');
    row.className = 'exec-log-row draft';
    row.innerHTML = `
      <span class="exec-log-time">${nowTime()}</span>
      <span class="exec-log-text"></span>
    `;
    els.execPreview.appendChild(row);
  }

  const latest = cleanText.length > 1200 ? `…${cleanText.slice(-1200)}` : cleanText;
  const textEl = row.querySelector('.exec-log-text');
  if (textEl) {
    textEl.textContent = `응답 작성 중: ${latest}`;
  }
  els.execPreview.scrollTop = els.execPreview.scrollHeight;
}

function finishExecPanel(phase, label) {
  clearInterval(state.execTimer);
  state.execTimer = null;

  const dotState = phase === 'complete' ? 'done' : 'fail';
  addExecStep(label || (phase === 'complete' ? '응답 완료' : '오류'), dotState);
  appendExecLog(label || (phase === 'complete' ? '응답 완료' : '오류'), phase === 'complete' ? 'complete' : 'warn');

  if (els.execStatusBadge) {
    els.execStatusBadge.className = `exec-status-badge ${phase}`;
    const labels = { complete: '완료', error: '오류', interrupted: '중단' };
    els.execStatusBadge.textContent = labels[phase] || phase;
  }
}

function renderControls() {
  const busy = Boolean(state.busy);
  els.sendBtn.disabled = busy;
  els.attachBtn.disabled = busy;
  els.stopBtn.hidden = !busy;
  els.stopBtn.disabled = !busy;
  els.sendBtn.classList.toggle('busy', busy);
}

function renderInstallControl() {
  if (!els.installAppBtn) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  els.installAppBtn.hidden = standalone || !state.deferredInstallPrompt;
}

function applyHealthMode() {
  const health = state.health;
  if (!health) return;

  if (health.lanOnly) {
    if (els.sidebarSubtitle) els.sidebarSubtitle.textContent = '텔레그램 스타일 · 같은 와이파이 접속 허용';
    if (els.sidebarFooterMode) els.sidebarFooterMode.textContent = '서버: 같은 와이파이 맥북 접속 허용';
    if (els.chatHeaderBadge) els.chatHeaderBadge.textContent = 'same wifi';
    return;
  }

  if (els.sidebarSubtitle) els.sidebarSubtitle.textContent = '텔레그램 스타일 · 로컬 브라우저 전용';
  if (els.sidebarFooterMode) els.sidebarFooterMode.textContent = '서버: 로컬 브라우저 전용';
  if (els.chatHeaderBadge) els.chatHeaderBadge.textContent = 'local';
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMarkdown(raw) {
  const lines = String(raw).split('\n');
  const out = [];
  let textBuf = [];
  let i = 0;

  function flushText() {
    if (!textBuf.length) return;
    out.push(`<p class="md-p">${textBuf.join('<br>')}</p>`);
    textBuf = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    // blank line: flush buffered text, no extra <br>
    if (line.trim() === '') {
      flushText();
      i++;
      continue;
    }

    // fenced code block
    if (line.startsWith('```')) {
      flushText();
      const lang = escapeHtml(line.slice(3).trim());
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      out.push(`<pre class="md-pre" data-lang="${lang || 'text'}"><code class="md-code${lang ? ' lang-' + lang : ''}">${codeLines.join('\n')}</code></pre>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushText();
      out.push('<hr class="md-hr">');
      i++;
      continue;
    }

    // heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      flushText();
      const level = hMatch[1].length;
      out.push(`<h${level} class="md-h md-h${level}">${inlineMarkdown(hMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // blockquote
    if (line.startsWith('> ')) {
      flushText();
      const bqLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote class="md-bq">${bqLines.map(inlineMarkdown).join('<br>')}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^[-*+]\s/.test(line)) {
      flushText();
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join('')}</ul>`);
      continue;
    }

    // ordered lines: render as Telegram-like rows to avoid browser list reset/indent drift
    if (/^\d+\.\s/.test(line)) {
      flushText();
      const rows = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const match = lines[i].match(/^(\d+)\.\s+(.+)$/);
        rows.push(`
          <div class="md-number-row">
            <span class="md-number-index">${escapeHtml(match[1])}.</span>
            <span class="md-number-body">${inlineMarkdown(match[2])}</span>
          </div>
        `);
        i++;
      }
      out.push(`<div class="md-number-list">${rows.join('')}</div>`);
      continue;
    }

    // label line: single line ending with ':' → flush previous, emit as label
    if (/[:：]\s*$/.test(line.trim())) {
      flushText();
      out.push(`<p class="md-p md-label">${inlineMarkdown(line)}</p>`);
      i++;
      continue;
    }

    // plain text: buffer consecutive lines into one paragraph
    textBuf.push(inlineMarkdown(line));
    i++;
  }

  flushText();
  return out.join('');
}

function inlineMarkdown(text) {
  // preserve HTML escape first
  let s = escapeHtml(text);
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code class="md-icode">$1</code>');
  // bold+italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // strikethrough
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // link [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

function autoGrowTextarea() {
  els.messageInput.style.height = 'auto';
  els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 200)}px`;
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function getPreview(thread) {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return '메시지가 없습니다.';
  if (last.text) {
    const displayText = last.role === 'assistant' ? cleanAssistantDisplayText(last.text) : last.text;
    const text = displayText.replace(/\s+/g, ' ').trim();
    return text.length > 46 ? `${text.slice(0, 46)}…` : text;
  }
  if (Array.isArray(last.attachments) && last.attachments.length) {
    const names = last.attachments.map((attachment) => attachment.name).join(', ');
    return names.length > 46 ? `${names.slice(0, 46)}…` : names;
  }
  return '메시지가 없습니다.';
}

function renderThreads() {
  const threads = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  els.threadList.innerHTML = '';

  for (const thread of threads) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `thread-item${thread.id === state.activeThreadId ? ' active' : ''}`;
    button.innerHTML = `
      <div class="thread-title">${escapeHtml(thread.title)}</div>
      <div class="thread-preview">${escapeHtml(getPreview(thread))}</div>
    `;
    button.addEventListener('click', () => {
      state.activeThreadId = thread.id;
      state.messageAnchorId = null;
      render();
    });
    els.threadList.appendChild(button);
  }
}

function createAttachmentChip(attachment) {
  const chip = document.createElement('div');
  chip.className = 'attachment-chip';
  chip.innerHTML = `
    <span class="attachment-chip-name">${escapeHtml(attachment.name)}</span>
    <span class="attachment-chip-size">${escapeHtml(formatBytes(attachment.size))}</span>
  `;
  return chip;
}

function renderMessages(thread) {
  els.messageList.innerHTML = '';
  els.messageList.classList.toggle('anchored-exchange', Boolean(state.messageAnchorId));

  if (!thread.messages.length) {
    els.messageList.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">Hermes 웹 채팅 준비 완료</div>
        <div class="empty-desc">파일 업로드와 /help 명령을 바로 사용할 수 있습니다.</div>
      </div>
    `;
    return;
  }

  for (const message of thread.messages) {
    const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(message.role);
    node.dataset.messageId = message.id;
    node.querySelector('.message-meta').textContent = `${roleLabel(message.role)} · ${message.time}`;

    const bubble = node.querySelector('.message-bubble');
    const textNode = node.querySelector('.message-text');
    const attachmentsNode = node.querySelector('.message-attachments');

    if (message.role === 'assistant' && message.typing) {
      bubble.innerHTML = `
        <span class="typing-dots" aria-label="typing">
          <span></span><span></span><span></span>
        </span>
      `;
    } else {
      if (message.text) {
        const isPlain = message.role === 'user' || message.role === 'system';
        if (isPlain) {
          textNode.textContent = message.text;
        } else {
          textNode.innerHTML = renderMarkdown(cleanAssistantDisplayText(message.text));
        }
      } else {
        textNode.hidden = true;
      }

      attachmentsNode.innerHTML = '';
      if (Array.isArray(message.attachments) && message.attachments.length) {
        for (const attachment of message.attachments) {
          attachmentsNode.appendChild(createAttachmentChip(attachment));
        }
      } else {
        attachmentsNode.hidden = true;
      }
    }

    els.messageList.appendChild(node);
  }

  alignMessageViewport();
}

function alignMessageViewport() {
  if (!state.messageAnchorId) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
    return;
  }

  const anchor = els.messageList.querySelector(`[data-message-id="${CSS.escape(state.messageAnchorId)}"]`);
  if (!anchor) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
    return;
  }

  const topOffset = Math.max(0, anchor.offsetTop - 24);
  if (Math.abs(els.messageList.scrollTop - topOffset) > 2) {
    els.messageList.scrollTop = topOffset;
  }
}

function roleLabel(role) {
  if (role === 'user') return '나';
  if (role === 'assistant') return 'Hermes';
  return '시스템';
}

function renderHeader(thread) {
  els.chatTitle.textContent = thread.title;
  els.chatSubtitle.textContent = thread.sessionId ? `session_id: ${thread.sessionId}` : 'session_id 없음';
}

function renderPendingFiles() {
  els.pendingFiles.innerHTML = '';
  if (!state.pendingFiles.length) {
    els.pendingFiles.hidden = true;
    return;
  }

  els.pendingFiles.hidden = false;
  for (const pendingFile of state.pendingFiles) {
    const row = document.createElement('div');
    row.className = 'pending-file';
    row.innerHTML = `
      <div class="pending-file-meta">
        <div class="pending-file-name">${escapeHtml(pendingFile.name)}</div>
        <div class="pending-file-size">${escapeHtml(formatBytes(pendingFile.size))}</div>
      </div>
      <button class="pending-file-remove" type="button">제거</button>
    `;
    row.querySelector('.pending-file-remove').addEventListener('click', () => {
      state.pendingFiles = state.pendingFiles.filter((item) => item.id !== pendingFile.id);
      renderPendingFiles();
    });
    els.pendingFiles.appendChild(row);
  }
}

function render() {
  const thread = getActiveThread();
  if (!thread) return;
  renderThreads();
  renderHeader(thread);
  renderMessages(thread);
  renderPendingFiles();
  renderActivityLog();
  renderControls();
  applyHealthMode();
}

function upsertThread(thread) {
  const index = state.threads.findIndex((item) => item.id === thread.id);
  if (index >= 0) {
    state.threads[index] = thread;
  } else {
    state.threads.push(thread);
  }
  save();
}

function addMessage(thread, message) {
  thread.messages.push(message);
  thread.updatedAt = Date.now();
  if (thread.title === '새 채팅' && message.role === 'user' && message.text) {
    const compact = message.text.replace(/\s+/g, ' ').trim();
    thread.title = compact.length > 24 ? `${compact.slice(0, 24)}…` : compact || '새 채팅';
  }
  upsertThread(thread);
  render();
}

function updateMessage(thread, messageId, updates) {
  const target = thread.messages.find((message) => message.id === messageId);
  if (!target) return;
  Object.assign(target, updates);
  thread.updatedAt = Date.now();
  upsertThread(thread);
  render();
}

function removeTypingMessage(thread, id) {
  thread.messages = thread.messages.filter((message) => message.id !== id);
  thread.updatedAt = Date.now();
  upsertThread(thread);
  render();
}

function handleNewChat(title = '새 채팅') {
  state.messageAnchorId = null;
  const thread = createThread(title && title.trim() ? title.trim() : '새 채팅');
  state.threads.unshift(thread);
  state.activeThreadId = thread.id;
  save();
  render();
  setStatus('새 채팅 시작', 'ok');
  els.messageInput.focus();
}

function toAttachmentRef(fileLike) {
  return {
    name: fileLike.name,
    size: fileLike.size,
    type: fileLike.type || '',
    path: fileLike.path || '',
    kind: fileLike.kind || (fileLike.type && fileLike.type.startsWith('image/') ? 'image' : 'file'),
  };
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error(`파일 읽기 실패: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function readWithInactivityTimeout(reader, timeoutMs) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('서버 응답이 멈췄습니다. 중단 후 다시 시도해주세요.'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readNdjsonStream(response, onEvent, options = {}) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('브라우저 스트리밍을 지원하지 않습니다.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const inactivityTimeoutMs = Number.isFinite(options.inactivityTimeoutMs)
    ? options.inactivityTimeoutMs
    : 180000;

  while (true) {
    const { value, done } = await readWithInactivityTimeout(reader, inactivityTimeoutMs);
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onEvent(JSON.parse(line));
      newlineIndex = buffer.indexOf('\n');
    }

    if (done) {
      const rest = buffer.trim();
      if (rest) onEvent(JSON.parse(rest));
      return;
    }
  }
}

function sessionIdLabel(sessionId, fallback) {
  return sessionId ? `${fallback} · session_id=${sessionId}` : fallback;
}

function parseSlashCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  return {
    raw: trimmed,
    name: match[1].toLowerCase(),
    args: (match[2] || '').trim(),
  };
}

function listThreadsForCommand() {
  const threads = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  return threads.map((thread) => {
    const shortId = thread.id.slice(-6);
    const sessionText = thread.sessionId ? `session_id=${thread.sessionId}` : 'session_id 없음';
    return `- ${shortId} | ${thread.title} | ${sessionText}`;
  }).join('\n');
}

function buildStatusText(thread) {
  const messageCount = thread.messages.length;
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastAttachmentCount = lastMessage?.attachments?.length || 0;
  return [
    '현재 채팅 상태',
    `- 제목: ${thread.title}`,
    `- session_id: ${thread.sessionId || '없음'}`,
    `- 메시지 수: ${messageCount}`,
    `- 마지막 첨부 수: ${lastAttachmentCount}`,
    `- 지원 명령: ${SUPPORTED_COMMANDS.join(' ')}`,
  ].join('\n');
}

function buildHelpText() {
  return [
    '웹 UI 지원 Hermes 명령',
    '- /help 또는 /commands : 명령 목록 표시',
    '- /new [제목] : 새 채팅 생성',
    '- /reset [제목] : /new 와 동일',
    '- /clear : 새 채팅 생성',
    '- /status : 현재 채팅 상태 표시',
    '- /title <제목> : 현재 채팅 제목 변경',
    '- /sessions : 저장된 채팅 목록 표시',
    '- /resume <짧은ID|session_id|제목일부> : 해당 채팅으로 전환',
    '',
    '비고',
    '- 이 웹 UI는 hermes chat 비대화형 래퍼이므로 모든 TUI 슬래시 명령을 1:1로 지원하지는 않습니다.',
    '- 현재는 로컬 전용으로 안전하게 지원 가능한 세션/채팅 중심 명령만 연결했습니다.',
  ].join('\n');
}

function findThreadForResume(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  return state.threads.find((thread) => {
    const shortId = thread.id.slice(-6).toLowerCase();
    const title = thread.title.toLowerCase();
    const sessionId = (thread.sessionId || '').toLowerCase();
    return shortId === normalized || thread.id.toLowerCase() === normalized || sessionId === normalized || title.includes(normalized);
  }) || null;
}

function executeSlashCommand(thread, command) {
  switch (command.name) {
    case 'help':
    case 'commands':
      addMessage(thread, {
        id: uid('msg'),
        role: 'system',
        text: buildHelpText(),
        time: nowTime(),
        attachments: [],
      });
      setStatus('명령 목록 표시', 'ok');
      return true;
    case 'new':
    case 'reset':
    case 'clear':
      handleNewChat(command.args || '새 채팅');
      return true;
    case 'status':
      addMessage(thread, {
        id: uid('msg'),
        role: 'system',
        text: buildStatusText(thread),
        time: nowTime(),
        attachments: [],
      });
      setStatus('상태 표시', 'ok');
      return true;
    case 'title': {
      const nextTitle = command.args.trim();
      if (!nextTitle) {
        addMessage(thread, {
          id: uid('msg'),
          role: 'system',
          text: '사용법: /title <제목>',
          time: nowTime(),
          attachments: [],
        });
        setStatus('제목 인자가 필요합니다.', 'error');
        return true;
      }
      thread.title = nextTitle;
      thread.updatedAt = Date.now();
      upsertThread(thread);
      render();
      setStatus('채팅 제목 변경 완료', 'ok');
      return true;
    }
    case 'sessions':
      addMessage(thread, {
        id: uid('msg'),
        role: 'system',
        text: `저장된 채팅 목록\n${listThreadsForCommand()}`,
        time: nowTime(),
        attachments: [],
      });
      setStatus('채팅 목록 표시', 'ok');
      return true;
    case 'resume': {
      if (!command.args) {
        addMessage(thread, {
          id: uid('msg'),
          role: 'system',
          text: `사용법: /resume <짧은ID|session_id|제목일부>\n\n${listThreadsForCommand()}`,
          time: nowTime(),
          attachments: [],
        });
        setStatus('전환 대상이 필요합니다.', 'error');
        return true;
      }
      const target = findThreadForResume(command.args);
      if (!target) {
        addMessage(thread, {
          id: uid('msg'),
          role: 'system',
          text: `대상 채팅을 찾지 못했습니다: ${command.args}`,
          time: nowTime(),
          attachments: [],
        });
        setStatus('대상 채팅 없음', 'error');
        return true;
      }
      state.activeThreadId = target.id;
      render();
      setStatus(`채팅 전환: ${target.title}`, 'ok');
      return true;
    }
    default:
      addMessage(thread, {
        id: uid('msg'),
        role: 'system',
        text: `현재 웹 UI에서 지원하지 않는 명령입니다: /${command.name}\n/help 로 지원 범위를 확인하세요.`,
        time: nowTime(),
        attachments: [],
      });
      setStatus(`미지원 명령: /${command.name}`, 'error');
      return true;
  }
}

async function sendPreparedMessage(thread, message, attachments) {
  const typingId = uid('typing');
  const userMessageId = uid('msg');
  const displayText = message || (attachments.length ? '첨부파일 전송' : '');
  const displayAttachments = attachments.map(toAttachmentRef);
  state.messageAnchorId = userMessageId;

  addMessage(thread, {
    id: userMessageId,
    role: 'user',
    text: displayText,
    time: nowTime(),
    attachments: displayAttachments,
  });

  addMessage(thread, {
    id: typingId,
    role: 'assistant',
    text: '',
    time: nowTime(),
    typing: true,
    attachments: [],
  });

  try {
    const payloadAttachments = await Promise.all(
      attachments.map((attachment) => {
        if (attachment?.file instanceof File) return fileToPayload(attachment.file);
        if (attachment instanceof File) return fileToPayload(attachment);
        return Promise.resolve(toAttachmentRef(attachment));
      }),
    );

    const controller = new AbortController();
    state.abortController = controller;
    renderControls();
    pushActivity(sessionIdLabel(thread.sessionId, 'Hermes 스트리밍 요청 시작'), 'busy');
    startExecPanel();

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sessionId: thread.sessionId,
        attachments: payloadAttachments,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Hermes 호출 실패');
    }

    let completed = false;

    await readNdjsonStream(response, (event) => {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'status') {
        setStatus(event.message || 'Hermes 응답 생성 중...', 'busy');
        pushActivity(event.message || 'Hermes 응답 생성 중...', 'busy');
        addExecStep(event.message || 'Hermes 응답 생성 중...', 'active');
        appendExecLog(event.message || 'Hermes 응답 생성 중...', 'status');
        return;
      }

      if (event.type === 'heartbeat') {
        setStatus(event.message || 'Hermes 응답 대기 중...', 'busy');
        appendExecLog(event.message || 'Hermes 응답 대기 중...', 'status');
        return;
      }

      if (event.type === 'process') {
        updateExecProcess(event.text || '');
        return;
      }

      if (event.type === 'progress') {
        const cleanedProgress = cleanAssistantDisplayText(event.text || '');
        updateMessage(thread, typingId, {
          text: cleanedProgress,
          typing: !cleanedProgress.trim(),
          attachments: [],
        });
        setStatus('Hermes 응답 스트리밍 중...', 'busy');
        return;
      }

      if (event.type === 'complete') {
        completed = true;
        thread.sessionId = event.sessionId || thread.sessionId;
        const returnedAttachments = Array.isArray(event.attachments) ? event.attachments.map(toAttachmentRef) : displayAttachments;
        updateMessage(thread, userMessageId, { attachments: returnedAttachments });
        updateMessage(thread, typingId, {
          text: cleanAssistantDisplayText(event.reply || ''),
          typing: false,
          attachments: [],
        });
        pushActivity(sessionIdLabel(thread.sessionId, 'Hermes 응답 완료'), 'ok');
        setStatus('응답 완료', 'ok');
        finishExecPanel('complete', sessionIdLabel(thread.sessionId, 'Hermes 응답 완료'));
        return;
      }

      if (event.type === 'interrupted') {
        throw new Error(event.error || '이전 응답이 사용자 요청으로 중단되었습니다.');
      }

      if (event.type === 'error') {
        throw new Error(event.error || 'Hermes 호출 실패');
      }
    });

    if (!completed) {
      throw new Error('Hermes 스트리밍이 비정상 종료되었습니다.');
    }
  } catch (error) {
    removeTypingMessage(thread, typingId);
    const isAbort = error?.name === 'AbortError';
    const messageText = isAbort ? '응답 생성을 중단했습니다.' : (error.message || '알 수 없는 오류');
    addMessage(thread, {
      id: uid('msg'),
      role: 'system',
      text: messageText,
      time: nowTime(),
      attachments: [],
    });
    pushActivity(messageText, isAbort ? 'ok' : 'error');
    setStatus(messageText, isAbort ? 'ok' : 'error');
    finishExecPanel(isAbort ? 'interrupted' : 'error', messageText);
  } finally {
    state.abortController = null;
    renderControls();
  }
}

async function flushPendingSendAfterComposition() {
  if (!state.pendingSendAfterComposition || state.isComposing || state.busy) return;
  state.pendingSendAfterComposition = false;
  await sendMessage();
}

async function sendMessage() {
  if (state.busy) return;

  const thread = getActiveThread();
  if (!thread) return;

  const message = els.messageInput.value.trim();
  const attachments = [...state.pendingFiles];

  if (!message && !attachments.length) return;
  if (message.startsWith('/') && attachments.length === 0) {
    const command = parseSlashCommand(message);
    if (command) {
      els.messageInput.value = '';
      autoGrowTextarea();
      executeSlashCommand(thread, command);
      return;
    }
  }

  state.busy = true;
  renderControls();
  setStatus('Hermes 응답 대기 중...', 'busy');

  els.messageInput.value = '';
  autoGrowTextarea();
  state.pendingFiles = [];
  renderPendingFiles();
  els.fileInput.value = '';

  try {
    await sendPreparedMessage(thread, message, attachments);
  } finally {
    state.busy = false;
    renderControls();
    els.messageInput.focus();
  }
}

function mergePendingFiles(fileList) {
  const next = [...state.pendingFiles];

  for (const file of fileList) {
    if (next.length >= MAX_ATTACHMENTS) {
      setStatus(`첨부는 최대 ${MAX_ATTACHMENTS}개까지 가능합니다.`, 'error');
      break;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setStatus(`파일 용량 초과: ${file.name}`, 'error');
      continue;
    }

    const exists = next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
    if (exists) continue;

    next.push({
      id: uid('file'),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      file,
      lastModified: file.lastModified,
    });
  }

  state.pendingFiles = next;
  renderPendingFiles();
  if (state.pendingFiles.length) {
    setStatus(`${state.pendingFiles.length}개 파일 준비됨`, 'ok');
  }
}

function bindEvents() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    renderInstallControl();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    renderInstallControl();
    setStatus('앱 설치 완료', 'ok');
  });

  if (els.installAppBtn) {
    els.installAppBtn.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      const promptEvent = state.deferredInstallPrompt;
      state.deferredInstallPrompt = null;
      renderInstallControl();
      promptEvent.prompt();
      await promptEvent.userChoice.catch(() => null);
    });
  }

  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener('click', toggleTheme);
  }
  els.newChatBtn.addEventListener('click', () => handleNewChat());
  els.attachBtn.addEventListener('click', () => els.fileInput.click());
  els.stopBtn.addEventListener('click', () => {
    if (!state.abortController) return;
    state.abortController.abort();
    pushActivity('사용자가 현재 응답을 중단했습니다.', 'ok');
  });
  els.fileInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    mergePendingFiles(files);
  });

  els.composerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.isComposing) {
      state.pendingSendAfterComposition = true;
      els.messageInput.focus();
      return;
    }
    await sendMessage();
  });

  els.messageInput.addEventListener('input', autoGrowTextarea);
  els.messageInput.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  els.messageInput.addEventListener('compositionend', async () => {
    state.isComposing = false;
    autoGrowTextarea();
    await flushPendingSendAfterComposition();
  });
  els.messageInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.isComposing || state.isComposing || event.keyCode === 229) {
        return;
      }
      event.preventDefault();
      await sendMessage();
    }
  });

  els.sendBtn.addEventListener('pointerdown', (event) => {
    if (!state.isComposing) return;
    event.preventDefault();
    state.pendingSendAfterComposition = true;
    els.messageInput.focus();
  });

  if (els.sidebarResizer) {
    const stopResize = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      saveSidebarWidth();
    };

    const onPointerMove = (event) => {
      if (isNarrowLayout()) return;
      state.sidebarWidth = clampSidebarWidth(event.clientX);
      applySidebarWidth();
    };

    els.sidebarResizer.addEventListener('pointerdown', (event) => {
      if (isNarrowLayout()) return;
      event.preventDefault();
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    });

    els.sidebarResizer.addEventListener('dblclick', () => {
      state.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      applySidebarWidth();
      saveSidebarWidth();
      setStatus('왼쪽 목록 너비 기본값으로 복원', 'ok');
    });

    window.addEventListener('resize', () => {
      if (isNarrowLayout()) return;
      applySidebarWidth();
    });
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    pushActivity('PWA 설치 준비 실패', 'error');
  }
}

async function bootstrap() {
  loadTheme();
  load();
  loadSidebarWidth();
  bindEvents();
  await registerServiceWorker();
  render();
  autoGrowTextarea();
  renderControls();
  renderInstallControl();
  renderActivityLog();
  showExecPanel();

  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error('헬스체크 실패');
    }
    state.health = data;
    applyHealthMode();
    pushActivity(`서버 연결 완료 · timeout ${Math.round((data.requestTimeoutMs || 0) / 60000)}분`, 'ok');
    setStatus('로컬 서버 연결 완료', 'ok');
  } catch {
    pushActivity('로컬 서버 연결 실패', 'error');
    setStatus('로컬 서버 연결 실패', 'error');
  }
}

bootstrap();
