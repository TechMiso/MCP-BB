// server.js — Auth proxy + supergateway
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || 3000);
const INTERNAL_PORT = PORT + 1;
const MCP_SECRET = process.env.MCP_SECRET; // ton Bearer token

const app = express();

// 1. Health check (sans auth)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 2. Auth middleware
app.use((req, res, next) => {
  if (!MCP_SECRET) return next(); // pas de secret configuré = pas d'auth
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${MCP_SECRET}`) {
    console.log(`[Auth] ❌ Unauthorized — ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// 3. Proxy vers supergateway interne
app.use('/', createProxyMiddleware({
  target: `http://localhost:${INTERNAL_PORT}`,
  changeOrigin: true,
  on: {
    error: (err, req, res) => {
      console.error('[Proxy] Erreur:', err.message);
      res.status(503).json({ error: 'MCP server unavailable' });
    }
  }
}));

app.listen(PORT, () => {
  console.log(`[Auth proxy] ✅ Écoute sur port ${PORT}`);
});

// 4. Démarrage supergateway sur port INTERNE
function startSupergateway() {
  console.log(`[Supergateway] Démarrage sur port interne ${INTERNAL_PORT}...`);
  const proc = spawn(
    'npx',
    ['-y', 'supergateway',
     '--port', String(INTERNAL_PORT),
     '--outputTransport', 'streamableHttp',
     '--stdio', './node_modules/.bin/pennylane-mcp'],
    { stdio: 'inherit', env: process.env }
  );

  proc.on('close', (code) => {
    console.log(`[Supergateway] ⚠️ Terminé (code ${code}) — redémarrage dans 5s`);
    setTimeout(startSupergateway, 5000);
  });
}

startSupergateway();
