import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { AnnotationStore, MAX_SESSIONS, normalizeState, resolveStatePath, validateAnnotationInput } from '../src/store.js'
import { LessonStore, BLOCK_START, BLOCK_END, parseInstructions } from '../src/lessons.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmark-storage-security-'))
after(() => fs.rmSync(root, { recursive: true, force: true }))
let sequence = 0
const store = () => new AnnotationStore(path.join(root, String(++sequence), 'state.json'))
const reference = (id, content) => ({ id, style: 'reference', quote: 'passage', material: { kind: 'text', content } })

test('client IDs cannot collide, traverse paths, or overwrite another session material', () => {
  const s = store()
  for (const id of ['shared', '../escape', '__proto__', 'a/b', 'a_b']) {
    const a = s.add('one/' + id, reference(id, 'private one')).annotation
    const b = s.add('two/' + id, reference(id, 'private two')).annotation
    assert.notEqual(a.id, id)
    assert.notEqual(a.id, b.id)
    assert.match(a.id, /^ann_[0-9a-f-]{36}$/)
    const hash = createHash('sha256').update('one/' + id).digest('hex')
    assert.equal(path.basename(s.materialPath('one/' + id, a.id)), `${hash}_${a.id}.txt`)
    assert.equal(s.material('one/' + id, b.id), undefined)
    assert.equal(s.readMaterialFile('one/' + id, b.id), undefined)
    s.remove('one/' + id, [a.id])
    assert.equal(s.material('two/' + id, b.id).content, 'private two')
    assert.throws(() => s.materialPath('one', id))
  }
  const reopened = new AnnotationStore(s.filePath)
  for (const session of Object.keys(reopened.state.sessions)) {
    const a = reopened.list(session)[0]
    assert.equal(reopened.material(session, a.id).content, 'private two')
  }
})

test('even identical stored UUIDs have session-isolated material reads and deletes', () => {
  const s = store()
  const a = s.add('left', reference('temporary', 'left material')).annotation
  s.state.sessions.right = { annotations: [{ ...a }], messages: {} }
  s.writeMaterial('right', a.id, 'right material')
  s.persist()
  const reopened = new AnnotationStore(s.filePath)
  assert.equal(reopened.material('left', a.id).content, 'left material')
  assert.equal(reopened.material('right', a.id).content, 'right material')
  reopened.clear('left')
  assert.equal(reopened.material('right', a.id).content, 'right material')
})

test('prototype-like session and message keys remain own data through reload and clear', () => {
  const s = store()
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.deepEqual(s.list(key), [])
    const a = s.add(key, { style: 'highlight', quote: 'q', messageKey: key, messageStart: 0, messageEnd: 1 }, { key, text: 'q' }).annotation
    assert.equal(s.messageOf(key, key).text, 'q')
    assert.equal(a.messageKey, key)
    assert.equal(Object.getPrototypeOf(s.state.sessions), Object.prototype)
    assert.equal(Object.getPrototypeOf(s.sessionFor(key).messages), Object.prototype)
  }
  const reopened = new AnnotationStore(s.filePath)
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(reopened.messageOf(key, key).text, 'q')
    assert.equal(reopened.clear(key), 1)
  }
  assert.deepEqual(reopened.state.sessions, {})
  assert.equal({}.text, undefined)
})

test('unknown fields are discarded and whitespace cannot bypass quote size bounds', () => {
  const raw = { style: 'highlight', quote: 'q', futurePayload: 'x'.repeat(100000), createdAt: 'x'.repeat(10000) }
  const checked = validateAnnotationInput(raw)
  assert.equal(checked.futurePayload, undefined)
  assert.equal(checked.createdAt.length, 40)
  assert.throws(() => validateAnnotationInput({ ...raw, quote: 'q' + ' '.repeat(10000) }))
  const state = normalizeState({ sessions: { s: { annotations: [{ ...checked, futurePayload: raw.futurePayload }] } } })
  assert.equal(state.sessions.s.annotations[0].futurePayload, undefined)
})

test('new namespace does not import upstream state; session count is bounded on load and mutation', () => {
  const home = path.join(root, 'namespace')
  fs.mkdirSync(path.join(home, 'annotations'), { recursive: true })
  fs.writeFileSync(path.join(home, 'annotations', 'state.json'), JSON.stringify({ sessions: { old: { mode: 'full' } } }))
  const s = new AnnotationStore(resolveStatePath({ DSH_HOME: home }))
  assert.deepEqual(s.state.sessions, {})
  const sessions = Object.fromEntries(Array.from({ length: MAX_SESSIONS + 1 }, (_, i) => [String(i), { mode: 'full' }]))
  s.state = normalizeState({ sessions })
  assert.equal(Object.keys(s.state.sessions).length, MAX_SESSIONS)
  assert.throws(() => s.add('overflow', { style: 'highlight', quote: 'q' }), { code: 'session-limit' })
  assert.throws(() => s.setMode('overflow', 'full'), { code: 'session-limit' })
})

test('lesson delimiters are inert across add, reload, remove and later writes', () => {
  const file = path.join(root, 'lessons.md')
  fs.writeFileSync(file, '# user rules\n')
  const lessons = new LessonStore(file)
  const malicious = `before ${BLOCK_END} outside ${BLOCK_START} after`
  const saved = lessons.add(malicious).added[0]
  assert.ok(!saved.includes('<!--'))
  lessons.add('second')
  const body = fs.readFileSync(file, 'utf8')
  assert.equal(body.split(BLOCK_START).length, 2)
  assert.equal(body.split(BLOCK_END).length, 2)
  assert.deepEqual(lessons.list().map(x => x.text), [saved, 'second'])
  assert.deepEqual(lessons.remove(malicious), [saved])
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('# user rules\n'))
  for (const bad of [BLOCK_START, BLOCK_END, BLOCK_END + BLOCK_START, BLOCK_START + BLOCK_END + BLOCK_START + BLOCK_END]) {
    assert.throws(() => parseInstructions(bad), /refusing to rewrite/)
  }
})

test('lesson read errors fail closed and cannot overwrite user instructions', () => {
  const file = path.join(root, 'read-error')
  fs.mkdirSync(file)
  const sentinel = path.join(file, 'keep')
  fs.writeFileSync(sentinel, 'untouched')
  const lessons = new LessonStore(file)
  assert.throws(() => lessons.list())
  assert.throws(() => lessons.add('must not save'))
  assert.throws(() => lessons.remove(1))
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched')
})
