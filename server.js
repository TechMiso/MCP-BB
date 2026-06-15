// server.js — Auto-restart supervisor pour pennylane-mcp
const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 3000;
const BEARER_TOKEN = process.env.PENNYLANE_BEARER_TOKEN;
const HEALTH_CHECK_INTERVAL = 30 * 1000; // vérif toutes les 30s
const STARTUP_GRACE        = 20 * 1000; // attente avant 1ère vérif
const RESTART_DELAY        =  5 * 1000; // pause avant redémarrage

let proc       = null;
let restarting = false;

function ts() {
  return new Date().toISOString();
}

// ── Démarre supergateway + pennylane-mcp ──────────────────────────────────────
function startProcess() {
  restarting = false;
  console.log(`[${ts()}] Démarrage supergateway + pennylane-mcp (port ${PORT})...`);

  proc = spawn(
    'npx',
    ['-y', 'supergateway',
     '--port', String(PORT),
     '--outputTransport', 'streamableHttp',
     '--stdio', 'npx -y @wanadev/pennylane-mcp'],
    { stdio: 'inherit', env: process.env }
  );

  proc.on('spawn', () => console.log(`[${ts()}] ✓ Processus démarré`));
  proc.on('error', (err) => console.error(`[${ts()}] Erreur spawn: ${err.message}`));
  proc.on('exit', (code, signal) => {
    console.warn(`[${ts()}] Processus terminé (code=${code} signal=${signal}) — redémarrage dans ${RESTART_DELAY / 1000}s`);
    proc = null;
    scheduleRestart();
  });
}

// ── Planifie un redémarrage ───────────────────────────────────────────────────
function scheduleRestart() {
  if (restarting) return;
  restarting = true;
  setTimeout(startProcess, RESTART_DELAY);
}

// ── Health check interne (tools/list) ────────────────────────────────────────
function healthCheck() {
  return new Promise((resolve) => {
    if (!proc) return resolve(false);

    const body    = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (BEARER_TOKEN) headers['Authorization'] = `Bearer ${BEARER_TOKEN}`;

    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers, timeout: 10000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            resolve(!!(json.result?.tools?.length > 0));
          } catch { resolve(false); }
        });
      }
    );
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

// ── Surveillance périodique ───────────────────────────────────────────────────
async function watchHealth() {
  await new Promise((r) => setTimeout(r, STARTUP_GRACE)); // laisse le temps de démarrer

  while (true) {
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL));
    if (restarting || !proc) continue;

    const ok = await healthCheck();
    if (ok) {
      console.log(`[${ts()}] ✓ Health check OK`);
    } else {
      console.error(`[${ts()}] ✗ Health check échoué — redémarrage...`);
      proc?.kill('SIGTERM');
      proc = null;
      scheduleRestart();
      await new Promise((r) => setTimeout(r, RESTART_DELAY + 5000));
    }
  }
}

startProcess();
watchHealth().catch((err) => console.error(`[${ts()}] Watcher crashé: ${err.message}`));
