import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Autonomous dev agent (backend repo only).
 *
 * prompt → git worktree off origin/main → `claude -p` edits code → gate (tests + syntax check)
 *        → commit → push (main = deploys via Render, or a branch) → cleanup.
 *
 * Jobs live in memory (lost on restart) and run one at a time.
 *
 * Env:
 *   DEV_AGENT_ENABLED   must be "true", otherwise every route except /status returns 503
 *   DEV_DEPLOY          main (default) | branch | off   — what happens after the gate passes
 *   DEV_BASE_BRANCH     branch to start from / push to (default main)
 *   DEV_WORK_DIR        where worktrees go (default <tmp>/chai-dev-jobs)
 *   DEV_JOB_TIMEOUT_MIN agent time limit in minutes (default 15)
 *   DEV_MAX_BUDGET_USD  agent spend limit per job in USD (default 2)
 *   DEV_AGENT_ENV_PREFIXES  env-var prefixes forwarded to claude (default ANTHROPIC_,CLAUDE_CODE_OAUTH_)
 *   CLAUDE_BIN          claude executable (default "claude")
 */

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JOBS = 50;
const MAX_LOG_LINES = 500;
const MAX_OUTPUT_BYTES = 200_000;

const cfg = () => ({
  enabled: process.env.DEV_AGENT_ENABLED === 'true',
  deploy: ['main', 'branch', 'off'].includes(process.env.DEV_DEPLOY) ? process.env.DEV_DEPLOY : 'main',
  base: process.env.DEV_BASE_BRANCH || 'main',
  workDir: process.env.DEV_WORK_DIR || path.join(os.tmpdir(), 'chai-dev-jobs'),
  timeoutMs: (Number(process.env.DEV_JOB_TIMEOUT_MIN) || 15) * 60_000,
  maxBudget: Number(process.env.DEV_MAX_BUDGET_USD) || 2,
  claude: process.env.CLAUDE_BIN || 'claude',
});

export const devAgentEnabled = () => cfg().enabled;
export const devDeployMode = () => cfg().deploy;

const jobs = new Map(); // id → job (insertion order = creation order)
const queue = [];
let running = null;
let io = null;

export function initDevAgent(socketServer) {
  io = socketServer;
}

// ── Public job shape / events ──────────────────────────────────────────────
const publicJob = (j, withLogs = true) => ({
  id: j.id,
  prompt: j.prompt,
  status: j.status,
  createdAt: j.createdAt,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
  branch: j.branch,
  commit: j.commit,
  deployed: j.deployed,
  changedFiles: j.changedFiles,
  error: j.error,
  summary: j.summary,
  ...(withLogs ? { logs: j.logs } : {}),
});

const emitJob = (j) => io?.to('dev').emit('dev:job', publicJob(j, false));

function log(j, line) {
  const text = String(line).trimEnd();
  if (!text) return;
  j.logs.push(text);
  if (j.logs.length > MAX_LOG_LINES) j.logs.shift();
  io?.to('dev').emit('dev:log', { id: j.id, line: text });
}

function setStatus(j, status) {
  j.status = status;
  emitJob(j);
}

export const listJobs = () => [...jobs.values()].reverse().map((j) => publicJob(j, false));
export const getJob = (id) => (jobs.has(id) ? publicJob(jobs.get(id)) : null);

export function createJob(prompt) {
  const j = {
    id: crypto.randomBytes(4).toString('hex'),
    prompt,
    status: 'queued',
    createdAt: new Date().toISOString(),
    logs: [],
    changedFiles: [],
    deployed: false,
    child: null,
    cancelled: false,
  };
  jobs.set(j.id, j);
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
  queue.push(j);
  emitJob(j);
  pump();
  return publicJob(j);
}

export function cancelJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  if (['done', 'failed', 'cancelled'].includes(j.status)) return publicJob(j);
  j.cancelled = true;
  if (j.status === 'queued') {
    queue.splice(queue.indexOf(j), 1);
    j.finishedAt = new Date().toISOString();
    setStatus(j, 'cancelled');
  } else {
    j.child?.kill('SIGTERM');
  }
  return publicJob(j);
}

// ── Queue ──────────────────────────────────────────────────────────────────
function pump() {
  if (running || !queue.length) return;
  running = queue.shift();
  const j = running;
  runJob(j)
    .catch((err) => {
      j.error = err.message || String(err);
      j.status = j.cancelled ? 'cancelled' : 'failed';
    })
    .finally(async () => {
      j.finishedAt = new Date().toISOString();
      await cleanup(j).catch(() => {});
      log(j, j.status === 'done' ? '✅ Finished' : `❌ ${j.error || j.status}`);
      emitJob(j);
      running = null;
      pump();
    });
}

// ── Process helper ─────────────────────────────────────────────────────────
/** Run a command, stream stdout lines to onLine, resolve with { code, output }. Never rejects on non-zero exit. */
function run(j, cmd, args, { cwd, env = process.env, onLine, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    j.child = child;
    let output = '';
    let buf = '';
    const feed = (chunk) => {
      const s = chunk.toString();
      if (output.length < MAX_OUTPUT_BYTES) output += s;
      if (!onLine) return;
      buf += s;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(onLine);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const timer = timeoutMs
      ? setTimeout(() => {
          j.timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : null;
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf && onLine) onLine(buf);
      j.child = null;
      resolve({ code, output });
    });
  });
}

// Pushes authenticate through this credential helper (default: the host's `gh` login).
// Set DEV_GIT_CREDENTIAL_HELPER to another helper, or to "none" to use git's own configuration.
const pushAuth = () => {
  const h = process.env.DEV_GIT_CREDENTIAL_HELPER ?? '!gh auth git-credential';
  return h === 'none' ? [] : ['-c', 'credential.helper=', '-c', `credential.helper=${h}`];
};

const git = (j, args, opts = {}) => run(j, 'git', args, { cwd: opts.cwd ?? j.repo, ...opts });

async function mustGit(j, args, opts) {
  const r = await git(j, args, opts);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.output.trim().split('\n').slice(-6).join(' | ')}`);
  return r.output.trim();
}

const stop = (j) => {
  if (j.cancelled) throw new Error('Cancelled');
};

// ── Agent output → readable log lines ──────────────────────────────────────
function describeToolUse(block) {
  const i = block.input || {};
  const target = i.file_path || i.path || i.pattern || i.command || '';
  return `🔧 ${block.name}${target ? ` ${String(target).replace(/\s+/g, ' ').slice(0, 120)}` : ''}`;
}

function handleAgentLine(j, raw) {
  const line = raw.trim();
  if (!line) return;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return log(j, line.slice(0, 300));
  }
  if (ev.type === 'assistant') {
    for (const b of ev.message?.content ?? []) {
      if (b.type === 'text' && b.text?.trim()) log(j, `💬 ${b.text.trim().slice(0, 400)}`);
      else if (b.type === 'tool_use') log(j, describeToolUse(b));
    }
  } else if (ev.type === 'result') {
    if (ev.result) j.summary = String(ev.result).slice(0, 2000);
    if (ev.is_error) j.agentError = true;
  }
}

const SYSTEM_RULES = [
  'You are modifying the Chai Time backend (Node + Express + Mongoose) in the current directory only.',
  'Make the smallest change that fulfils the request and match the existing code style.',
  'Never read, create or edit .env files, credentials, or anything under node_modules.',
  'Do not run git commands or install packages; the pipeline commits and deploys for you.',
  'Run `npm test` before finishing. If the request cannot be done safely in the backend, change nothing and explain why.',
].join(' ');

// ── The pipeline ───────────────────────────────────────────────────────────
async function runJob(j) {
  const c = cfg();
  j.startedAt = new Date().toISOString();
  setStatus(j, 'running');

  j.repo = (await mustGit({ ...j, repo: BACKEND_DIR }, ['rev-parse', '--show-toplevel'], { cwd: BACKEND_DIR })).trim();
  j.branch = `dev/${j.id}`;
  j.worktree = path.join(c.workDir, j.id);
  fs.mkdirSync(c.workDir, { recursive: true });

  log(j, `📥 Fetching origin/${c.base}`);
  await mustGit(j, [...pushAuth(), 'fetch', 'origin', c.base]);
  await mustGit(j, ['worktree', 'add', '-b', j.branch, j.worktree, `origin/${c.base}`]);
  stop(j);

  // The repo root may be the backend itself or a parent of it
  const appDir = path.join(j.worktree, path.relative(j.repo, BACKEND_DIR));
  if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
    log(j, '📦 npm ci');
    const r = await run(j, 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: appDir });
    if (r.code !== 0) throw new Error('npm ci failed');
  }
  stop(j);

  // Agent environment: no server secrets (DB URI etc.). Only auth vars for claude are passed through;
  // DEV_AGENT_ENV_PREFIXES (comma list) overrides which variable-name prefixes are forwarded.
  const prefixes = (process.env.DEV_AGENT_ENV_PREFIXES || 'ANTHROPIC_,CLAUDE_CODE_OAUTH_')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER, // macOS keychain lookup of the claude login needs these
    LOGNAME: process.env.LOGNAME,
    SHELL: process.env.SHELL,
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => prefixes.some((p) => k.startsWith(p)))),
  };

  log(j, '🤖 Agent started');
  const agent = await run(
    j,
    c.claude,
    [
      '-p',
      j.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--max-budget-usd',
      String(c.maxBudget),
      '--allowedTools',
      'Read,Glob,Grep,Edit,Write,Bash(npm test:*),Bash(node --check:*)',
      '--disallowedTools',
      'Read(**/.env*),Edit(**/.env*),Write(**/.env*),Read(**/node_modules/**),Edit(**/node_modules/**)',
      '--append-system-prompt',
      SYSTEM_RULES,
    ],
    { cwd: appDir, env, timeoutMs: c.timeoutMs, onLine: (l) => handleAgentLine(j, l) }
  );
  stop(j);
  if (j.timedOut) throw new Error(`Agent timed out after ${c.timeoutMs / 60_000} min`);
  if (agent.code !== 0 || j.agentError) throw new Error('Agent did not complete successfully');

  // What changed?
  await mustGit(j, ['add', '-A'], { cwd: j.worktree });
  const changed = (await mustGit(j, ['diff', '--cached', '--name-only'], { cwd: j.worktree }))
    .split('\n')
    .filter(Boolean);
  j.changedFiles = changed;
  if (!changed.length) {
    j.summary ||= 'The agent made no changes.';
    return setStatus(j, 'done');
  }
  log(j, `📝 Changed: ${changed.join(', ')}`);

  // Gate 1: forbidden paths
  const forbidden = changed.filter((f) => /(^|\/)\.env/.test(f) || f.includes('node_modules/') || /credentials/i.test(f));
  if (forbidden.length) throw new Error(`Refusing to deploy changes to protected files: ${forbidden.join(', ')}`);

  // Gate 2: syntax check, Gate 3: tests (tests use console.assert, which never sets a non-zero exit code)
  setStatus(j, 'testing');
  for (const f of changed.filter((f) => /\.(m?js|cjs)$/.test(f) && fs.existsSync(path.join(j.worktree, f)))) {
    const r = await run(j, 'node', ['--check', path.join(j.worktree, f)], { cwd: appDir });
    if (r.code !== 0) throw new Error(`Syntax error in ${f}: ${r.output.trim().split('\n')[0]}`);
  }
  log(j, '🧪 npm test');
  const t = await run(j, 'npm', ['test'], { cwd: appDir, env, timeoutMs: 120_000 });
  stop(j);
  if (t.code !== 0 || /Assertion failed|❌ FAIL/.test(t.output)) {
    throw new Error(`Tests failed: ${t.output.trim().split('\n').slice(-3).join(' | ')}`);
  }
  log(j, '✔ Checks passed');

  // Commit
  const msg = `dev-agent: ${j.prompt.split('\n')[0].slice(0, 70)}`;
  await mustGit(
    j,
    ['-c', 'user.name=Chai Dev Agent', '-c', 'user.email=dev-agent@users.noreply.github.com', 'commit', '-m', msg],
    { cwd: j.worktree }
  );
  j.commit = (await mustGit(j, ['rev-parse', '--short', 'HEAD'], { cwd: j.worktree })).trim();

  // Deploy
  if (c.deploy === 'off') {
    log(j, '⏸ DEV_DEPLOY=off — committed locally only');
    return setStatus(j, 'done');
  }
  setStatus(j, 'deploying');
  if (c.deploy === 'main') {
    log(j, `🚀 Pushing to origin/${c.base} (Render deploys from here)`);
    const p = await git(j, [...pushAuth(), 'push', 'origin', `HEAD:${c.base}`], { cwd: j.worktree });
    if (p.code === 0) {
      j.deployed = true;
      return setStatus(j, 'done');
    }
    log(j, `⚠ Push to ${c.base} rejected; pushing branch ${j.branch} instead`);
  }
  await mustGit(j, [...pushAuth(), 'push', 'origin', `HEAD:refs/heads/${j.branch}`], { cwd: j.worktree });
  log(j, `Pushed branch ${j.branch} — merge it to deploy`);
  setStatus(j, 'done');
}

async function cleanup(j) {
  if (!j.repo || !j.worktree) return;
  await git(j, ['worktree', 'remove', '--force', j.worktree]);
  await git(j, ['branch', '-D', j.branch]);
}
