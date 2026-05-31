import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY || 20);
const ROUNDS = Number(process.env.STRESS_ROUNDS || 3);
const TIMEOUT_MS = Number(process.env.STRESS_TIMEOUT_MS || 30000);

function readApiUrlFromConfig() {
  try {
    const configPath = join(__dirname, '..', 'config.js');
    const text = readFileSync(configPath, 'utf8');
    const match = text.match(/EMD_GAS_API_URL\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1].replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

const API_URL = (process.env.EMD_GAS_API_URL || readApiUrlFromConfig()).replace(/\/$/, '');

function buildGetAppDataUrl() {
  const qs = new URLSearchParams({
    action: 'getAppData',
    args: JSON.stringify([false]),
    token: ''
  });
  return API_URL + '?' + qs.toString();
}

async function fetchOnce(url, signal) {
  const started = Date.now();
  const res = await fetch(url, { method: 'GET', redirect: 'follow', signal });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) {
    throw new Error('HTTP ' + res.status + ' in ' + ms + 'ms');
  }
  const trimmed = text.trim();
  if (trimmed.charAt(0) === '<') {
    throw new Error('HTML response in ' + ms + 'ms');
  }
  const data = JSON.parse(trimmed);
  if (!data || !Array.isArray(data.vehicles)) {
    throw new Error('Invalid payload in ' + ms + 'ms');
  }
  return ms;
}

async function runStressRound(roundIndex) {
  const url = buildGetAppDataUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const tasks = Array.from({ length: CONCURRENCY }, (_, i) =>
    fetchOnce(url, controller.signal).then(
      (ms) => ({ ok: true, ms, i }),
      (err) => ({ ok: false, err: String(err.message || err), i })
    )
  );
  const results = await Promise.all(tasks);
  clearTimeout(timer);
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const max = times[times.length - 1] || 0;
  console.log(
    'Round ' + (roundIndex + 1) + '/' + ROUNDS +
    ' | ok=' + ok.length + '/' + CONCURRENCY +
    ' | p50=' + p50 + 'ms p95=' + p95 + 'ms max=' + max + 'ms'
  );
  if (fail.length) {
    console.log('Failures:', fail.slice(0, 5).map((f) => '#' + f.i + ': ' + f.err).join('; '));
  }
  return { ok: ok.length, fail: fail.length, p50, p95, max };
}

async function main() {
  if (!API_URL) {
    console.error('No API URL: set EMD_GAS_API_URL or config.js EMD_GAS_API_URL');
    process.exit(1);
  }
  console.log('Stress test getAppData');
  console.log('URL:', API_URL);
  console.log('Concurrency:', CONCURRENCY, '| Rounds:', ROUNDS);

  let totalOk = 0;
  let totalFail = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const summary = await runStressRound(r);
    totalOk += summary.ok;
    totalFail += summary.fail;
    if (r < ROUNDS - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const total = totalOk + totalFail;
  console.log('Done:', totalOk + '/' + total + ' succeeded');
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
