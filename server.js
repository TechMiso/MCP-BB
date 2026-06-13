import express from 'express'
import httpProxy from 'http-proxy'
import { spawn } from 'child_process'

const PORT = process.env.PORT || 8080
const INTERNAL_PORT = 3001
const MCP_SECRET = process.env.MCP_SECRET

// Lance supergateway en interne sur le port 3001
spawn('npx', [
  '-y', 'supergateway',
  '--port', String(INTERNAL_PORT),
  '--outputTransport', 'streamableHttp',
  '--stdio', 'npx -y @wanadev/pennylane-mcp'
], { env: process.env, stdio: 'inherit' })

// Proxy avec auth
const proxy = httpProxy.createProxyServer({ target: `http://localhost:${INTERNAL_PORT}` })
const app = express()

app.use((req, res, next) => {
  if (!MCP_SECRET) return next()
  const auth = req.headers['authorization'] || req.headers['x-api-key']
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : auth
  if (token !== MCP_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  next()
})

app.all('*', (req, res) => proxy.web(req, res))

// Délai pour laisser supergateway démarrer
setTimeout(() => {
  app.listen(PORT, () => console.log(`Auth proxy prêt sur ${PORT}`))
}, 4000)
