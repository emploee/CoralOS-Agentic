import { createHash } from 'node:crypto'
import { isAbsolute, normalize } from 'node:path'
import type { PatchDelivery, PatchFile, PatchTask } from './types.js'

export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

/** Stable enough for versioned JSON artifacts: object keys are recursively sorted. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export const hashTask = (task: PatchTask): string => sha256(canonicalJson(task))
export const hashDelivery = (delivery: PatchDelivery): string => sha256(canonicalJson(delivery))

export function safePatchPath(path: string): string {
  const normalized = normalize(path).replaceAll('\\', '/')
  if (!path || isAbsolute(path) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`unsafe patch path: ${path}`)
  }
  const segments = normalized.split('/')
  if (segments.includes('node_modules') || segments.includes('.git')) {
    throw new Error(`forbidden patch path: ${path}`)
  }
  return normalized
}

export function decodePatchFile(file: PatchFile, task: PatchTask): { path: string; content: Buffer } {
  const path = safePatchPath(file.path)
  if (!task.allowedPaths.includes(path)) throw new Error(`path is outside task allowlist: ${path}`)
  const content = Buffer.from(file.contentBase64, 'base64')
  if (content.length === 0 || content.length > 256_000) throw new Error(`invalid patch size for ${path}`)
  return { path, content }
}

export function validateDelivery(delivery: PatchDelivery, task: PatchTask): void {
  if (delivery.schema !== 'patchbond.delivery.v1') throw new Error('unsupported delivery schema')
  if (delivery.taskId !== task.id) throw new Error('delivery task id mismatch')
  if (delivery.taskSha256 !== hashTask(task)) throw new Error('delivery task hash mismatch')
  if (!delivery.seller.trim()) throw new Error('delivery seller missing')
  if (delivery.files.length === 0 || delivery.files.length > 12) throw new Error('invalid patch file count')
  const seen = new Set<string>()
  for (const file of delivery.files) {
    const decoded = decodePatchFile(file, task)
    if (seen.has(decoded.path)) throw new Error(`duplicate patch path: ${decoded.path}`)
    seen.add(decoded.path)
  }
}
