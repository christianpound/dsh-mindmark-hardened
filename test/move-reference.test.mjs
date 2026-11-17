// v0.4: the `move` and `reference` marks — validation, storage of materials,
// the injection text and the `material` tool action.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { apply, ROUTE, TOOL_NAME } from '../index.js'
import { buildInjection, locateTarget, locateTargetPoint, renderFullMessage } from '../src/inject.js'
import {
  AnnotationStore,
  MATERIAL_INLINE_CHARS,
  MAX_MATERIAL_CHARS,
  validateAnnotationInput,
} from '../src/store.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mindmark-v04-'))
after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

let counter = 0
function tempStore() {
  counter += 1
  return new AnnotationStore(path.join(tempRoot, `store-${counter}`, 'state.json'), { logger: { warn() {} } })
}

const MESSAGE = '第一段：介绍背景。\n第二段：给出方案 A 和方案 B。\n第三段：结论是选 A。'
const CAPTURE = { key: 'node:7', text: MESSAGE, turn: 2 }

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

function moveToStart(quote, extra = {}) {
  // Move `quote` to the very beginning of the message.
  return anchored('move', quote, { targetPrefix: '', targetSuffix: MESSAGE.slice(0, 20), targetOffset: 0, ...extra })
}

// ------------------------------------------------------------- validation

test('move needs a target outside the moved passage', () => {
  assert.throws(() => validateAnnotationInput({ style: 'move', quote: 'x' }), /目标位置/)
  const start = MESSAGE.indexOf('结论是选 A')
  assert.throws(
    () => validateAnnotationInput(anchored('move', '结论是选 A', { targetPrefix: '第三段：', targetOffset: start })),
    /不能在被移动的文字里面/,
  )
  const record = validateAnnotationInput(moveToStart('结论是选 A。', { note: '先说结论' }))
  assert.equal(record.targetOffset, 0)
  assert.equal(record.targetPrefix, '')
  assert.equal(record.note, '先说结论')
  // Unanchored moves keep the context but drop the offset.
  const loose = validateAnnotationInput({ style: 'move', quote: 'q', targetSuffix: 'abc', targetOffset: 3 })
  assert.equal(loose.targetOffset, undefined)
  assert.equal(loose.targetSuffix, 'abc')
})

test('reference needs a material; urls and size are checked; other styles drop foreign fields', () => {
  assert.throws(() => validateAnnotationInput({ style: 'reference', quote: 'q' }), /参考材料/)
  assert.throws(
    () => validateAnnotationInput({ style: 'reference', quote: 'q', material: { kind: 'text', content: '  ' } }),
    /不能为空/,
  )
  assert.throws(
    () => validateAnnotationInput({ style: 'reference', quote: 'q', material: { kind: 'url', content: 'ftp://x' } }),
    /链接/,
  )
  assert.throws(
    () =>
      validateAnnotationInput({
        style: 'reference',
        quote: 'q',
        material: { kind: 'text', content: 'x'.repeat(MAX_MATERIAL_CHARS + 1) },
      }),
    /材料太长/,
  )
  const url = validateAnnotationInput({
    style: 'reference',
    quote: 'q',
    material: { kind: 'url', content: 'https://example.com/spec#3' },
  })
  assert.deepEqual(url.material, { kind: 'url', title: 'example.com', url: 'https://example.com/spec#3', length: 0, excerpt: '' })
  const text = validateAnnotationInput({
    style: 'reference',
    quote: 'q',
    material: { kind: 'text', title: '教材第 3 章', content: '定义：……' },
  })
  assert.equal(text.material.title, '教材第 3 章')
  assert.equal(text.material.length, '定义：……'.length)
  assert.equal(text.material.content, undefined, 'the record never carries the content')
  const plain = validateAnnotationInput({ style: 'highlight', quote: 'q', targetPrefix: 'a', material: { kind: 'text', content: 'x' } })
  assert.equal(plain.targetPrefix, undefined)
  assert.equal(plain.material, undefined)
})

// ---------------------------------------------------------------- storage

test('materials live in their own files and follow the annotation lifecycle', () => {
  const store = tempStore()
  const long = '材料正文。'.repeat(2000)
  const { annotation } = store.add(
    's1',
    anchored('reference', '给出方案 A 和方案 B', { note: '按材料口径改', material: { kind: 'file', title: 'spec.md', content: long } }),
    CAPTURE,
  )
  const file = store.materialPath('s1', annotation.id)
  assert.equal(fs.readFileSync(file, 'utf8'), long)
  const state = JSON.parse(fs.readFileSync(store.filePath, 'utf8'))
  assert.ok(!JSON.stringify(state).includes(long), 'state.json keeps only the excerpt')

  const first = store.material('s1', annotation.id)
  assert.equal(first.total, long.length)
  assert.equal(first.offset, 0)
  assert.equal(first.content.length, 8000)
  const second = store.material('s1', annotation.id, { offset: first.nextOffset })
  assert.equal(second.offset, 8000)
  assert.equal(store.material('s1', 'nope'), undefined)

  store.remove('s1', [annotation.id])
  assert.equal(fs.existsSync(file), false)

  const again = store.add('s1', anchored('reference', '介绍背景', { material: { kind: 'text', content: '短材料' } }), CAPTURE).annotation
  store.clear('s1')
  assert.equal(fs.existsSync(store.materialPath('s1', again.id)), false)
})

test('a re-marked reference takes the new material; orphans are swept on load', () => {
  const store = tempStore()
  const base = anchored('reference', '介绍背景', { material: { kind: 'text', title: 't', content: '旧' } })
  const first = store.add('s1', base, CAPTURE).annotation
  const second = store.add('s1', { ...base, material: { kind: 'text', title: 't', content: '新的材料' } }, CAPTURE)
  assert.equal(second.deduped, true)
  assert.equal(fs.readFileSync(store.materialPath('s1', first.id), 'utf8'), '新的材料')
  assert.equal(store.list('s1')[0].material.length, 4)

  fs.writeFileSync(path.join(store.materialsDir, 'orphan.txt'), 'x')
  const reopened = new AnnotationStore(store.filePath, { logger: { warn() {} } })
  assert.equal(fs.existsSync(path.join(store.materialsDir, 'orphan.txt')), false)
  assert.equal(reopened.list('s1')[0].material.title, 't')
})

test('snapshot carries only short materials whole', () => {
  const store = tempStore()
  const short = store.add('s1', anchored('reference', '介绍背景', { material: { kind: 'text', content: '短' } }), CAPTURE).annotation
  const longText = 'x'.repeat(MATERIAL_INLINE_CHARS + 1)
  const long = store.add('s1', anchored('reference', '结论是选 A', { material: { kind: 'text', content: longText } }), CAPTURE).annotation
  const snapshot = store.snapshot('s1')
  assert.equal(snapshot.materials[short.id], '短')
  assert.equal(snapshot.materials[long.id], undefined)
})

// -------------------------------------------------------------- injection

test('brief mode describes where a move goes and inlines short materials', () => {
  const store = tempStore()
  store.add('s1', moveToStart('结论是选 A。', { note: '先说结论' }), CAPTURE)
  store.add('s1', anchored('reference', '给出方案 A 和方案 B', { note: '以材料为准', material: { kind: 'text', title: '评审意见', content: '方案 B 已被否决。' } }), CAPTURE)
  store.add('s1', anchored('reference', '介绍背景', { material: { kind: 'url', content: 'https://example.com/a' } }), CAPTURE)
  const text = buildInjection(store.snapshot('s1'), { turn: 3 })
  assert.match(text, /移动：“结论是选 A。”/)
  assert.match(text, /移到：开头，在“第一段：介绍背景。/)
  assert.match(text, /理由：先说结论/)
  assert.match(text, /材料《评审意见》（粘贴的文本，共 10 字）/)
  assert.match(text, /方案 B 已被否决。/)
  assert.match(text, /用户要求：以材料为准/)
  assert.match(text, /材料（链接）：https:\/\/example\.com\/a/)
  assert.match(text, /只改被标注的这一段/)
})

test('long materials are excerpted with a pointer to the material action', () => {
  const store = tempStore()
  const long = '条款'.repeat(2000)
  const { annotation } = store.add('s1', anchored('reference', '介绍背景', { material: { kind: 'file', title: 'law.txt', content: long } }), CAPTURE)
  const text = buildInjection(store.snapshot('s1'))
  assert.match(text, /开头摘录/)
  assert.ok(text.includes(`action=material、ids=["${annotation.id}"]`))
  assert.ok(!text.includes(long))
})

test('full mode marks both ends of a move and appends materials', () => {
  const store = tempStore()
  store.setMode('s1', 'full')
  store.add('s1', moveToStart('结论是选 A。'), CAPTURE)
  store.add('s1', anchored('reference', '给出方案 A 和方案 B', { material: { kind: 'text', title: '评审意见', content: '方案 B 已被否决。' } }), CAPTURE)
  const text = buildInjection(store.snapshot('s1'))
  const view = text.slice(text.indexOf('（修订视图'))
  // The insertion marker comes first (offset 0), the source marker at the end.
  assert.ok(view.indexOf('[[#2 移入此处]]') < view.indexOf('[[#2 移动：结论是选 A。'))
  assert.match(text, /\[\[#1 依据：给出方案 A 和方案 B ‖ 按文末材料 #1 改这一段\]\]/)
  assert.match(text, /### 用户附的参考材料/)
  assert.match(text, /材料 #1（对应标注 id /)
})

test('locateTargetPoint falls back to the saved context and refuses points inside the passage', () => {
  const offset = MESSAGE.indexOf('第三段')
  const annotation = { targetPrefix: '方案 B。\n', targetSuffix: '第三段：结论', targetOffset: 999 }
  assert.equal(locateTargetPoint(MESSAGE, annotation), offset)
  assert.equal(locateTargetPoint(MESSAGE, { targetPrefix: 'zzz', targetSuffix: 'yyy' }), undefined)
  const start = MESSAGE.indexOf('方案 A 和')
  const inside = {
    ...anchored('move', '给出方案 A 和方案 B'),
    targetPrefix: '给出',
    targetSuffix: '方案 A',
    targetOffset: start,
  }
  const rendered = renderFullMessage(MESSAGE, [inside])
  assert.ok(!rendered.text.includes('移入此处'))
  assert.match(rendered.text, /移到“…给出”与“方案 A…”之间/)
})

// ------------------------------------------------------------------ tool

test('the material tool action reads chunks and the HTTP add accepts a material', async () => {
  const home = path.join(tempRoot, 'home')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes = new Map()
  const tools = new Map()
  const peer = { principal: { kind: 'owner' } }
  try {
    apply({
      connection: { browserPeer: peer, admit: () => ({ peer }) },
      sessions: { get: () => ({}) },
      userQuestions: { ask: async () => ({ answers: [] }) },
      logger: { info() {}, warn() {} },
      effect: run => run(),
      on() {},
      webServer: { register: ({ path: route, handler }) => routes.set(route, handler) },
      tools: { register: tool => tools.set(tool.name, tool) },
      systemPrompt: { section() {} },
    })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
  const handler = routes.get(ROUTE)
  const body = JSON.stringify({
    action: 'add',
    sessionId: 'sess_ref',
    annotation: { style: 'reference', quote: '这一段', note: '按材料改', material: { kind: 'text', title: '讲义', content: '甲'.repeat(9000) } },
  })
  const response = await new Promise(resolve => {
    const chunks = [Buffer.from(body)]
    const req = {
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json', host: '127.0.0.1:3080', 'x-dsh-mindmark': '1' },
      async *[Symbol.asyncIterator]() {
        yield* chunks
      },
    }
    const res = {
      status: 0,
      writeHead(status) {
        this.status = status
      },
      end(payload) {
        resolve({ status: this.status, json: JSON.parse(payload) })
      },
    }
    handler(req, res)
  })
  assert.equal(response.status, 200)
  const added = response.json.annotations[0]
  assert.equal(added.material.length, 9000)
  assert.equal(added.material.excerpt.length, 600)

  const tool = tools.get(TOOL_NAME)
  const exec = { agent: { id: 'sess_ref' } }
  const first = await tool.execute({ action: 'material' }, exec)
  assert.equal(first.materials.length, 1)
  assert.equal(first.materials[0].nextOffset, 8000)
  const rest = await tool.execute({ action: 'material', ids: [added.id], offset: 8000 }, exec)
  assert.equal(rest.materials[0].content.length, 1000)
  assert.equal(rest.materials[0].nextOffset, -1)
  const rendered = tool.output.render({ action: 'material' }, first)[0].text
  assert.match(rendered, /材料《讲义》第 1–8000 字（共 9000 字）/)
  assert.match(rendered, /offset=8000/)
  const listed = tool.output.render({ action: 'list' }, await tool.execute({ action: 'list' }, exec))[0].text
  assert.match(listed, /依据（待处理）“这一段”｜材料《讲义》9000 字｜要求：按材料改/)
})

test('brief context comes from the captured message, not the page around it', () => {
  const store = tempStore()
  store.add('s1', anchored('highlight', '方案 A 和方案 B', { prefix: '思考过程的残片……给出', suffix: '。用量 12.7K tok' }), CAPTURE)
  const text = buildInjection(store.snapshot('s1'))
  assert.ok(!text.includes('思考过程'))
  assert.ok(!text.includes('用量'))
  assert.match(text, /上下文：…第一段：介绍背景。 第二段：给出【方案 A 和方案 B】。 第三段：结论是选 A。…/)
})

test('a move onto selected text replaces it; overlaps are refused', () => {
  const source = '结论是选 A。'
  const replaced = '介绍背景'
  const at = MESSAGE.indexOf(replaced)
  const raw = anchored('move', source, {
    targetPrefix: MESSAGE.slice(0, at),
    targetQuote: replaced,
    targetSuffix: MESSAGE.slice(at + replaced.length, at + replaced.length + 20),
    targetOffset: at,
    targetEnd: at + replaced.length,
  })
  const record = validateAnnotationInput(raw)
  assert.equal(record.targetQuote, replaced)
  assert.equal(record.targetEnd, at + replaced.length)
  const s = MESSAGE.indexOf('结论')
  assert.throws(
    () => validateAnnotationInput(anchored('move', source, { targetQuote: '第三段：结论', targetOffset: s - 4, targetEnd: s + 2 })),
    /重叠/,
  )
  assert.deepEqual(locateTarget(MESSAGE, record), { start: at, end: at + replaced.length })
  // stale offset: falls back to the saved context
  assert.deepEqual(locateTarget(MESSAGE, { ...record, targetOffset: 3 }), { start: at, end: at + replaced.length })

  const store = tempStore()
  store.setMode('s1', 'full')
  store.add('s1', raw, CAPTURE)
  const full = buildInjection(store.snapshot('s1'))
  assert.match(full, /\[\[#1 移入此处并替换：介绍背景\]\]/)
  assert.ok(!full.includes('第一段：介绍背景'), 'the replaced text is inside the marker')
  assert.match(full, /移到 \[\[#1 移入此处并替换\]\] 标出的位置，替换掉那里的文字/)
  store.setMode('s1', 'brief')
  const brief = buildInjection(store.snapshot('s1'))
  assert.match(brief, /移到：替换掉“介绍背景”（它前面是“…第一段：”）/)

  // the same move to a different target is a different mark
  const second = store.add('s1', { ...raw, targetQuote: undefined, targetEnd: undefined, targetSuffix: MESSAGE.slice(at, at + 20) }, CAPTURE)
  assert.equal(second.deduped, false)
  assert.equal(second.annotation.targetQuote, undefined)
})
