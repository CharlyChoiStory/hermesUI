const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8793);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const HERMES_TIMEOUT_MS = Math.max(30_000, Number(process.env.HERMES_TIMEOUT_MS || 30 * 60 * 1000));
const ALLOW_LAN = process.env.ALLOW_LAN === '1' || HOST === '0.0.0.0';
const SUPPORTED_WEB_COMMANDS = ['/help', '/commands', '/new', '/reset', '/clear', '/status', '/title', '/sessions', '/resume'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function getLanIPv4s() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const infos of Object.values(interfaces)) {
    for (const info of infos || []) {
      if (
        info.family === 'IPv4'
        && !info.internal
        && typeof info.address === 'string'
        && !info.address.startsWith('169.254.')
      ) {
        addresses.push(info.address);
      }
    }
  }

  return addresses;
}

const LAN_IPV4S = getLanIPv4s();

function normalizeRemoteAddress(address) {
  if (!address) return '';
  if (address.startsWith('::ffff:')) return address.slice(7);
  return address;
}

function isLoopback(address) {
  const normalized = normalizeRemoteAddress(address);
  return ['127.0.0.1', '::1', 'localhost'].includes(normalized);
}

function same24Subnet(ipA, ipB) {
  const a = String(ipA || '').split('.');
  const b = String(ipB || '').split('.');
  return a.length === 4 && b.length === 4 && a.slice(0, 3).join('.') === b.slice(0, 3).join('.');
}

function isAllowedRemote(address) {
  const normalized = normalizeRemoteAddress(address);
  if (isLoopback(normalized)) return true;
  if (!ALLOW_LAN) return false;
  return LAN_IPV4S.some((lanIp) => same24Subnet(lanIp, normalized));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendNdjsonEvent(res, payload) {
  if (res.writableEnded) return;
  res.write(`${JSON.stringify(payload)}\n`);
}

async function ensureUploadDir() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function parseHermesOutput(stdout, stderr) {
  const combined = `${stderr || ''}\n${stdout || ''}`.replace(/\r\n/g, '\n').trim();
  const lines = combined.split('\n');
  let sessionId = null;

  for (const line of lines) {
    if (!sessionId) {
      const match = line.match(/^session_id:\s*(\S+)\s*$/i);
      if (match) {
        sessionId = match[1];
      }
    }
  }

  const cleanedReply = sanitizeHermesReply(stdout || '');

  return {
    sessionId,
    reply: cleanedReply,
    raw: combined,
  };
}

function stripDiffLikePrefixes(text) {
  const lines = String(text || '').split('\n');
  const meaningful = lines.filter((line) => line.trim());
  if (meaningful.length < 4) return text;

  const prefixed = meaningful.filter((line) => /^\+\s*(#{1,6}\s|```|[-*]\s|\d+\.\s|`[^`]+`|[A-Za-z0-9가-힣_/.\-])/.test(line));
  if (prefixed.length < Math.max(3, Math.ceil(meaningful.length * 0.6))) {
    return text;
  }

  return lines.map((line) => (line.startsWith('+') ? line.slice(1) : line)).join('\n').trim();
}

function stripLeadingSymbols(text) {
  return String(text || '').replace(/^[^A-Za-z0-9가-힣/[\]]+/u, '').trim();
}

function isHermesVerboseLine(line) {
  const normalized = stripLeadingSymbols(line);
  return /^(AI Agent initialized|Using custom base|Using API key:|Enabled toolset|Final tool selection|Loaded \d+ tools|Enabled toolsets:|Some tools may|Context limit:)/i.test(normalized);
}

function looksLikeThinkingContinuation(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return true;
  if (/[가-힣]/.test(trimmed)) return false;
  if (/^(```|#{1,6}\s|[-*]\s|\d+\.\s)/.test(trimmed)) return false;
  return /^[A-Za-z0-9 "'`()[\]{}.,:;!?/_-]+$/.test(trimmed);
}

function looksLikeInternalEnglishLine(line) {
  const trimmed = stripLeadingSymbols(line);
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

function isUsefulKoreanAnswerLine(line) {
  const trimmed = String(line || '').trim();
  if (!/[가-힣]/.test(trimmed)) return false;
  if (/^[가-힣]{1,4}[.。!?]?$/.test(trimmed)) return false;
  return true;
}

function stripLeadingInternalPreamble(lines) {
  const firstUsefulKorean = lines.findIndex((line) => isUsefulKoreanAnswerLine(line));
  if (firstUsefulKorean <= 0) return lines;

  const leading = lines.slice(0, firstUsefulKorean);
  const hasInternalSignal = leading.some((line) => {
    const trimmed = line.trim();
    return isHermesVerboseLine(trimmed) || looksLikeInternalEnglishLine(trimmed);
  });

  return hasInternalSignal ? lines.slice(firstUsefulKorean) : lines;
}

function sanitizeHermesReply(output) {
  const lines = String(output || '').replace(/\r\n/g, '\n').split('\n');
  const cleaned = [];
  let skippingReviewDiff = false;
  let skippingThinkingBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[thinking\]\s*/i.test(trimmed)) {
      skippingThinkingBlock = true;
      continue;
    }

    if (skippingThinkingBlock) {
      if (!trimmed) continue;
      if (looksLikeThinkingContinuation(trimmed)) {
        continue;
      }
      skippingThinkingBlock = false;
    }

    if (/^\[?\s*┊\s*review diff\b/i.test(trimmed)) {
      skippingReviewDiff = true;
      continue;
    }

    if (skippingReviewDiff) {
      if (
        !trimmed
        || /^a\/.*\s+→\s+b\//.test(trimmed)
        || /^@@\s/.test(trimmed)
        || /^[ +\-]/.test(line)
        || trimmed === ']'
      ) {
        continue;
      }

      skippingReviewDiff = false;
    }

    if (/^↻\s+Resumed session\b/.test(trimmed)) continue;
    if (/^session_id:\s*\S+\s*$/i.test(trimmed)) continue;
    // -v 모드 verbose 초기화 라인 제거 (아이콘 접두어가 붙은 경우 포함)
    if (isHermesVerboseLine(trimmed)) continue;
    if (cleaned.length === 0 && looksLikeInternalEnglishLine(trimmed)) continue;
    if (/^\[\s*$/.test(trimmed)) continue;
    if (/^\*\*\* (Begin|End) Patch\b/.test(trimmed)) continue;
    if (/^\*\*\* (Add|Update|Delete) File:\s+/.test(trimmed)) continue;
    if (/^diff --git\s+/.test(trimmed)) continue;
    if (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(trimmed)) continue;
    if (/^(---|\+\+\+)\s+[ab]\//.test(trimmed)) continue;
    if (/^@@\s+/.test(trimmed)) continue;

    cleaned.push(line);
  }

  const withoutInternalPreamble = stripLeadingInternalPreamble(cleaned);
  return stripDiffLikePrefixes(withoutInternalPreamble.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

function extractStdoutProcessLog(output) {
  const lines = String(output || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[thinking\]\s*/i.test(trimmed)) {
      const text = trimmed.replace(/^\[thinking\]\s*/i, '').trim();
      if (text) out.push(`💭 ${text}`);
    }
  }

  return out.join('\n');
}

function stripAnsi(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*[\x07\x1b\\]/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x1b[^[\]()]/g, '');
}

// stderr verbose log → exec panel용 깔끔한 텍스트로 변환
function formatProcessLog(rawStderr) {
  const lines = rawStderr.split('\n');
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^session_id:/i.test(trimmed)) continue;
    if (isHermesVerboseLine(trimmed)) continue;

    // "HH:MM:SS - module - LEVEL [session] - MESSAGE" 형태에서 MESSAGE 추출
    const msgMatch = line.match(/^\d+:\d+:\d+ - \S+ - \w+ (?:\[\S+\] )?- (.+)$/);
    if (!msgMatch) continue;
    const msg = msgMatch[1].trim();
    if (isHermesVerboseLine(msg)) continue;

    const sizeMatch = msg.match(/^Total message size:\s+~?([\d,]+)\s+tokens/i);
    if (sizeMatch) {
      out.push(`🧠 컨텍스트 준비 · ${sizeMatch[1]} tokens`);
      continue;
    }

    const requestMatch = msg.match(/^API Request - Model:\s*([^,]+),\s*Messages:\s*(\d+),\s*Tools:\s*(\d+)/i);
    if (requestMatch) {
      out.push(`💭 thinking 시작 · ${requestMatch[1]} · messages ${requestMatch[2]} · tools ${requestMatch[3]}`);
      continue;
    }

    // Tool call: terminal with args: {"command":"..."}
    const toolCallMatch = msg.match(/^Tool call: (\w+) with args: (.+)$/);
    if (toolCallMatch) {
      const tool = toolCallMatch[1];
      let shortArgs = '';
      try {
        const args = JSON.parse(toolCallMatch[2]);
        const firstVal = Object.values(args)[0];
        if (typeof firstVal === 'string') {
          shortArgs = `"${firstVal.length > 55 ? firstVal.slice(0, 55) + '…' : firstVal}"`;
        }
      } catch { shortArgs = toolCallMatch[2].slice(0, 60); }
      out.push(`🔧 ${tool}(${shortArgs})`);
      continue;
    }

    const hermesToolCallMatch = msg.match(/^Tool call:\s*(.+)$/i);
    if (hermesToolCallMatch) {
      out.push(`🔧 ${hermesToolCallMatch[1].slice(0, 140)}`);
      continue;
    }

    // tool terminal completed (0.11s, 77 chars)
    const toolDoneMatch = msg.match(/^tool (\w+) completed \((.+?)\)/);
    if (toolDoneMatch) {
      out.push(`   ✓ ${toolDoneMatch[1]} 완료 (${toolDoneMatch[2]})`);
      continue;
    }

    // API call #1: model=gpt-5.5 ... in=16143 out=48 ... latency=4.1s
    const apiMatch = msg.match(/^API call #(\d+): model=(\S+) .* in=(\d+) out=(\d+) .* latency=(\S+)/);
    if (apiMatch) {
      const cacheMatch = msg.match(/cache=(\d+)\/(\d+)/);
      const cacheStr = cacheMatch ? ` cache=${Math.round(Number(cacheMatch[1]) / Number(cacheMatch[2]) * 100)}%` : '';
      out.push(`💭 API #${apiMatch[1]}: ${apiMatch[2]} | in=${Number(apiMatch[3]).toLocaleString()} out=${apiMatch[4]} (${apiMatch[5]}${cacheStr})`);
      continue;
    }

    const responseMatch = msg.match(/^API Response received - Model:\s*([^,]+),\s*Usage:\s*(.+)$/i);
    if (responseMatch) {
      out.push(`💬 모델 응답 수신 · ${responseMatch[1]}`);
      continue;
    }

    // Turn ended: api_calls=2/40 ... tool_turns=1
    const turnMatch = msg.match(/^Turn ended:.*?api_calls=(\d+)\/\d+.*?tool_turns=(\d+)/);
    if (turnMatch) {
      out.push(`✅ 완료: API ${turnMatch[1]}회 · Tool ${turnMatch[2]}회`);
      continue;
    }

    // conversation turn: history=N
    const turnStartMatch = msg.match(/^conversation turn:.*?history=(\d+)/);
    if (turnStartMatch) {
      out.push(`▶ 새 요청 (이전 히스토리 ${turnStartMatch[1]}개)`);
      continue;
    }

    if (/conversation turn:/i.test(msg)) {
      out.push('▶ 새 요청 시작');
      continue;
    }
  }

  return out.join('\n');
}

function interruptChildProcess(child) {
  if (!child || child.exitCode !== null) return;

  try {
    child.kill('SIGINT');
  } catch {
    return;
  }

  setTimeout(() => {
    if (child.exitCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {
        // noop
      }
    }
  }, 1500).unref();
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '') || 'file';
}

function classifyAttachment(mimeType) {
  if (typeof mimeType === 'string' && mimeType.startsWith('image/')) return 'image';
  return 'file';
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    const error = new Error('Invalid attachment payload');
    error.statusCode = 400;
    throw error;
  }

  const match = dataUrl.match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=\n\r]+)$/);
  if (!match) {
    const error = new Error('Unsupported attachment encoding');
    error.statusCode = 400;
    throw error;
  }

  const mimeType = match[1] || 'application/octet-stream';
  const buffer = Buffer.from(match[2], 'base64');
  return { mimeType, buffer };
}

async function normalizeIncomingAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    const error = new Error('Invalid attachment');
    error.statusCode = 400;
    throw error;
  }

  if (typeof attachment.path === 'string' && attachment.path.trim()) {
    const resolvedPath = path.resolve(attachment.path.trim());
    if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep) && resolvedPath !== UPLOAD_DIR) {
      const error = new Error('Attachment path is outside local upload storage');
      error.statusCode = 403;
      throw error;
    }

    const stat = await fsp.stat(resolvedPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      const error = new Error('Attached file reference was not found');
      error.statusCode = 404;
      throw error;
    }

    return {
      name: sanitizeFilename(attachment.name || path.basename(resolvedPath)),
      type: typeof attachment.type === 'string' && attachment.type ? attachment.type : 'application/octet-stream',
      size: Number.isFinite(attachment.size) ? Number(attachment.size) : stat.size,
      path: resolvedPath,
      kind: classifyAttachment(attachment.type),
    };
  }

  if (typeof attachment.dataUrl === 'string' && attachment.dataUrl) {
    const { mimeType, buffer } = parseDataUrl(attachment.dataUrl);
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      const error = new Error(`Attachment too large: ${attachment.name || 'file'}`);
      error.statusCode = 413;
      throw error;
    }

    const originalName = sanitizeFilename(attachment.name || 'file');
    const ext = path.extname(originalName) || '';
    const stem = originalName.slice(0, originalName.length - ext.length) || 'file';
    const storedName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${stem}${ext}`;
    const storedPath = path.join(UPLOAD_DIR, storedName);
    await fsp.writeFile(storedPath, buffer);

    return {
      name: originalName,
      type: typeof attachment.type === 'string' && attachment.type ? attachment.type : mimeType,
      size: buffer.length,
      path: storedPath,
      kind: classifyAttachment(attachment.type || mimeType),
    };
  }

  const error = new Error('Attachment must include dataUrl or path');
  error.statusCode = 400;
  throw error;
}

async function materializeAttachments(rawAttachments) {
  const attachments = Array.isArray(rawAttachments) ? rawAttachments : [];
  if (!attachments.length) return [];

  if (attachments.length > MAX_ATTACHMENTS) {
    const error = new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`);
    error.statusCode = 400;
    throw error;
  }

  await ensureUploadDir();

  const normalized = [];
  for (const attachment of attachments) {
    normalized.push(await normalizeIncomingAttachment(attachment));
  }
  return normalized;
}

function buildHermesPrompt(message, attachments) {
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  if (!attachments.length) return trimmedMessage;

  const header = trimmedMessage || '첨부한 파일을 확인해줘.';
  const lines = attachments.map((attachment, index) => {
    const typeLabel = attachment.type || 'application/octet-stream';
    return `${index + 1}. ${attachment.name} | ${typeLabel} | ${attachment.size} bytes | path: ${attachment.path}`;
  });

  return [
    header,
    '',
    '[첨부 파일]',
    '이 파일들은 현재 로컬 컴퓨터에 업로드되어 있으며 같은 머신에서 접근 가능합니다.',
    '필요하면 파일 도구로 아래 절대경로를 직접 읽어 확인하세요.',
    ...lines,
  ].join('\n');
}

function startHermesChat({ message, sessionId, attachments, onEvent = null }) {
  let child = null;
  let finished = false;
  let interrupted = false;
  let timedOut = false;
  const startedAt = Date.now();

  const promise = new Promise((resolve, reject) => {
    const prompt = buildHermesPrompt(message, attachments);
    const args = ['chat', '-q', prompt, '-Q', '-v'];
    const imageAttachment = attachments.find((attachment) => attachment.kind === 'image');
    if (imageAttachment) {
      args.push('--image', imageAttachment.path);
    }
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    child = spawn('hermes', args, {
      env: {
        ...process.env,
        NO_COLOR: '1',
        TERM: process.env.TERM || 'xterm-256color',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lastProgressText = '';
    const sentProcessLines = new Set();

    const sendProcessText = (processText) => {
      if (!processText) return;
      const newLines = processText
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() && !sentProcessLines.has(line.trim()));

      for (const line of newLines) {
        sentProcessLines.add(line.trim());
      }

      if (newLines.length) {
        onEvent?.({ type: 'process', text: newLines.join('\n') });
      }
    };

    onEvent?.({ type: 'status', message: sessionId ? '이전 세션 이어서 Hermes 실행 시작' : 'Hermes 실행 시작' });

    const timer = setTimeout(() => {
      if (!finished) {
        timedOut = true;
        interruptChildProcess(child);
      }
    }, HERMES_TIMEOUT_MS);

    const heartbeat = setInterval(() => {
      if (finished || interrupted || timedOut) return;
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      onEvent?.({
        type: 'heartbeat',
        message: `Hermes 응답 대기 중... ${elapsedSeconds}초 경과`,
        elapsedSeconds,
      });
    }, 10_000);
    heartbeat.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      sendProcessText(extractStdoutProcessLog(stdout));
      const progressText = sanitizeHermesReply(stdout);
      if (progressText !== lastProgressText) {
        lastProgressText = progressText;
        onEvent?.({ type: 'progress', text: progressText });
      }
      onEvent?.({ type: 'status', message: 'Hermes 응답 생성 중...' });
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      const processText = formatProcessLog(stripAnsi(stderr));
      sendProcessText(processText);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      reject(error);
    });

    child.on('close', (code, signal) => {
      finished = true;
      clearTimeout(timer);
      clearInterval(heartbeat);

      if (timedOut || signal === 'SIGTERM') {
        const timeoutMinutes = Math.round(HERMES_TIMEOUT_MS / 60000);
        const error = new Error(`Hermes request timed out after ${timeoutMinutes} minutes`);
        error.statusCode = 504;
        return reject(error);
      }

      if (interrupted) {
        const error = new Error('이전 응답이 사용자 요청으로 중단되었습니다.');
        error.statusCode = 499;
        error.interrupted = true;
        return reject(error);
      }

      if (code !== 0) {
        const messageText = (stderr || stdout || `Hermes exited with code ${code}`).trim();
        const error = new Error(messageText);
        error.statusCode = 500;
        return reject(error);
      }

      const parsed = parseHermesOutput(stdout, stderr);
      if (!parsed.reply) {
        const error = new Error(parsed.raw || 'Hermes returned an empty response');
        error.statusCode = 502;
        return reject(error);
      }

      resolve(parsed);
    });
  });

  return {
    promise,
    cancel() {
      if (finished || interrupted || !child) return;
      interrupted = true;
      interruptChildProcess(child);
    },
  };
}

async function runHermesChat({ message, sessionId, attachments }) {
  const job = startHermesChat({ message, sessionId, attachments });
  return job.promise;
}

async function serveStaticFile(reqPath, res, method = 'GET') {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedRemote(req.socket.remoteAddress)) {
    sendJson(res, 403, { error: 'Same Wi-Fi/LAN access only' });
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      host: HOST,
      port: PORT,
      localOnly: !ALLOW_LAN,
      lanOnly: ALLOW_LAN,
      lanIPs: ALLOW_LAN ? LAN_IPV4S : [],
      requestTimeoutMs: HERMES_TIMEOUT_MS,
      uploads: {
        enabled: true,
        uploadDir: UPLOAD_DIR,
        maxAttachments: MAX_ATTACHMENTS,
        maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      },
      supportedCommands: SUPPORTED_WEB_COMMANDS,
      hermesCommand: 'hermes chat -q ... -Q [--resume <session_id>] [--image <path>]',
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readJsonBody(req);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : null;
      const attachments = await materializeAttachments(body.attachments);

      if (!message && !attachments.length) {
        sendJson(res, 400, { error: 'message or attachments is required' });
        return;
      }

      const result = await runHermesChat({ message, sessionId, attachments });
      sendJson(res, 200, {
        ok: true,
        sessionId: result.sessionId || sessionId,
        reply: result.reply,
        attachments,
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Unknown server error',
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/stream') {
    let handleAbort = null;

    try {
      const body = await readJsonBody(req);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : null;
      const attachments = await materializeAttachments(body.attachments);

      if (!message && !attachments.length) {
        sendJson(res, 400, { error: 'message or attachments is required' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });

      const job = startHermesChat({
        message,
        sessionId,
        attachments,
        onEvent(event) {
          sendNdjsonEvent(res, event);
        },
      });

      let connectionClosed = false;
      handleAbort = () => {
        if (connectionClosed) return;
        connectionClosed = true;
        job.cancel();
      };

      req.on('aborted', handleAbort);
      res.on('close', () => {
        if (!res.writableEnded) {
          handleAbort();
        }
      });

      try {
        const result = await job.promise;
        sendNdjsonEvent(res, {
          type: 'complete',
          sessionId: result.sessionId || sessionId,
          reply: result.reply,
          attachments,
        });
      } catch (error) {
        sendNdjsonEvent(res, {
          type: error.interrupted ? 'interrupted' : 'error',
          error: error.message || 'Unknown server error',
        });
      }

      res.end();
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error.statusCode || 500, {
          ok: false,
          error: error.message || 'Unknown server error',
        });
      } else if (!res.writableEnded) {
        sendNdjsonEvent(res, { type: 'error', error: error.message || 'Unknown server error' });
        res.end();
      }
    } finally {
      if (handleAbort) {
        req.off('aborted', handleAbort);
      }
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStaticFile(url.pathname, res, req.method);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  const urls = [`http://127.0.0.1:${PORT}`];
  if (ALLOW_LAN) {
    urls.push(...LAN_IPV4S.map((ip) => `http://${ip}:${PORT}`));
  }
  console.log(`Hermes Telegram Chat UI running at ${urls.join(' | ')}`);
});
