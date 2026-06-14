const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { exec } = require('child_process');
const net = require('net');

const PORT = parseInt(process.env.PORT || '3000');
const INTERNAL_PORT = 3001;
const MCP_SECRET = process.env.MCP_SECRET;

// 1. Démarre supergateway sur port interne
const sg = exec(
  `npx -y supergateway --port ${INTERNAL_PORT} --outputTransport streamableHttp --stdio "npx -y @wanadev/pennylane-mcp"`,
  { env: { ...process.env } }
);
sg.stdout?.pipe(process.stdout);
sg.stderr?.pipe(process.stderr);
sg.on('exit', (code) => console.error(`supergateway exited: ${code}`));

// 2. Attend que supergateway soit prêt
function waitForPort(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = net.createConnection(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`Port ${port} not ready`));
        else setTimeout(attempt, 500);
      });
    }
    attempt();
  });
}

// 3. Middleware auth
function authMiddleware(req, res, next) {
  if (!MCP_SECRET) return next(); // pas de secret = mode dev ouvert
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${MCP_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// 4. Démarre Express une fois supergateway prêt
waitForPort(INTERNAL_PORT)
  .then(() => {
    console.log(`✅ supergateway prêt sur port ${INTERNAL_PORT}`);
    const app = express();
    app.use(authMiddleware);
    app.use('/', createProxyMiddleware({
      target: `http://127.0.0.1:${INTERNAL_PORT}`,
      changeOrigin: false,
      ws: true,
      onError: (err, req, res) => {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) res.status(502).send('Bad Gateway');
      }
    }));
    app.listen(PORT, () => {
      console.log(`🔒 MCP proxy sécurisé sur port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erreur démarrage:', err.message);
    process.exit(1);
  });
