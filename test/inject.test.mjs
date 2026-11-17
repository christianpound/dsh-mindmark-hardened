// Unit tests for the injection text, the pre-step listener and the store's
// pending/resolved bookkeeping (node:test, no network, temp dirs only).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { createPreStepListener, DEFAULT_MAX_INJECTIONS } from '../index.js'
import { briefLine, buildInjection, buildProtocolSection, renderFullMessage, SOURCE_KIND, TOOL_NAME } from '../src/inject.js'
import { AnnotationStore } from '../src/store.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mindmark-inject-'))
after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

let counter = 0
function tempStore() {
  counter += 1
  return new AnnotationStore(path.join(tempRoot, `store-${counter}`, 'state.json'), { logger: { warn() {} } })
}

const MESSAGE = '第一段：介绍背景。\n第二段：给出方案 A 和方案 B。\n第三段：结论是选 A。'

function anchored(style, quote, extra = {}) {
  const start = MESSAGE.indexOf(quote)
  return {
    style,
    quote,
    prefix: MESSAGE.slice(Math.max(0, start - 10), start),
    suffix: MESSAGE.slice(start + quote.length, start + quote.length + 10),
    messageKey: 'node:7',
    messageStart: start,
    messageEnd: start + quote.length,
    turn: 2,
    ...extra,
  }
}

const CAPTURE = { key: 'node:7', text: MESSAGE, turn: 2 }

// ------------------------------------------------------------ inject.js

test('buildInjection is empty without annotations and lists each one in brief mode', () => {
  assert.equal(buildInjection({ mode: 'brief', annotations: [], messages: {} }), '')
  const text = buildInjection({
    mode: 'brief',
    annotations: [
      { id: 'a1', style: 'highlight', quote: '方案 A', prefix: '给出', suffix: ' 和方案 B', createdAt: '2026-11-16T01:00:00Z' },
      { id: 'a2', style: 'comment', quote: '选 A', note: '理由不充分', prefix: '结论是', suffix: '。', createdAt: '2026-11-16T01:01:00Z' },
      { id: 'a3', style: 'rewrite', quote: '介绍背景', note: '先说结论', prefix: '', suffix: '', createdAt: '2026-11-16T00:59:00Z' },
    ],
    messages: {},
  }, { turn: 3 })
  assert.match(text, /## 用户对你之前回答的标注（第 3 轮之前）/)
  assert.match(text, /3 处标注/)
  // ordered by createdAt: a3, a1, a2
  assert.match(text, /1\. \[#a3\] 改写：“介绍背景”\n {3}改为：“先说结论”/)
  assert.match(text, /2\. \[#a1\] 高亮：“方案 A”/)
  assert.match(text, /上下文：…给出【方案 A】和方案 B…/)
  assert.match(text, /3\. \[#a2\] 批注：“选 A”\n {3}用户批注：理由不充分/)
  assert.match(text, new RegExp(`\`${TOOL_NAME}\` 工具，action 传 resolve`))
  assert.match(text, /#a3、#a1、#a2/)
})

test('briefLine truncates long quotes and notes', () => {
  const line = briefLine({ id: 'x', style: 'underline', quote: '长'.repeat(500), note: '', prefix: '', suffix: '' }, 0)
  assert.ok(line.includes('长'.repeat(300) + '…'))
  assert.ok(!line.includes('长'.repeat(301)))
})

test('renderFullMessage inlines non-overlapping markers in order and reports leftovers', () => {
  const a = anchored('strike', '方案 B')
  const b = anchored('highlight', '方案 A')
  const overlapping = anchored('underline', '方案 A 和方案 B')
  const stale = { ...anchored('comment', '第三段', { note: 'n' }), messageStart: 0, messageEnd: 3 }
  const out = renderFullMessage(MESSAGE, [a, b, overlapping, stale], 1)
  assert.equal(out.inlined.length, 2)
  assert.equal(out.inlined[0].annotation, b)
  assert.equal(out.inlined[1].annotation, a)
  assert.deepEqual(out.leftover, [stale, overlapping], 'leftovers come back in document order')
  assert.ok(out.text.includes('[[#1 高亮：方案 A]] 和[[#2 删除：方案 B]]'))
  assert.equal(out.nextNumber, 3)
})

test('buildInjection full mode renders the captured message with markers and footnotes', () => {
  const text = buildInjection({
    mode: 'full',
    annotations: [
      { id: 'r1', createdAt: '2026-11-16T01:00:00Z', ...anchored('rewrite', '结论是选 A', { note: '结论是两个都不选' }) },
      { id: 'h1', createdAt: '2026-11-16T01:00:01Z', ...anchored('highlight', '介绍背景') },
      { id: 'u1', createdAt: '2026-11-16T01:00:02Z', style: 'underline', quote: '不在消息里', prefix: '', suffix: '', messageKey: '' },
    ],
    messages: { 'node:7': { text: MESSAGE, turn: 2 } },
  })
  assert.match(text, /### 第 2 轮的回答（修订视图/)
  assert.ok(text.includes('第一段：[[#1 高亮：介绍背景]]。'))
  assert.ok(text.includes('第三段：[[#2 改写：结论是选 A → 结论是两个都不选]]。'))
  assert.match(text, /#1 → id h1（高亮）/)
  assert.match(text, /#2 → id r1（改写）/)
  assert.match(text, /### 其余标注（未能内嵌到完整消息里）\n\n1\. \[#u1\] 下划线：“不在消息里”/)
})

test('buildProtocolSection appears only with pending annotations', () => {
  assert.equal(buildProtocolSection(0), '')
  assert.equal(buildProtocolSection(undefined), '')
  assert.match(buildProtocolSection(2), /当前 2 条/)
})

// ----------------------------------------------------- store bookkeeping

test('store add captures the message, resolve/reopen/markInjected track status', () => {
  const store = tempStore()
  const { annotation } = store.add('s1', { ...anchored('highlight', '方案 A'), id: 'h' }, CAPTURE)
  assert.equal(annotation.status, 'pending')
  assert.equal(annotation.messageStart, MESSAGE.indexOf('方案 A'))
  assert.deepEqual(store.messageOf('s1', 'node:7'), { text: MESSAGE, turn: 2 })
  assert.deepEqual(store.snapshot('s1').mode, 'brief')

  // An anchored record whose message was never captured loses its offsets, not its mark.
  const orphan = store.add('s1', { style: 'strike', quote: 'q', messageKey: 'node:9', messageStart: 0, messageEnd: 1 }).annotation
  assert.equal(orphan.messageKey, '')
  assert.equal(orphan.messageStart, undefined)

  assert.deepEqual(store.resolve('s1', [annotation.id], { by: 'model' }), [annotation.id])
  assert.equal(store.pending('s1').length, 1)
  assert.equal(store.list('s1')[0].resolvedBy, 'model')
  assert.deepEqual(store.resolve('s1', [annotation.id]), [], 'resolving twice changes nothing')
  assert.deepEqual(store.reopen('s1', [annotation.id]), [annotation.id])
  assert.equal(store.list('s1')[0].resolvedAt, undefined)

  const marked = store.markInjected('s1', [annotation.id, orphan.id], { turn: 4, cap: 2 })
  assert.deepEqual(marked, { injected: [annotation.id, orphan.id], capped: [] })
  assert.equal(store.list('s1')[0].injections, 1)
  assert.equal(store.list('s1')[0].lastInjectedTurn, 4)
  store.markInjected('s1', [annotation.id], { turn: 5, cap: 2 })
  assert.equal(store.injectable('s1', 2).map(item => item.id).join(','), orphan.id)
  const capped = store.markInjected('s1', [annotation.id], { turn: 6, cap: 2 })
  assert.deepEqual(capped, { injected: [], capped: [annotation.id] })
  assert.equal(store.list('s1')[0].resolvedBy, 'cap')

  // Re-adding the same mark makes it pending again with a fresh counter.
  const again = store.add('s1', { ...anchored('highlight', '方案 A'), id: 'ignored' }, CAPTURE)
  assert.equal(again.deduped, true)
  assert.equal(again.annotation.id, annotation.id)
  assert.equal(again.annotation.status, 'pending')
  assert.equal(again.annotation.injections, 0)
})

test('mode is per session, persisted, and survives clear', () => {
  const file = path.join(tempRoot, 'mode', 'state.json')
  const store = new AnnotationStore(file, { logger: { warn() {} } })
  assert.equal(store.getMode('m1'), 'brief')
  assert.equal(store.setMode('m1', 'full'), 'full')
  assert.throws(() => store.setMode('m1', 'huge'), /模式/)
  store.add('m1', { style: 'highlight', quote: 'q' })
  assert.equal(store.clear('m1'), 1)
  assert.equal(store.getMode('m1'), 'full')
  const reopened = new AnnotationStore(file, { logger: { warn() {} } })
  assert.equal(reopened.getMode('m1'), 'full')
  assert.equal(reopened.getMode('m2'), 'brief')
  const configured = new AnnotationStore(path.join(tempRoot, 'mode2', 'state.json'), { defaultMode: 'full' })
  assert.equal(configured.getMode('any'), 'full')
})

test('comment and rewrite require a note', () => {
  const store = tempStore()
  assert.throws(() => store.add('n1', { style: 'comment', quote: 'q' }), /批注需要/)
  assert.throws(() => store.add('n1', { style: 'rewrite', quote: 'q', note: '   ' }), /改写需要/)
  assert.equal(store.add('n1', { style: 'comment', quote: 'q', note: ' 意见 ' }).annotation.note, '意见')
})

// ------------------------------------------------------- pre-step listener

function userMessage(id, kind = 'user') {
  return { id, role: 'user', content: [{ type: 'text', text: `msg ${id}` }], source: { kind } }
}

function payload(sessionId, { turn = 2, step = 1, aborted = false } = {}) {
  return { agent: { id: sessionId }, turn, step, signal: { aborted }, messages: [] }
}

test('the listener enters one context message after the user prompt on step 1 only', async () => {
  const store = tempStore()
  store.add('p1', { ...anchored('highlight', '方案 A'), id: 'h' }, CAPTURE)
  const listener = createPreStepListener(store, { maxInjections: 2, messageId: () => 'ctx-1' })
  const base = { kind: 'enter', messages: [userMessage('u1'), userMessage('ctx-other', 'time-context')] }

  const decision = await listener(payload('p1'), async () => base)
  assert.equal(decision.messages.length, 3)
  assert.equal(decision.messages[1].id, 'ctx-1')
  assert.equal(decision.messages[1].role, 'user')
  assert.equal(decision.messages[1].source.kind, SOURCE_KIND)
  assert.equal(decision.messages[1].source.form, 'snapshot')
  assert.ok(decision.messages[1].content[0].text.includes(`[#${store.list('p1')[0].id}] 高亮：“方案 A”`))
  assert.ok(Object.isFrozen(decision.messages[1]))
  assert.equal(base.messages.length, 2, 'the incoming decision is not mutated')
  assert.equal(store.list('p1')[0].injections, 1)

  // Tool continuations (step > 1) and rejected turns are left alone.
  const later = await listener(payload('p1', { step: 2 }), async () => base)
  assert.equal(later, base)
  const rejected = { kind: 'reject' }
  assert.equal(await listener(payload('p1'), async () => rejected), rejected)
  assert.equal(await listener(payload('p1', { aborted: true }), async () => base), base)
  // A batch without a direct user message (synthetic turn) is left alone too.
  const synthetic = { kind: 'enter', messages: [userMessage('x', 'cron')] }
  assert.equal(await listener(payload('p1'), async () => synthetic), synthetic)
  assert.equal(store.list('p1')[0].injections, 1)
})

test('injection repeats until resolved and stops at the cap', async () => {
  const store = tempStore()
  store.add('p2', { style: 'underline', quote: 'q' })
  const listener = createPreStepListener(store, { maxInjections: 2 })
  const base = () => ({ kind: 'enter', messages: [userMessage('u')] })

  assert.equal((await listener(payload('p2', { turn: 1 }), async () => base())).messages.length, 2)
  assert.equal((await listener(payload('p2', { turn: 2 }), async () => base())).messages.length, 2)
  const third = await listener(payload('p2', { turn: 3 }), async () => base())
  assert.equal(third.messages.length, 1, 'the cap settles the annotation instead of injecting again')
  assert.equal(store.list('p2')[0].resolvedBy, 'cap')

  store.reopen('p2')
  assert.equal((await listener(payload('p2', { turn: 4 }), async () => base())).messages.length, 2)
  store.resolve('p2', [], { by: 'model' })
  assert.equal((await listener(payload('p2', { turn: 5 }), async () => base())).messages.length, 1)
})

test('full mode injection goes through the listener with the captured message', async () => {
  const store = tempStore()
  store.setMode('p3', 'full')
  store.add('p3', { ...anchored('strike', '方案 B'), id: 's' }, CAPTURE)
  const listener = createPreStepListener(store, {})
  const decision = await listener(payload('p3'), async () => ({ kind: 'enter', messages: [userMessage('u')] }))
  const text = decision.messages[1].content[0].text
  assert.match(text, /修订视图/)
  assert.ok(text.includes('方案 A 和[[#1 删除：方案 B]]'))
  assert.equal(DEFAULT_MAX_INJECTIONS, 3)
})

test('a listener failure never breaks the turn', async () => {
  const warnings = []
  const broken = { pending() { throw new Error('boom') } }
  const listener = createPreStepListener(broken, { logger: { warn: message => warnings.push(message) } })
  const base = { kind: 'enter', messages: [userMessage('u')] }
  assert.equal(await listener(payload('p4'), async () => base), base)
  assert.equal(warnings.length, 1)
})
