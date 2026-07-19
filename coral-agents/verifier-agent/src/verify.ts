import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  decodePatchFile,
  DISCOUNT_TASK,
  DISCOUNT_TEST_SOURCE,
  sha256,
  validateDelivery,
  type PatchDelivery,
} from '@patchbond/core'
import { sha256Hex, type VerifyRequest, type Verdict } from '@pay/agent-runtime'

const runTests = (cwd: string): Promise<{ ok: boolean; passed: number; failed: number; durationMs: number }> =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(process.execPath, ['--test', 'test/pricing.test.js'], {
      cwd,
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    const timer = setTimeout(() => child.kill(), 10_000)
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      const passed = Number(output.match(/# pass (\d+)/)?.[1] ?? (code === 0 ? 1 : 0))
      const failed = Number(output.match(/# fail (\d+)/)?.[1] ?? (code === 0 ? 0 : 1))
      resolve({ ok: code === 0, passed, failed, durationMs: Date.now() - started })
    })
  })

async function verifyPatchBond(req: VerifyRequest, name: string): Promise<Verdict> {
  let delivery: PatchDelivery
  try {
    delivery = JSON.parse(req.payload) as PatchDelivery
    validateDelivery(delivery, DISCOUNT_TASK)
  } catch (error) {
    return { round: req.round, by: name, sha: sha256Hex(req.payload), verdict: 'fail', reason: `invalid artifact: ${(error as Error).message}` }
  }
  const workdir = await mkdtemp(join(tmpdir(), 'patchbond-verifier-'))
  try {
    await writeFile(join(workdir, 'package.json'), JSON.stringify({ type: 'module', private: true }))
    await mkdir(join(workdir, 'src'), { recursive: true })
    await mkdir(join(workdir, 'test'), { recursive: true })
    await writeFile(join(workdir, 'test', 'pricing.test.js'), DISCOUNT_TEST_SOURCE)
    for (const file of delivery.files) {
      const decoded = decodePatchFile(file, DISCOUNT_TASK)
      await mkdir(dirname(join(workdir, decoded.path)), { recursive: true })
      await writeFile(join(workdir, decoded.path), decoded.content)
    }
    const result = await runTests(workdir)
    return {
      round: req.round,
      by: name,
      sha: sha256(req.payload),
      verdict: result.ok ? 'pass' : 'fail',
      reason: `${result.passed} passed, ${result.failed} failed in ${result.durationMs}ms`,
    }
  } catch (error) {
    return { round: req.round, by: name, sha: sha256Hex(req.payload), verdict: 'fail', reason: `verification error: ${(error as Error).message}` }
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
}

/** Deterministic delivery gate. PatchBond executes allowlisted tests; legacy services retain hash checks. */
export async function checkDelivery(req: VerifyRequest, name: string): Promise<Verdict> {
  const actualSha = sha256Hex(req.payload)
  if (actualSha !== req.sha) {
    return { round: req.round, by: name, sha: actualSha, verdict: 'fail', reason: 'content hash mismatch' }
  }
  if (req.service === 'patchbond') return verifyPatchBond(req, name)

  let data: unknown
  try {
    data = JSON.parse(req.payload)
  } catch {
    return { round: req.round, by: name, sha: actualSha, verdict: 'fail', reason: 'payload is not JSON' }
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    return { round: req.round, by: name, sha: actualSha, verdict: 'fail', reason: 'payload reports an error' }
  }
  return { round: req.round, by: name, sha: actualSha, verdict: 'pass', reason: 'hash + structure verified' }
}
