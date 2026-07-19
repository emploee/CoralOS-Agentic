import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  awardReason,
  decodePatchFile,
  hashDelivery,
  hashTask,
  rankBids,
  sha256,
  validateDelivery,
  type PatchDelivery,
  type PatchTask,
  type SolverBid,
  type VerificationProof,
} from '@patchbond/core'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const FIXTURE = join(ROOT, 'examples', 'patchbond', 'fixtures', 'discount-bug')
const ARTIFACTS = join(ROOT, '.artifacts', 'patchbond')
const patchedSource = `export function discountedTotal(price, quantity, discountPercent) {
  const subtotal = price * quantity
  return subtotal * (1 - discountPercent / 100)
}
`

const event = (verb: string, details: string): void =>
  console.log(`${new Date().toISOString()}  ${verb.padEnd(16)} ${details}`)

const runNodeTests = (cwd: string): Promise<{ code: number; output: string; durationMs: number }> =>
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
      resolve({ code: code ?? 1, output: output.slice(-8_000), durationMs: Date.now() - started })
    })
  })
async function main(): Promise<void> {
  const baseSource = await readFile(join(FIXTURE, 'src', 'pricing.js'))
  const task: PatchTask = {
    id: 'discount-calculation-001',
    title: 'Repair percentage discount calculation',
    description: 'The checkout subtracts a raw percentage instead of applying it to the subtotal.',
    language: 'javascript',
    baseCommit: sha256(baseSource),
    testCommand: 'node --test test/pricing.test.js',
    allowedPaths: ['src/pricing.js'],
    budgetSol: 0.02,
    deadlineSeconds: 180,
  }
  const bids: SolverBid[] = [
    { seller: 'fast-fix', priceSol: 0.018, etaSeconds: 45, reputation: 82, successRate: 86, specialization: 72 },
    { seller: 'budget-bot', priceSol: 0.005, etaSeconds: 150, reputation: 58, successRate: 61, specialization: 55 },
    { seller: 'reliable-patch', priceSol: 0.011, etaSeconds: 80, reputation: 96, successRate: 97, specialization: 98 },
  ]

  event('WANT', `task=${task.id} budget=${task.budgetSol} SOL deadline=${task.deadlineSeconds}s`)
  const ranked = rankBids(task, bids)
  for (const bid of ranked) event('BID', `${bid.seller} price=${bid.priceSol} SOL score=${bid.score} eta=${bid.etaSeconds}s`)
  const winner = ranked[0]
  if (!winner) throw new Error('no eligible bids')
  event('AWARD', awardReason(winner, ranked[1]))
  event('ESCROW_PLANNED', 'local proof run only; use npm run demo:patchbond:devnet for real settlement')

  const delivery: PatchDelivery = {
    schema: 'patchbond.delivery.v1',
    taskId: task.id,
    taskSha256: hashTask(task),
    seller: winner.seller,
    files: [{
      path: 'src/pricing.js',
      beforeSha256: sha256(baseSource),
      contentBase64: Buffer.from(patchedSource).toString('base64'),
    }],
    summary: 'Apply the percentage to the subtotal rather than subtracting the raw percentage.',
  }
  validateDelivery(delivery, task)
  event('DELIVERED', `seller=${winner.seller} artifact=${hashDelivery(delivery).slice(0, 16)}…`)

  const workdir = await mkdtemp(join(tmpdir(), 'patchbond-'))
  const started = Date.now()
  let result: Awaited<ReturnType<typeof runNodeTests>>
  try {
    await cp(FIXTURE, workdir, { recursive: true })
    for (const file of delivery.files) {
      const current = await readFile(join(workdir, file.path))
      if (sha256(current) !== file.beforeSha256) throw new Error(`base hash mismatch for ${file.path}`)
      const decoded = decodePatchFile(file, task)
      await mkdir(dirname(join(workdir, decoded.path)), { recursive: true })
      await writeFile(join(workdir, decoded.path), decoded.content)
    }
    result = await runNodeTests(workdir)
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
  const passMatch = result.output.match(/# pass (\d+)/)
  const failMatch = result.output.match(/# fail (\d+)/)
  const testsPassed = Number(passMatch?.[1] ?? (result.code === 0 ? 1 : 0))
  const testsFailed = Number(failMatch?.[1] ?? (result.code === 0 ? 0 : 1))
  const proof: VerificationProof = {
    schema: 'patchbond.proof.v1',
    taskId: task.id,
    taskSha256: hashTask(task),
    deliverySha256: hashDelivery(delivery),
    verifier: 'patchbond-verifier',
    verdict: result.code === 0 ? 'pass' : 'fail',
    testsPassed,
    testsFailed,
    durationMs: result.durationMs,
    reason: result.code === 0 ? 'allowlisted test command passed in an isolated temporary workspace' : 'test command failed',
  }
  event('VERIFIED', `verdict=${proof.verdict} tests=${testsPassed} passed/${testsFailed} failed duration=${result.durationMs}ms`)
  event(proof.verdict === 'pass' ? 'RELEASE_READY' : 'REFUND_READY', 'requires a real devnet escrow run; no transaction was fabricated')

  await mkdir(ARTIFACTS, { recursive: true })
  await Promise.all([
    writeFile(join(ARTIFACTS, 'task.json'), JSON.stringify(task, null, 2)),
    writeFile(join(ARTIFACTS, 'bids.json'), JSON.stringify(ranked, null, 2)),
    writeFile(join(ARTIFACTS, 'delivery.json'), JSON.stringify(delivery, null, 2)),
    writeFile(join(ARTIFACTS, 'proof.local.json'), JSON.stringify(proof, null, 2)),
    writeFile(join(ARTIFACTS, 'test-output.tap'), result.output),
  ])
  event('PROOF_WRITTEN', `.artifacts/patchbond/proof.local.json total=${Date.now() - started}ms`)
  console.log('\nLocal proof complete. It proves patch selection and verification, not on-chain settlement.')
}

main().catch((error: unknown) => {
  console.error(`PatchBond demo failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
