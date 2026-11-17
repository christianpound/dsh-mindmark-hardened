// dsh-mindmark — long-term lessons distilled from annotations.
//
// Lessons live in the user's global instruction file `$DSH_HOME/AGENTS.md`,
// inside one managed block, so the official agent-instructions plugin feeds
// them to every new session without any extra wiring:
//
//   <!-- dsh-mindmark-hardened:start -->
//   ## 用户通过标注沉淀的偏好（dsh-mindmark-hardened）
//   - [2026-11-16] 解释概念时先给一个具体例子，再讲原理。
//   <!-- dsh-mindmark-hardened:end -->
//
// Everything outside the block is preserved byte for byte. Writes are atomic.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BLOCK_START = '<!-- dsh-mindmark-hardened:start -->'
export const BLOCK_END = '<!-- dsh-mindmark-hardened:end -->'
export const BLOCK_TITLE = '## 用户通过标注沉淀的偏好（dsh-mindmark-hardened）'
export const BLOCK_INTRO = '以下是用户在批改助手回答时反复表现出的偏好，请在所有对话中遵守；与当前对话的明确指示冲突时以当前指示为准。'
export const MAX_LESSONS = 40
export const MAX_LESSON_LENGTH = 300
export const MAX_BLOCK_BYTES = 8000

/** Resolve `$DSH_HOME/AGENTS.md` (or `~/.dsh/AGENTS.md`). */
export function resolveInstructionsPath(env = process.env) {
  const home =
    typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
      ? env.DSH_HOME
      : path.join(os.homedir(), '.dsh')
  return path.join(home, 'AGENTS.md')
}

function today() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Collapse whitespace and clip one lesson line; '' when unusable. */
export function normalizeLesson(text) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/<!--/g, '‹!--').replace(/-->/g, '--›').replace(/\s+/g, ' ').trim().replace(/^[-*•]\s*/, '').replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '')
  return flat.length > MAX_LESSON_LENGTH ? `${flat.slice(0, MAX_LESSON_LENGTH - 1)}…` : flat
}

/** Parse the managed block of a file body into `{ before, lessons, after }`. */
export function parseInstructions(body) {
  const text = typeof body === 'string' ? body : ''
  const start = text.indexOf(BLOCK_START)
  const end = start < 0 ? -1 : text.indexOf(BLOCK_END, start)
  const starts = text.split(BLOCK_START).length - 1
  const ends = text.split(BLOCK_END).length - 1
  if (starts !== ends || starts > 1 || (starts === 1 && end < start)) {
    throw new Error('Ambiguous or incomplete dsh-mindmark lesson markers; refusing to rewrite instructions.')
  }
  if (start < 0) return { before: text, lessons: [], after: '' }
  const inner = text.slice(start + BLOCK_START.length, end)
  const lessons = []
  for (const line of inner.split('\n')) {
    const m = /^\s*-\s*(?:\[(\d{4}-\d{2}-\d{2})\]\s*)?(.+?)\s*$/.exec(line)
    if (!m) continue
    const lesson = normalizeLesson(m[2])
    if (lesson !== '') lessons.push({ date: m[1] ?? '', text: lesson })
  }
  return { before: text.slice(0, start), lessons, after: text.slice(end + BLOCK_END.length), hasBlock: true }
}

/** Render the managed block for a lesson list ('' when empty). */
export function renderBlock(lessons) {
  if (!Array.isArray(lessons) || lessons.length === 0) return ''
  const lines = [BLOCK_START, BLOCK_TITLE, '', BLOCK_INTRO, '']
  for (const lesson of lessons) {
    const text = normalizeLesson(lesson.text)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(lesson.date) ? lesson.date : ''
    if (text) lines.push(`- ${date ? `[${date}] ` : ''}${text}`)
  }
  lines.push(BLOCK_END)
  return lines.join('\n')
}

/** Re-assemble a file body with a new lesson list. */
export function composeInstructions(parsed, lessons) {
  const block = renderBlock(lessons)
  if (parsed.hasBlock) return parsed.before + block + parsed.after
  // Appending our first block must not trim or rewrite upstream/user bytes.
  if (block === '') return parsed.before + parsed.after
  const separator = parsed.before === '' || parsed.before.endsWith('\n\n') ? '' : parsed.before.endsWith('\n') ? '\n' : '\n\n'
  return parsed.before + separator + block + '\n' + parsed.after
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function writeAtomic(filePath, text) {
  ensureDirectory(filePath)
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.renameSync(temp, filePath)
  } finally {
    // Never fall back to truncating the user's instructions after rename fails.
    try { fs.rmSync(temp, { force: true }) } catch { /* Best-effort temp cleanup. */ }
  }
}

/** Read/write the managed lesson block of one instruction file. */
export class LessonStore {
  constructor(filePath, { logger } = {}) {
    this.filePath = filePath ?? resolveInstructionsPath()
    this.logger = logger
  }

  read() {
    let body = ''
    try {
      body = fs.readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger?.warn?.(`dsh-mindmark-hardened: cannot read ${this.filePath}: ${String(error)}`)
        throw error
      }
    }
    return parseInstructions(body)
  }

  /** Current lessons, oldest first. */
  list() {
    return this.read().lessons.map(lesson => ({ ...lesson }))
  }

  save(parsed, lessons) {
    const kept = lessons
    // Approval for additions does not authorize deleting existing preferences.
    if (kept.length > MAX_LESSONS || Buffer.byteLength(renderBlock(kept)) > MAX_BLOCK_BYTES) {
      const error = new Error('Lesson budget exceeded; explicitly remove preferences before adding more.')
      error.code = 'lesson-budget-exceeded'
      throw error
    }
    if (kept.length === 0 && parsed.lessons.length === 0 && !fs.existsSync(this.filePath)) return kept
    writeAtomic(this.filePath, composeInstructions(parsed, kept))
    return kept
  }

  /**
   * Append lessons (deduplicated, case-insensitive). Returns
   * `{ added: string[], skipped: string[], lessons }`.
   */
  add(texts) {
    const parsed = this.read()
    const existing = new Set(parsed.lessons.map(lesson => lesson.text.toLowerCase()))
    const added = []
    const skipped = []
    const next = [...parsed.lessons]
    for (const raw of Array.isArray(texts) ? texts : [texts]) {
      const text = normalizeLesson(raw)
      if (text === '') continue
      if (existing.has(text.toLowerCase())) {
        skipped.push(text)
        continue
      }
      existing.add(text.toLowerCase())
      next.push({ date: today(), text })
      added.push(text)
    }
    const lessons = added.length === 0 ? parsed.lessons : this.save(parsed, next)
    return { added, skipped, lessons: lessons.map(lesson => ({ ...lesson })) }
  }

  /** Remove only literal confirmed texts from the current file, never indices. */
  removeExact(targets) {
    const parsed = this.read()
    const wanted = new Set((Array.isArray(targets) ? targets : [targets]).filter(target => typeof target === 'string'))
    const removed = parsed.lessons.filter(lesson => wanted.has(lesson.text)).map(lesson => lesson.text)
    if (removed.length === 0) return []
    this.save(parsed, parsed.lessons.filter(lesson => !wanted.has(lesson.text)))
    return removed
  }

  /** Remove lessons by exact text or 1-based index. Returns the removed texts. */
  remove(targets) {
    const parsed = this.read()
    const wanted = new Set()
    for (const target of Array.isArray(targets) ? targets : [targets]) {
      if (Number.isInteger(target) && target >= 1 && target <= parsed.lessons.length) {
        wanted.add(parsed.lessons[target - 1].text.toLowerCase())
      } else if (typeof target === 'string') {
        const text = normalizeLesson(target)
        if (/^\d+$/.test(target.trim())) {
          const index = Number(target.trim())
          if (index >= 1 && index <= parsed.lessons.length) wanted.add(parsed.lessons[index - 1].text.toLowerCase())
        } else if (text !== '') {
          wanted.add(text.toLowerCase())
        }
      }
    }
    const removed = parsed.lessons.filter(lesson => wanted.has(lesson.text.toLowerCase())).map(lesson => lesson.text)
    if (removed.length === 0) return []
    this.save(parsed, parsed.lessons.filter(lesson => !wanted.has(lesson.text.toLowerCase())))
    return removed
  }
}
