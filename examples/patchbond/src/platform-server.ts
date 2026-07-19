import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectGitHubRepository } from '@patchbond/core'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..')
const WEB_ROOT = join(PACKAGE_ROOT, 'web')
const INTER_ROOT = join(REPO_ROOT, 'node_modules', '@fontsource', 'inter', 'files')
const GSAP_ROOT = join(REPO_ROOT, 'node_modules', 'gsap', 'dist')
const PORT = Number(process.env.PATCHBOND_PORT ?? '4173')
const MAX_BODY_BYTES = 16_384

const files: Record<string, { name: string; type: string; root?: string }> = {
  '/': { name: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { name: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { name: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/effects.js': { name: 'effects.js', type: 'text/javascript; charset=utf-8' },
  '/vendor/gsap.min.js': { name: 'gsap.min.js', type: 'text/javascript; charset=utf-8', root: GSAP_ROOT },
  '/styles.css': { name: 'styles.css', type: 'text/css; charset=utf-8' },
  '/fonts/inter-latin-400.woff2': { name: 'inter-latin-400-normal.woff2', type: 'font/woff2', root: INTER_ROOT },
  '/fonts/inter-latin-500.woff2': { name: 'inter-latin-500-normal.woff2', type: 'font/woff2', root: INTER_ROOT },
  '/fonts/inter-cyrillic-400.woff2': { name: 'inter-cyrillic-400-normal.woff2', type: 'font/woff2', root: INTER_ROOT },
  '/fonts/inter-cyrillic-500.woff2': { name: 'inter-cyrillic-500-normal.woff2', type: 'font/woff2', root: INTER_ROOT },
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const data = Buffer.from(chunk)
    size += data.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(data)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('request body must be valid JSON')
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const asset = files[pathname]
  if (!asset) return false
  const content = await readFile(join(asset.root ?? WEB_ROOT, asset.name))
  res.writeHead(200, {
    'content-type': asset.type,
    'cache-control': pathname === '/' ? 'no-store' : 'public, max-age=300',
    'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  })
  res.end(content)
  return true
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, { ok: true, network: 'devnet', service: 'patchbond-platform' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/proof') {
      try {
        const proof = JSON.parse(await readFile(join(REPO_ROOT, '.artifacts', 'patchbond', 'proof.local.json'), 'utf8'))
        json(res, 200, { mode: 'local', proof })
      } catch {
        json(res, 404, { error: 'Run npm run demo:patchbond to generate local proof' })
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/repositories/connect') {
      const payload = await body(req)
      if (typeof payload.repository !== 'string') throw new Error('repository is required')
      const repository = await inspectGitHubRepository(payload.repository, {
        token: process.env.GITHUB_TOKEN || undefined,
      })
      if (repository.isArchived) throw new Error('Archived repositories cannot accept repair patches')
      json(res, 200, {
        repository,
        access: process.env.GITHUB_TOKEN ? 'configured' : 'public-read-only',
        next: 'Select a failing check or issue, pin the base commit, then open an agent auction.',
      })
      return
    }
    if (req.method === 'GET' && await serveStatic(url.pathname, res)) return
    json(res, 404, { error: 'Not found' })
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : 'Request failed' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PatchBond platform: http://127.0.0.1:${PORT}`)
  console.log('Public repositories work without a token; private access uses local GITHUB_TOKEN.')
})
