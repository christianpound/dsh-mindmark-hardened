// Unit tests for the dsh-mindmark HTTP handler, prompt section and tool
// registration (node:test, no network: req/res are plain recorders).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import {
  apply,
  createAnnotationsHandler,
  ROUTE,
  SECTION_NAME,
  SECTION_ORDER,
  TOOL_NAME,
} from '../index.js'
import { AnnotationStore } from '../src/store.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mindmark-http-'))
after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

const storeFile = path.join(tempRoot, 'handler', 'annotations', 'state.json')
const store = new AnnotationStore(storeFile, { logger: { warn() {} } })
const peer = { principal: { kind: 'owner' } }
const connection = { browserPeer: peer, admit: () => ({ peer }) }
const handler = createAnnotationsHandler({ store, logger: { warn() {} }, connection, sessionExists: () => true })

const SESSION_ID = 'sess_handler_1'

// --------------------------------------------------------------- fake HTTP

function createRes() {
  const res = {
    statusCode: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers ?? {}
      return res
    },
    end(chunk) {
      if (chunk !== undefined) {
        res.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      }
    },
  }
  return res
}

function createReq(method, options = {}) {
  const { body, headers = {}, url = ROUTE } = options
  const chunks =
    body === undefined
      ? []
      : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')]
  return {
    method,
    headers: { host: '127.0.0.1:3080', 'x-dsh-mindmark': '1', ...headers },
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

async function call(req, target = handler) {
  const res = createRes()
  await target(req, res)
  let json
  try {
    json = res.body === '' ? undefined : JSON.parse(res.body)
  } catch {
    json = undefined
  }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}

function jsonHeaders(extra = {}) {
  return { host: '127.0.0.1:3080', 'x-dsh-mindmark': '1', 'content-type': 'application/json', ...extra }
}

function localStamp(iso) {
  const date = new Date(iso)
  const pad = number => String(number).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// ------------------------------------------------------------------- route

test('the route path is the contract path and the factory needs a store', () => {
  assert.equal(ROUTE, '/plugins/dsh-mindmark-hardened/annotations')
  assert.throws(() => createAnnotationsHandler({}), TypeError)
  assert.throws(() => createAnnotationsHandler(), TypeError)
})

test('OPTIONS never grants CORS permission even for loopback origins', async () => {
  const response = await call(
    createReq('OPTIONS', { headers: { origin: 'http://127.0.0.1:36715' } }),
  )
  assert.equal(response.status, 403)
  assert.equal(response.headers['access-control-allow-origin'], undefined)
})

test('GET an unknown session answers with an empty list, not an error', async () => {
  const response = await call(createReq('GET', { url: `${ROUTE}?sessionId=${SESSION_ID}` }))
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.deepEqual(response.json.annotations, [])
})

test('GET rejects a missing or malformed sessionId with Chinese validation errors', async () => {
  for (const url of [
    ROUTE,
    `${ROUTE}?sessionId=`,
    `${ROUTE}?sessionId=${encodeURIComponent('x'.repeat(201))}`,
  ]) {
    const response = await call(createReq('GET', { url }))
    assert.equal(response.status, 400, url)
    assert.equal(response.json.ok, false)
    assert.equal(response.json.error.code, 'invalid-session-id')
    assert.match(response.json.error.message, /会话/)
  }
})

test('GET permits authenticated same origin without CORS and rejects foreign origins', async () => {
  const allowed = await call(
    createReq('GET', {
      url: `${ROUTE}?sessionId=${SESSION_ID}`,
      headers: { origin: 'http://127.0.0.1:3080' },
    }),
  )
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers['access-control-allow-origin'], undefined)

  const denied = await call(
    createReq('GET', { url: `${ROUTE}?sessionId=${SESSION_ID}`, headers: { origin: 'https://evil.example' } }),
  )
  assert.equal(denied.status, 403)
  assert.equal(denied.json.error.code, 'forbidden')
  assert.match(denied.json.error.message, /来源/)
})

test('POST add stores the full wire record and answers with the annotation list', async () => {
  const sessionId = 'sess_add_full'
  const record = {
    id: 'ann_wire_1',
    style: 'underline',
    quote: '选中的整段文字',
    prefix: '前面的话',
    suffix: '后面的话',
    rootSelector: 'body > main',
    createdAt: '2026-11-03T02:20:00.000Z',
  }
  const response = await call(createReq('POST', { headers: jsonHeaders(), body: { action: 'add', sessionId, annotation: record } }))
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.added, true)
  assert.equal(response.json.annotations.length, 1)
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id') assert.notEqual(response.json.annotations[0][key], value)
    else assert.equal(response.json.annotations[0][key], value)
  }
  assert.deepEqual(response.json.annotation, response.json.annotations[0])
  assert.deepEqual(store.list(sessionId), response.json.annotations)
})

test('POST add defaults a missing id, createdAt and context hints', async () => {
  const sessionId = 'sess_add_defaults'
  const response = await call(
    createReq('POST', {
      headers: jsonHeaders(),
      body: { action: 'add', sessionId, annotation: { style: 'highlight', quote: '  只有文本  ' } },
    }),
  )
  assert.equal(response.status, 200)
  assert.equal(response.json.added, true)
  const annotation = response.json.annotations[0]
  assert.match(annotation.id, /^ann_/)
  assert.ok(!Number.isNaN(new Date(annotation.createdAt).getTime()))
  assert.equal(annotation.quote, '  只有文本  ')
  assert.equal(annotation.prefix, '')
  assert.equal(annotation.suffix, '')
  assert.equal(annotation.rootSelector, '')
})

test('POST add of an identical mark reports added:false without duplicating it', async () => {
  const sessionId = 'sess_add_duplicate'
  const request = createReq('POST', {
    headers: jsonHeaders(),
    body: {
      action: 'add',
      sessionId,
      annotation: { style: 'highlight', quote: '同一段', prefix: 'p', suffix: 's' },
    },
  })
  const first = await call(request)
  const second = await call(createReq('POST', {
    headers: jsonHeaders(),
    body: {
      action: 'add',
      sessionId,
      annotation: { style: 'highlight', quote: '同一段', prefix: 'p', suffix: 's' },
    },
  }))
  assert.equal(first.json.added, true)
  assert.equal(second.json.added, false)
  assert.equal(second.json.annotations.length, 1)
})

test('POST list, remove and clear keep sessions isolated', async () => {
  const sessionId = 'sess_flow'
  const otherId = 'sess_other'
  const addAnnotation = async quote =>
    call(
      createReq('POST', {
        headers: jsonHeaders(),
        body: { action: 'add', sessionId, annotation: { style: 'highlight', quote } },
      }),
    )

  await addAnnotation('第一条')
  await addAnnotation('第二条')
  await call(
    createReq('POST', {
      headers: jsonHeaders(),
      body: { action: 'add', sessionId: otherId, annotation: { style: 'underline', quote: '别处' } },
    }),
  )

  const listed = await call(
    createReq('POST', { headers: jsonHeaders(), body: { action: 'list', sessionId } }),
  )
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.json.annotations.map(annotation => annotation.quote), ['第一条', '第二条'])

  const other = await call(
    createReq('GET', { url: `${ROUTE}?sessionId=${encodeURIComponent(otherId)}` }),
  )
  assert.deepEqual(other.json.annotations.map(annotation => annotation.quote), ['别处'])

  const removed = await call(
    createReq('POST', {
      headers: jsonHeaders(),
      body: { action: 'remove', sessionId, ids: [listed.json.annotations[0].id, 'not-there'] },
    }),
  )
  assert.equal(removed.status, 200)
  assert.equal(removed.json.removed, 1)
  assert.deepEqual(removed.json.annotations.map(annotation => annotation.quote), ['第二条'])

  const cleared = await call(
    createReq('POST', { headers: jsonHeaders(), body: { action: 'clear', sessionId } }),
  )
  assert.equal(cleared.status, 200)
  assert.equal(cleared.json.removed, 1)
  assert.deepEqual(cleared.json.annotations, [])

  const emptied = await call(
    createReq('POST', { headers: jsonHeaders(), body: { action: 'list', sessionId } }),
  )
  assert.deepEqual(emptied.json.annotations, [])

  // No residue: neither the cleared nor the still-populated other session is empty.
  const onDisk = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
  assert.equal(Object.hasOwn(onDisk.sessions, sessionId), false)
  assert.equal(onDisk.sessions[otherId].annotations.length, 1)
})

test('POST rejects invalid payloads with 400 and Chinese messages', async () => {
  const cases = [
    {
      label: 'bad style',
      body: { action: 'add', sessionId: 'sess_bad', annotation: { style: 'sparkle', quote: 'x' } },
      code: 'invalid-annotation-style',
    },
    {
      label: 'empty quote',
      body: { action: 'add', sessionId: 'sess_bad', annotation: { style: 'highlight', quote: '   ' } },
      code: 'invalid-annotation-quote',
    },
    {
      label: 'missing annotation',
      body: { action: 'add', sessionId: 'sess_bad' },
      code: 'invalid-annotation',
    },
    {
      label: 'missing sessionId',
      body: { action: 'list' },
      code: 'invalid-session-id',
    },
    {
      label: 'ids not an array',
      body: { action: 'remove', sessionId: 'sess_bad', ids: 'nope' },
      code: 'invalid-ids',
    },
    {
      label: 'unknown action',
      body: { action: 'rename', sessionId: 'sess_bad' },
      code: 'invalid-action',
    },
    { label: 'array body', body: [], code: 'invalid-body' },
  ]
  for (const item of cases) {
    const response = await call(createReq('POST', { headers: jsonHeaders(), body: item.body }))
    assert.equal(response.status, 400, item.label)
    assert.equal(response.json.ok, false, item.label)
    assert.equal(response.json.error.code, item.code, item.label)
    assert.match(response.json.error.message, /[\u4e00-\u9fff]/, item.label)
  }

  const invalidJson = await call(createReq('POST', { headers: jsonHeaders(), body: '{not json' }))
  assert.equal(invalidJson.status, 400)
  assert.equal(invalidJson.json.error.code, 'invalid-json')

  const emptyBody = await call(createReq('POST', { headers: jsonHeaders() }))
  assert.equal(emptyBody.status, 400)
  assert.equal(emptyBody.json.error.code, 'invalid-json')
})

test('POST rejects oversized bodies with 413 and unsupported media with 415', async () => {
  const oversized = await call(
    createReq('POST', {
      headers: jsonHeaders(),
      body: 'x'.repeat(1025 * 1024),
    }),
  )
  assert.equal(oversized.status, 413)
  assert.equal(oversized.json.error.code, 'request-too-large')

  const text = await call(
    createReq('POST', {
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ action: 'list', sessionId: SESSION_ID }),
    }),
  )
  assert.equal(text.status, 415)
  assert.equal(text.json.error.code, 'unsupported-media-type')
})

test('unsupported methods answer 405 and foreign POST origins answer 403', async () => {
  const put = await call(createReq('PUT', { headers: { 'content-type': 'application/json' } }))
  assert.equal(put.status, 405)
  assert.equal(put.json.error.code, 'method-not-allowed')

  const foreign = await call(
    createReq('POST', {
      headers: jsonHeaders({ origin: 'https://evil.example' }),
      body: { action: 'list', sessionId: SESSION_ID },
    }),
  )
  assert.equal(foreign.status, 403)
  assert.equal(foreign.json.error.code, 'forbidden')
})

test('a broken body stream still resolves instead of rejecting', async () => {
  const res = createRes()
  await handler({ method: 'POST', headers: jsonHeaders(), url: ROUTE }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(JSON.parse(res.body).error.code, 'invalid-json')
})

// ------------------------------------------------- apply() wiring + tool

test('apply wires the route, the annotations tool, the prompt section and the pre-step listener', async () => {
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = path.join(tempRoot, 'apply-home')
  try {
    const registrations = []
    const routes = new Map()
    const tools = new Map()
    const sections = []
    const ctx = {
      connection,
      sessions: { get: () => ({}) },
      userQuestions: { ask: async () => ({ answers: [] }) },
      logger: { info() {}, warn() {} },
      effect(factory) {
        return factory()
      },
      webServer: {
        register(route) {
          registrations.push(route)
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
      tools: {
        register(definition) {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
      },
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => {}
        },
      },
      on(event, listener) {
        listeners.push({ event, listener })
      },
    }
    const listeners = []

    apply(ctx)

    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].kind, 'exact')
    assert.equal(registrations[0].path, ROUTE)
    assert.ok(fs.existsSync(path.join(process.env.DSH_HOME, 'annotations-hardened', 'state.json')))

    const routeHandler = routes.get(ROUTE)
    assert.equal(typeof routeHandler, 'function')

    const tool = tools.get(TOOL_NAME)
    assert.ok(tool, 'the annotations tool must register')
    assert.equal(TOOL_NAME, 'mindmark_annotations')
    assert.equal(tool.parameters.type, 'object')
    assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'resolve', 'reopen', 'delete', 'clear', 'set-mode', 'distill', 'lessons', 'forget', 'material'])
    assert.equal(tool.parameters.additionalProperties, false)
    assert.deepEqual(tool.presentCall({ action: 'delete', ids: ['a'] }), {
      card: 'generic',
      title: 'Annotations',
      kind: 'other',
      rawInput: { action: 'delete', ids: ['a'] },
    })
    assert.equal(tool.presentCall({}).rawInput.action, 'list')
    assert.equal(listeners.length, 1)
    assert.equal(listeners[0].event, 'agent/pre-step')

    const section = sections.find(item => item.name === SECTION_NAME)
    assert.ok(section, 'the annotations prompt section must register')
    assert.equal(SECTION_NAME, 'tool:mindmark_annotations')
    assert.equal(SECTION_ORDER, 9100)
    assert.equal(section.order, 9100)

    // No annotations (and no usable scope): the section disappears.
    assert.equal(section.text({ scope: { id: 'sess_apply' } }), '')
    assert.equal(section.text({}), '')
    assert.equal(section.text({ scope: undefined }), '')
    assert.equal(section.text({ scope: { id: 42 } }), '')

    // Client writes through the route the plugin registered.
    const added = await call(
      createReq('POST', {
        headers: jsonHeaders(),
        body: {
          action: 'add',
          sessionId: 'sess_apply',
          annotation: { style: 'highlight', quote: '被标记的重点' },
        },
      }),
      routeHandler,
    )
    assert.equal(added.status, 200)

    const text = section.text({ scope: { id: 'sess_apply' } })
    assert.match(text, /## 用户标注协议/)
    assert.match(text, /当前 1 条/)
    assert.match(text, /`mindmark_annotations` 工具/)
    assert.equal(section.text({ scope: { id: 'sess_other' } }), '', 'sessions stay isolated')

    // The tool reads the same document.
    const listed = await tool.execute({}, { agent: { id: 'sess_apply' } })
    assert.equal(listed.total, 1)
    assert.equal(listed.pending, 1)
    assert.equal(listed.mode, 'brief')
    const rendered = tool.output.render({}, listed)
    assert.equal(rendered[0].type, 'text')
    assert.match(rendered[0].text, /高亮（待处理）“被标记的重点”/)

    const emptyRender = tool.output.render({}, { action: 'list', total: 0, pending: 0, changed: [], annotations: [] })
    assert.match(emptyRender[0].text, /当前对话没有标注/)

    // resolve settles the annotation; the protocol section disappears; reopen brings it back.
    await assert.rejects(tool.execute({}, undefined), /对话/)
    const resolved = await tool.execute({ action: 'resolve' }, { agent: { id: 'sess_apply' } })
    assert.deepEqual(resolved.changed, [listed.annotations[0].id])
    assert.equal(resolved.pending, 0)
    assert.equal(resolved.annotations[0].resolvedBy, 'model')
    assert.equal(section.text({ scope: { id: 'sess_apply' } }), '')
    const reopened = await tool.execute({ action: 'reopen' }, { agent: { id: 'sess_apply' } })
    assert.equal(reopened.pending, 1)
    assert.match(section.text({ scope: { id: 'sess_apply' } }), /当前 1 条/)

    // set-mode is shared with the HTTP route.
    const moded = await tool.execute({ action: 'set-mode', mode: 'full' }, { agent: { id: 'sess_apply' } })
    assert.equal(moded.mode, 'full')
    await assert.rejects(tool.execute({ action: 'set-mode', mode: 'huge' }, { agent: { id: 'sess_apply' } }), /模式/)
    const viaRoute = await call(createReq('GET', { url: `${ROUTE}?sessionId=sess_apply` }), routeHandler)
    assert.equal(viaRoute.json.mode, 'full')

    // Delete / clear through the tool, including its validation errors.
    await assert.rejects(tool.execute({ action: 'delete' }, { agent: { id: 'sess_apply' } }), /id/)
    const deleted = await tool.execute(
      { action: 'delete', ids: [listed.annotations[0].id] },
      { agent: { id: 'sess_apply' } },
    )
    assert.equal(deleted.changed.length, 1)
    assert.equal(deleted.total, 0)
    assert.equal(section.text({ scope: { id: 'sess_apply' } }), '')

    await call(
      createReq('POST', {
        headers: jsonHeaders(),
        body: {
          action: 'add',
          sessionId: 'sess_apply',
          annotation: { style: 'underline', quote: '再标一条' },
        },
      }),
      routeHandler,
    )
    const cleared = await tool.execute({ action: 'clear' }, { agent: { id: 'sess_apply' } })
    assert.equal(cleared.changed.length, 1)
    assert.equal(cleared.total, 0)
    assert.match(tool.output.render({}, cleared)[0].text, /已清空 1 条标注/)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})
