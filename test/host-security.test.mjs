import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createAnnotationsHandler, createAnnotationsTool, apply, ROUTE } from '../index.js'
import { AnnotationStore } from '../src/store.js'
import { LessonStore } from '../src/lessons.js'
import { buildInjection, buildProtocolSection } from '../src/inject.js'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmark-security-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = new AnnotationStore(path.join(dir, 'state.json'))
  store.lessons = new LessonStore(path.join(dir, 'AGENTS.md'))
  store.lessons.add(['private fixture preference'])
  const peer = { principal: { kind: 'owner' } }
  const connection = {
    browserPeer: peer,
    admit: req => req.headers.cookie === 'test-auth' ? { peer } : { rejection: 401 },
  }
  const handler = createAnnotationsHandler({ store, connection, sessionExists: id => id === 'session-a' })
  return { dir, store, connection, peer, handler }
}
async function request(handler, { method = 'GET', headers = {}, sessionId = 'session-a', body } = {}) {
  const req = {
    method, url: `${ROUTE}?sessionId=${sessionId}`,
    headers: { host: '127.0.0.1:3080', cookie: 'test-auth', 'x-dsh-mindmark': '1', 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  }
  const out = {}
  await handler(req, {
    writeHead(status, responseHeaders) { out.status = status; out.headers = responseHeaders },
    end(value) { out.body = value && JSON.parse(value) },
  })
  return out
}

test('all reads and writes require DSH admission plus same-origin custom header', async t => {
  const { handler, store } = fixture(t)
  const badHeaders = [
    { cookie: '' }, { 'x-dsh-mindmark': undefined }, { origin: 'null' },
    { origin: 'http://localhost:9999' }, { origin: 'http://127.0.0.1:9999' },
    { origin: 'https://evil.invalid' }, { origin: 'https://127.0.0.1:3080' },
    { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' },
    { origin: ['http://127.0.0.1:3080'] },
  ]
  for (const headers of badHeaders) {
    for (const method of ['GET', 'POST']) {
      const out = await request(handler, { method, headers, body: method === 'POST' ? {
        action: 'add', sessionId: 'session-a', annotation: { style: 'comment', quote: 'q', note: 'unwanted' },
      } : undefined })
      assert.ok([401, 403].includes(out.status), JSON.stringify(headers))
      assert.equal(out.headers['access-control-allow-origin'], undefined)
      assert.equal(out.body.lessons, undefined)
    }
  }
  assert.deepEqual(store.list('session-a'), [])
  const ok = await request(handler, { headers: { origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' } })
  assert.equal(ok.status, 200)
})

test('preflight, unknown sessions and non-browser API peers fail closed', async t => {
  const f = fixture(t)
  assert.equal((await request(f.handler, { method: 'OPTIONS' })).status, 403)
  const unknown = await request(f.handler, { sessionId: 'nonexistent' })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.lessons, undefined)
  f.connection.admit = () => ({ peer: { principal: { kind: 'owner' } } })
  assert.equal((await request(f.handler)).status, 403)
  assert.throws(() => createAnnotationsHandler({ store: f.store }), /admission/)
})

test('global writes are denied unless separately approved; reads do not leak preferences by default', async t => {
  const { store, dir } = fixture(t)
  const exec = { agent: { id: 'session-a' } }
  const original = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
  for (const confirmGlobalChange of [undefined, async () => false, async () => undefined]) {
    const tool = createAnnotationsTool(store, { confirmGlobalChange })
    await assert.rejects(tool.execute({ action: 'distill', lessons: ['bad persistent instruction'] }, exec), /approval/)
    await assert.rejects(tool.execute({ action: 'forget', lessons: ['1'] }, exec), /approval/)
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), original)
    assert.deepEqual((await tool.execute({ action: 'list' }, exec)).lessons, [])
  }
  const shown = []
  const tool = createAnnotationsTool(store, { confirmGlobalChange: async (action, texts) => { shown.push([action, texts]); return true } })
  await tool.execute({ action: 'distill', lessons: ['  safe   preference  '] }, exec)
  assert.deepEqual(shown[0], ['distill', ['safe preference']])
  assert.ok(store.lessons.list().some(x => x.text === 'safe preference'))
  await tool.execute({ action: 'forget', lessons: ['2'] }, exec)
  assert.deepEqual(shown[1], ['forget', ['safe preference']])
  assert.equal(store.lessons.list().length, 1)
})

test('cancelled or aborted human confirmation cannot write', async t => {
  const { store } = fixture(t)
  const ac = new AbortController()
  const tool = createAnnotationsTool(store, { confirmGlobalChange: async () => { ac.abort(); return true } })
  await assert.rejects(tool.execute({ action: 'distill', lessons: ['never saved'] }, { agent: { id: 'session-a' }, signal: ac.signal }), /approval/)
  assert.equal(store.lessons.list().length, 1)
})

test('production wiring asks the human; arbitrary answers and custom text do not authorize', async t => {
  const f = fixture(t)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = path.join(f.dir, 'runtime')
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  let tool, question, answer = { answers: [] }
  apply({
    logger: { info() {}, warn() {} }, effect: f => f(), on() {},
    connection: f.connection, sessions: { get: () => ({}) },
    webServer: { register: () => () => {} }, systemPrompt: { section: () => () => {} },
    tools: { register: t => { tool = t; return () => {} } },
    userQuestions: { ask: async q => { question = q; return answer } },
  })
  const args = { action: 'distill', lessons: ['human-reviewed preference'] }
  const exec = { agent: { id: 'session-a' } }
  for (const candidate of [{ answers: [] }, { answers: [{ id: 'mindmark-global-change', selected: [], custom: 'yes' }] },
    { answers: [{ id: 'mindmark-global-change', selected: ['Cancel'] }] }]) {
    answer = candidate
    await assert.rejects(tool.execute(args, exec), /approval/)
  }
  assert.equal(question.agent, exec.agent)
  assert.match(question.questions[0].detail, /human-reviewed preference/)
  answer = { answers: [{ id: 'mindmark-global-change', selected: ['Approve this change'] }] }
  const result = await tool.execute(args, exec)
  assert.deepEqual(result.changed, args.lessons)
})

test('prompt distinguishes reference data and forbids inferred persistent consent', () => {
  const text = buildInjection({ annotations: [{ id: 'fixture', style: 'highlight', quote: 'q' }] })
  for (const prompt of [text, buildProtocolSection(1)]) {
    assert.match(prompt, /untrusted task data/)
    assert.match(prompt, /repetition is not consent/i)
    assert.doesNotMatch(prompt, /或者同类标注反复出现/)
  }
})
