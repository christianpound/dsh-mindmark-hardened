import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Exercise the shipped closures without adding a production debugging API or
// React/DOM dependency. Only the two export seams are instrumented in memory.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function harness() {
  let plugin, moduleId
  const requests = [], readers = [], seats = []
  const document = {
    body: {}, documentElement: {},
    querySelectorAll: selector => selector === '[data-conversation-session]' ? seats : [],
    createTreeWalker(root) { let i = 0; return { nextNode: () => (root.textNodes || [])[i++] || null } },
  }
  const context = {
    console, setTimeout, clearTimeout, document,
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    FileReader: class {
      constructor() { readers.push(this) }
      readAsText(file) { this.file = file }
      finish(result) { this.result = result; this.onload() }
      fail() { this.onerror() }
    },
    window: { __ModuleLoader__: { load(definition) {
      moduleId = definition.id
      plugin = definition.factory(() => ({ createElement: (...args) => args }))
    } } },
  }
  const instrumented = source
    .replace('    exports.apply = apply', '    exports.createSessionRuntime = createSessionRuntime\n    exports.apply = apply')
    .replace('      SelectionActions: WithTranslate(SelectionActions),', `      test: { controller, readReferenceFile, resolveRoot, findRoot, admitSelection, buildRecord, caretTarget, applyServerPayload, postAction, loadSession, STYLES, whenIdle: function () { return mutationQueue } },
      SelectionActions: WithTranslate(SelectionActions),`)
  vm.runInNewContext(instrumented, context, { filename: 'client.js' })
  function runtime(id = 'A', serial = 1) { return plugin.createSessionRuntime(id, serial, null) }
  function message(sessionId, key, text = 'same quote') {
    const seat = { getAttribute: () => sessionId, querySelectorAll: () => [body] }
    const item = { getAttribute: name => name === 'data-chat-node-key' ? key : null }
    const body = {
      nodeType: 1, tagName: 'DIV', isConnected: true,
      closest(selector) {
        if (selector === '[data-conversation-session]') return seat
        if (selector === '[data-chat-node-key]') return item
        if (selector === '[data-text-interaction-source]') return body
        return null
      },
    }
    const node = { nodeType: 3, nodeValue: text, parentElement: body }
    body.textNodes = [node]
    seats.push(seat)
    return { body, seat, node, range: { startContainer: node, endContainer: node, commonAncestorContainer: node, startOffset: 0, endOffset: text.length, toString: () => text } }
  }
  function select(range) { context.window.getSelection = () => ({ rangeCount: 1, isCollapsed: false, toString: range.toString, getRangeAt: () => range }) }
  return { runtime, requests, readers, message, select, moduleId }
}
const built = () => ({ record: { id: 'temporary-1', style: 'reference', quote: 'same quote', note: '', prefix: '', suffix: '', rootSelector: 'body', messageKey: 'message-1', createdAt: new Date().toISOString() }, message: { key: 'message-1', text: 'same quote' } })
const t = key => key
function fileDraft(runtime) { runtime.test.controller.startReference(built()); runtime.test.controller.patchReference({ kind: 'file' }) }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function reply(request, data) { request.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, ...data }) }) }

test('file completion cannot modify a replacement or cancelled reference draft', () => {
  const h = harness(), r = h.runtime()
  fileDraft(r)
  const oldToken = r.test.controller.getState().referenceDraft.token
  r.test.readReferenceFile({ name: 'old.txt', size: 10 }, t)
  r.test.controller.cancelReference()
  fileDraft(r)
  r.test.readReferenceFile({ name: 'late-chooser.txt', size: 10 }, t, oldToken)
  assert.equal(h.readers.length, 1)
  h.readers[0].finish('old private content')
  h.readers[0].fail()
  assert.equal(r.test.controller.getState().referenceDraft.content, '')
  assert.equal(r.test.controller.getState().referenceDraft.error, '')
  r.test.controller.cancelReference()
  h.readers[0].finish('again')
  assert.equal(r.test.controller.getState().referenceDraft, null)
})

test('latest file wins and changing material kind invalidates pending file', () => {
  const h = harness(), r = h.runtime()
  fileDraft(r)
  r.test.readReferenceFile({ name: 'old.txt', size: 10 }, t)
  r.test.readReferenceFile({ name: 'new.txt', size: 10 }, t)
  r.test.controller.patchReference({ title: 'Edited title' })
  h.readers[1].finish('new content')
  h.readers[0].finish('old content')
  h.readers[0].fail()
  assert.equal(r.test.controller.getState().referenceDraft.content, 'new content')
  assert.equal(r.test.controller.getState().referenceDraft.title, 'Edited title')
  r.test.readReferenceFile({ name: 'third.txt', size: 10 }, t)
  r.test.controller.patchReference({ kind: 'text' })
  r.test.controller.patchReference({ kind: 'file' })
  h.readers[2].finish('stale third content')
  assert.equal(r.test.controller.getState().referenceDraft.content, '')
})

test('session runtimes cannot retarget file callbacks or each other', () => {
  const h = harness(), a = h.runtime('A', 1), b = h.runtime('B', 2)
  fileDraft(a); fileDraft(b)
  a.test.readReferenceFile({ name: 'a.txt', size: 10 }, t)
  a.test.controller.setCurrentSession('B')
  a.test.controller.setCurrentSession(null)
  h.readers[0].finish('A only')
  assert.equal(a.test.controller.getState().sessionId, 'A')
  assert.equal(a.test.controller.getState().referenceDraft.content, 'A only')
  assert.equal(b.test.controller.getState().referenceDraft.content, '')
  a.dispose()
  h.readers[0].fail()
  assert.equal(b.test.controller.getState().referenceDraft.error, '')
})

test('message/session scoping survives reload and rejects broad, stale, ambiguous anchors', () => {
  const h = harness(), a = h.runtime('A'), b = h.runtime('B', 2)
  const ma = h.message('A', 'message-1'), mb = h.message('B', 'message-1')
  assert.equal(a.test.resolveRoot('body', 'message-1'), ma.body)
  assert.equal(b.test.resolveRoot('body', 'message-1'), mb.body)
  assert.equal(a.test.resolveRoot('body', 'missing'), null)
  assert.equal(a.test.resolveRoot('body', undefined), null)
  assert.equal(a.test.findRoot(mb.range), null)
  h.select(mb.range)
  assert.equal(a.test.admitSelection({ sessionId: 'A', readText: () => 'same quote' }), null)
  h.select(ma.range)
  assert.equal(a.test.admitSelection({ sessionId: 'A', readText: () => null }), null)
  assert.equal(a.test.admitSelection({ sessionId: 'A', readText: () => 'same quote' }), ma.range)
  for (const style of a.test.STYLES) {
    const record = a.test.buildRecord(ma.range, style)
    assert.equal(record.record.style, style)
    assert.equal(record.record.messageKey, 'message-1')
  }
  const mixed = { ...ma.range, endContainer: mb.node }
  assert.equal(a.test.findRoot(mixed), null)
  assert.equal(a.test.buildRecord(mixed, 'highlight'), null)
  h.message('A', 'message-1')
  assert.equal(a.test.resolveRoot('anything', 'message-1'), null)
})

test('all seven styles and hardened module/route remain available', async () => {
  const h = harness(), a = h.runtime('A')
  assert.equal(h.moduleId, '@local/dsh-mindmark-hardened')
  assert.deepEqual(Array.from(a.test.STYLES), ['highlight', 'underline', 'strike', 'comment', 'rewrite', 'move', 'reference'])
  a.test.loadSession('A')
  const post = a.test.postAction({ action: 'list', sessionId: 'A' })
  assert.equal(h.requests.length, 2)
  for (const request of h.requests) {
    assert.match(request.url, /^\/plugins\/dsh-mindmark-hardened\/annotations(?:\?|$)/)
    assert.equal(request.options.credentials, 'same-origin')
    assert.equal(request.options.redirect, 'error')
    assert.equal(request.options.headers['x-dsh-mindmark'], '1')
    reply(request, { annotations: [] })
  }
  await post; await flush()
})

test('server UUID reconciliation preserves pending adds and translates queued remove', async () => {
  const h = harness(), a = h.runtime('A')
  const first = { ...built().record, style: 'highlight' }
  const second = { ...first, id: 'temporary-2', quote: 'other quote' }
  a.test.controller.addAnnotation(first, built().message)
  a.test.controller.addAnnotation(second, built().message)
  a.test.controller.removeAnnotations([first.id])
  await flush()
  const serverFirst = { ...first, id: 'server-uuid-1' }
  reply(h.requests[0], { annotation: serverFirst, annotations: [serverFirst] })
  await flush()
  assert.equal(a.test.controller.getState().annotations.some(x => x.id === 'temporary-2'), true)
  const serverSecond = { ...second, id: 'server-uuid-2' }
  reply(h.requests[1], { annotation: serverSecond, annotations: [serverFirst, serverSecond] })
  await flush()
  assert.deepEqual(JSON.parse(h.requests[2].options.body).ids, ['server-uuid-1'])
  reply(h.requests[2], { annotations: [serverSecond] })
  await a.test.whenIdle()
  assert.deepEqual(Array.from(a.test.controller.getState().annotations, x => x.id), ['server-uuid-2'])
})

test('late session load cannot overwrite another session or newer local add', async () => {
  const h = harness(), a = h.runtime('A'), b = h.runtime('B', 2)
  a.test.loadSession('A'); b.test.loadSession('B')
  a.test.controller.addAnnotation({ ...built().record, style: 'highlight' }, built().message)
  reply(h.requests[0], { annotations: [], mode: 'full' })
  reply(h.requests[1], { annotations: [], mode: 'full' })
  await flush()
  assert.equal(a.test.controller.getState().annotations.length, 1)
  assert.equal(a.test.controller.getState().mode, 'brief')
  assert.equal(b.test.controller.getState().mode, 'full')
  reply(h.requests[2], { annotation: { ...built().record, id: 'server-id' }, annotations: [{ ...built().record, id: 'server-id' }] })
  await a.test.whenIdle()
})
