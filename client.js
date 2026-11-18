// dsh-mindmark — Web client half.
//
// Contributions:
//   • `conversation.chat.text-interaction` (keyed, session-scoped): the Word-like
//     action bar that the Chat view places next to a text selection. We register
//     under the built-in `quote` key with a lower priority (so the bar replaces
//     the plain Quote button and keeps Quote as its first action), plus our own
//     `dsh-mindmark` interaction for hosts where the Quote plugin is absent.
//   • `conversation.input.left` (session list): the brief/full injection-mode
//     switch beside the composer controls, with a pending-count badge.
//   • `conversation.session.header.utilities` (session list): marker icon +
//     count; toggles the annotation panel.
//   • `shell.overlay` (root list): the annotation panel, the move banner and
//     the reference form. The reference form lives here rather than in the
//     selection bar because the Chat view dismisses its bar whenever the window
//     loses focus, and a native file dialog takes the focus away.
//
// Moving a passage works like cut and paste: Alt+C (or the toolbar's Move)
// picks up the selection, a click inside the same answer puts a blinking caret
// where it goes (the passage is inserted right after the caret; dragging over
// some text instead makes the passage replace that text), Alt+V (or the
// banner's button) drops it there, Esc cancels. Alt is the only
// modifier that neither clashes with typing (Shift) nor stays invisible to the
// page (Fn); Harness itself binds no Alt+C / Alt+V.
//
// Annotations are text anchors, never host-DOM references: the selection is
// converted into character offsets within its session-owned message, stored as
// a quote + prefix/suffix + CSS path record on the Host, and re-anchored by
// scoring every `indexOf(quote)` candidate against the saved context. The same
// selection is also located inside its message body so the Host can render a
// full revision view. Painting uses the CSS Custom Highlight API, so no DOM
// inside messages is ever mutated.
//
// Everything is plain ES5-flavoured JavaScript with `React.createElement`; no
// Harness Client packages are imported, all chrome follows the `--dsw-alias-*`
// theme tokens and everything is namespaced under the `dsa-` class prefix.

window.__ModuleLoader__.load({
  id: '@local/dsh-mindmark-hardened',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useState = React.useState
    var useRef = React.useRef
    var useSyncExternalStore = React.useSyncExternalStore

    // Each mounted session owns its state, promises, drafts and DOM bindings.
    function createSessionRuntime(ownerSessionId, runtimeId, locale) {
    var disposedRuntime = false
    // Verified ConversationRoot boundary: data-conversation-session encloses
    // the chat Views and composer. Missing boundaries fail closed.
    function ownsBody(body) {
      var seat = body && typeof body.closest === 'function' ? body.closest('[data-conversation-session]') : null
      return !!seat && seat.getAttribute('data-conversation-session') === ownerSessionId
    }
    var ROUTE = '/plugins/dsh-mindmark-hardened/annotations'
    var UI_ATTR = 'data-dsh-mindmark-ui'
    var UI_SELECTOR = '[' + UI_ATTR + ']'
    var CSS_ID = 'dsh-mindmark'
    var STYLES = ['highlight', 'underline', 'strike', 'comment', 'rewrite', 'move', 'reference']
    // First toolbar row: one click and done. Second row: needs your input.
    var QUICK_STYLES = ['highlight', 'underline', 'strike']
    var INPUT_STYLES = ['comment', 'rewrite', 'reference', 'move']
    var NOTE_STYLES = { comment: true, rewrite: true }
    var MATERIAL_KINDS = ['text', 'url', 'file']
    var MAX_MATERIAL = 200000
    var MAX_MATERIAL_FILE_BYTES = 4 * 1024 * 1024
    var MATERIAL_FILE_ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.yaml,.yml,.log,.tex,.rst,.srt,text/*'
    var MOVE_EXTRA_HIGHLIGHTS = ['dsa-move-pending', 'dsa-move-replace', 'dsa-ref-pending']
    var CARET_LAYER_ID = 'dsa-caret-layer-' + runtimeId
    var MODES = ['brief', 'full']
    var MAX_QUOTE = 2000
    var MAX_NOTE = 2000
    var MAX_MESSAGE_TEXT = 20000
    var CONTEXT_MAX = 80
    var SELECTOR_MAX = 300
    var ID_MAX = 120
    var MUTATION_DEBOUNCE = 150
    var STATE_REPAINT_DELAY = 60
    var PANEL_TITLE_ID = 'dsa-annotate-panel-title-' + runtimeId
    var SURFACE_KEY = 'dsh-mindmark'

    // ------------------------------------------------------------- dictionaries

    var DICT = {
      zh: {
        headerLabel: '标注',
        headerTitle: '标注 · {count} 条待处理',
        panelTitle: '我的标注',
        toolbarLabel: '标注操作',
        count: '{count} 条',
        pendingCount: '{count} 条待处理',
        quote: '引用',
        highlight: '高亮',
        underline: '下划线',
        strike: '删除',
        comment: '批注',
        rewrite: '改写',
        'hint.highlight': '这是我要的：保留并强化',
        'hint.underline': '这里不够：展开或给依据',
        'hint.strike': '去掉：下一版不要出现',
        'hint.comment': '写一条意见，让助手按它处理',
        'hint.rewrite': '把这段改成你要的样子',
        'hint.quote': '把选中的文字引用到输入框',
        move: '移动',
        reference: '依据',
        'hint.move': '把这段挪到别处：Alt+C 拿起，在同一条回答里点一下目标位置，Alt+V 放下',
        'hint.reference': '给这段挂参考材料，让助手只按材料改这一段',
        moveBanner: '移动「{quote}」',
        moveHowTo: '在同一条回答里点一下要放的位置（拖选一段则替换那段），再按 Alt+V 或点「放到这里」；Esc 取消',
        moveReady: '放在闪烁竖线之后：…{before}▮{after}…',
        moveReplaceReady: '替换选中的「{quote}」',
        moveOverlap: '被替换的文字不能和被移动的文字重叠',
        movePlaceReplace: '移到这里替换',
        moveReplaceLabel: '替换',
        moveNoTarget: '还没选位置：先在同一条回答里点一下要放的地方',
        moveOtherMessage: '只能移到同一条回答里',
        moveSamePlace: '目标位置在被移动的文字里面或就在原处，换一个地方',
        moveUnanchored: '这段文字不在某一条回答里，没法移动',
        movePlace: '放到这里',
        moveReasonPlaceholder: '理由（可选）',
        moveTargetLabel: '移到',
        reasonLabel: '理由',
        requirementLabel: '要求',
        materialLabel: '材料',
        refTabText: '粘贴文本',
        refTabUrl: '链接',
        refTabFile: '文件',
        refTitlePlaceholder: '材料名称（可选），如：教材第 3 章',
        refTextPlaceholder: '把参考材料粘贴在这里…',
        refUrlPlaceholder: 'https://…',
        refFileChoose: '选择文件',
        refFileNone: '还没选文件',
        refFileHint: '支持 txt、md、csv、json、html 等纯文本；PDF、Word 请先复制文字再粘贴',
        refNotePlaceholder: '要求（可选），如：按材料的口径改写这一段，其余不动',
        refTooLong: '材料太长（最多 {max} 字），只保留和这一段相关的部分',
        refFileError: '读不了这个文件，请改为粘贴文本',
        refBadUrl: '链接要以 http:// 或 https:// 开头',
        chars: '{count} 字',
        unmark: '清除标记',
        close: '关闭',
        delete: '删除',
        clearAll: '清空全部',
        resolve: '标为已处理',
        reopen: '重新提交',
        resolveAll: '全部标为已处理',
        confirm: '确定',
        cancel: '取消',
        commentPlaceholder: '写下你的意见…',
        rewritePlaceholder: '改成…',
        statusPending: '待处理',
        statusResolved: '已处理',
        byModel: '助手已处理',
        byUser: '你已处理',
        byCap: '多轮未处理，已自动收起',
        noteLabel: '批注',
        rewriteLabel: '改为',
        modeLabel: '标注注入',
        modeBrief: '精简',
        modeFull: '完整',
        modeBriefHint: '精简：下一轮只发送被标注的段落和少量上下文',
        modeFullHint: '完整：下一轮发送整条回答的修订视图',
        modeTitle: '标注如何送给助手',
        loading: '加载中…',
        empty: '还没有标注。在回答里选中文字，工具条会浮出来。',
        footerHint: '待处理的标注会在下一轮自动送给助手；助手处理后会标为已处理。',
        distill: '沉淀为习惯',
        distillHint: '让助手把这些标注归纳成长期偏好，写进你的全局 AGENTS.md，新对话自动遵守',
        distillPrompt: '请回顾我在这个对话里做过的全部标注（用 mindmark_annotations 工具 action=list 查看），归纳出我反复表现出的偏好，每条一句、可直接执行、不要带具体内容，然后用 mindmark_annotations 工具 action=distill 把它们写入 lessons。写完后把沉淀的偏好列给我看。',
        lessonsTitle: '已沉淀的偏好',
        lessonsEmpty: '还没有沉淀过偏好。标注积累几条后，点「沉淀为习惯」让助手归纳。',
        forget: '移除',
        warning: '当前浏览器不支持 CSS Custom Highlight API：标注仍会保存，但不会显示在页面上。',
        'err.generic': '操作失败，请稍后重试。',
        'err.network': '无法连接到 Harness，标注没有保存。',
        'err.http': '标注服务返回了错误。',
        'err.load': '加载标注失败。',
        'err.add': '保存标注失败。',
        'err.remove': '删除标注失败。',
        'err.clear': '清空标注失败。',
        'err.resolve': '更新标注状态失败。',
        'err.mode': '切换模式失败。',
        'err.invalid': '标注数据不完整，没有保存。',
      },
      en: {
        headerLabel: 'Annotations',
        headerTitle: 'Annotations · {count} pending',
        panelTitle: 'My annotations',
        toolbarLabel: 'Annotate selection',
        count: '{count}',
        pendingCount: '{count} pending',
        quote: 'Quote',
        highlight: 'Highlight',
        underline: 'Underline',
        strike: 'Strike',
        comment: 'Comment',
        rewrite: 'Rewrite',
        'hint.highlight': 'This is what I want: keep and strengthen it',
        'hint.underline': 'Not enough here: expand or justify',
        'hint.strike': 'Drop this next time',
        'hint.comment': 'Leave a note the assistant must act on',
        'hint.rewrite': 'Replace this passage with your own words',
        'hint.quote': 'Quote the selection into the composer',
        move: 'Move',
        reference: 'Source',
        'hint.move': 'Move this passage: Alt+C picks it up, click the target spot in the same answer, Alt+V drops it',
        'hint.reference': 'Attach reference material; the assistant revises only this passage to match it',
        moveBanner: 'Move "{quote}"',
        moveHowTo: 'Click where it should go in the same answer (drag over text to replace it), then press Alt+V or "Drop here"; Esc cancels',
        moveReady: 'Goes right after the blinking caret: …{before}▮{after}…',
        moveReplaceReady: 'Replaces the selected "{quote}"',
        moveOverlap: 'The replaced text cannot overlap the passage being moved',
        movePlaceReplace: 'Replace with it',
        moveReplaceLabel: 'Replaces',
        moveNoTarget: 'No target yet: click the spot in the same answer first',
        moveOtherMessage: 'A passage can only move within the same answer',
        moveSamePlace: 'The target is inside the passage or where it already is; pick another spot',
        moveUnanchored: 'This text is not part of an answer and cannot be moved',
        movePlace: 'Drop here',
        moveReasonPlaceholder: 'Why (optional)',
        moveTargetLabel: 'Move to',
        reasonLabel: 'Why',
        requirementLabel: 'Ask',
        materialLabel: 'Material',
        refTabText: 'Paste text',
        refTabUrl: 'Link',
        refTabFile: 'File',
        refTitlePlaceholder: 'Material name (optional), e.g. Textbook ch. 3',
        refTextPlaceholder: 'Paste the reference material here…',
        refUrlPlaceholder: 'https://…',
        refFileChoose: 'Choose file',
        refFileNone: 'No file chosen',
        refFileHint: 'Plain-text files (txt, md, csv, json, html…); for PDF or Word, copy the text and paste it',
        refNotePlaceholder: 'Instruction (optional), e.g. rewrite this passage to match the material',
        refTooLong: 'Material too long (max {max} characters); keep only the relevant part',
        refFileError: 'Could not read this file; paste the text instead',
        refBadUrl: 'The link must start with http:// or https://',
        chars: '{count} chars',
        unmark: 'Remove marks',
        close: 'Close',
        delete: 'Delete',
        clearAll: 'Clear all',
        resolve: 'Mark handled',
        reopen: 'Send again',
        resolveAll: 'Mark all handled',
        confirm: 'OK',
        cancel: 'Cancel',
        commentPlaceholder: 'Your note…',
        rewritePlaceholder: 'Replace with…',
        statusPending: 'Pending',
        statusResolved: 'Handled',
        byModel: 'Handled by the assistant',
        byUser: 'Handled by you',
        byCap: 'Auto-settled after several turns',
        noteLabel: 'Note',
        rewriteLabel: 'Replace with',
        modeLabel: 'Annotation feed',
        modeBrief: 'Brief',
        modeFull: 'Full',
        modeBriefHint: 'Brief: next turn sends only the annotated passages with a little context',
        modeFullHint: 'Full: next turn sends the whole answer as a revision view',
        modeTitle: 'How annotations reach the assistant',
        loading: 'Loading…',
        empty: 'No annotations yet. Select text in an answer and the toolbar appears.',
        footerHint: 'Pending annotations are sent to the assistant on the next turn; it marks them handled afterwards.',
        distill: 'Keep as habit',
        distillHint: 'Ask the assistant to distill these annotations into long-term preferences in your global AGENTS.md',
        distillPrompt: 'Review every annotation I made in this conversation (use the mindmark_annotations tool with action=list), distill the preferences I keep showing into one actionable sentence each without specific content, then write them with the mindmark_annotations tool action=distill in lessons. Show me the distilled list afterwards.',
        lessonsTitle: 'Distilled preferences',
        lessonsEmpty: 'Nothing distilled yet. After a few annotations, click "Keep as habit" to let the assistant summarize them.',
        forget: 'Remove',
        warning: 'This browser does not support the CSS Custom Highlight API: annotations are still saved but will not be painted.',
        'err.generic': 'Something went wrong. Try again.',
        'err.network': 'Could not reach the Harness; the annotation was not saved.',
        'err.http': 'The annotation service returned an error.',
        'err.load': 'Could not load annotations.',
        'err.add': 'Could not save the annotation.',
        'err.remove': 'Could not delete the annotation.',
        'err.clear': 'Could not clear annotations.',
        'err.resolve': 'Could not update the annotation.',
        'err.mode': 'Could not switch the mode.',
        'err.invalid': 'The annotation data was incomplete and was not saved.',
      },
    }

    // ---------------------------------------------------------------- locale

    var fallbackLocale = {
      subscribe: function () {
        return function () {}
      },
      getSnapshot: function () {
        return { active: 'en', revision: 0 }
      },
    }
    var localeService = fallbackLocale

    function subscribeLocale(listener) {
      try {
        if (localeService && typeof localeService.subscribe === 'function') return localeService.subscribe(listener)
      } catch (error) {
        console.error('dsh-mindmark: locale subscribe failed', error)
      }
      return function () {}
    }

    function localeRevision() {
      try {
        var snapshot = localeService.getSnapshot()
        if (snapshot && typeof snapshot.revision === 'number') return snapshot.revision
        if (snapshot && typeof snapshot.active === 'string') return snapshot.active
      } catch (error) {
        /* fall through */
      }
      return 'default'
    }

    function useLocaleRevision() {
      return useSyncExternalStore(subscribeLocale, localeRevision, localeRevision)
    }

    function translate(key, vars) {
      var active = 'en'
      try {
        var snapshot = localeService.getSnapshot()
        if (snapshot && typeof snapshot.active === 'string') active = snapshot.active
      } catch (error) {
        active = 'en'
      }
      var dict = String(active).toLowerCase().indexOf('zh') === 0 ? DICT.zh : DICT.en
      var value = dict[key]
      if (value === undefined) value = DICT.en[key]
      if (value === undefined) value = key
      if (vars && typeof value === 'string') {
        return value.replace(/\{(\w+)\}/g, function (match, name) {
          return vars[name] !== undefined ? String(vars[name]) : match
        })
      }
      return value
    }

    function WithTranslate(component) {
      return function Translated(props) {
        useLocaleRevision()
        var next = {}
        for (var key in props) next[key] = props[key]
        next.t = translate
        return h(component, next)
      }
    }

    // ------------------------------------------------------------------ styles

    var MARK_COLORS = {
      highlight: { pending: 'background-color:#f5c542;color:#1b1b1f', resolved: 'background-color:color-mix(in srgb,#f5c542 45%,transparent)' },
      underline: {
        pending: 'text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;text-decoration-color:#4d7cfe',
        resolved: 'text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:2px;text-decoration-color:color-mix(in srgb,#4d7cfe 45%,transparent)',
      },
      strike: {
        pending: 'text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:#e5484d;background-color:color-mix(in srgb,#e5484d 14%,transparent)',
        resolved: 'text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:color-mix(in srgb,#e5484d 50%,transparent)',
      },
      comment: {
        pending: 'background-color:color-mix(in srgb,#2fb36f 24%,transparent);text-decoration:underline dotted;text-decoration-color:#2fb36f;text-underline-offset:2px',
        resolved: 'text-decoration:underline dotted;text-decoration-color:color-mix(in srgb,#2fb36f 55%,transparent);text-underline-offset:2px',
      },
      rewrite: {
        pending: 'background-color:color-mix(in srgb,#a06bff 22%,transparent);text-decoration:line-through;text-decoration-color:#a06bff',
        resolved: 'text-decoration:line-through;text-decoration-color:color-mix(in srgb,#a06bff 50%,transparent)',
      },
      move: {
        pending: 'background-color:color-mix(in srgb,#ff8a3d 20%,transparent);text-decoration:underline dashed;text-decoration-thickness:2px;text-underline-offset:3px;text-decoration-color:#ff8a3d',
        resolved: 'text-decoration:underline dashed;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,#ff8a3d 50%,transparent)',
      },
      reference: {
        pending: 'background-color:color-mix(in srgb,#19b5c9 20%,transparent);text-decoration:underline double;text-underline-offset:3px;text-decoration-color:#19b5c9',
        resolved: 'text-decoration:underline double;text-underline-offset:3px;text-decoration-color:color-mix(in srgb,#19b5c9 50%,transparent)',
      },
    }

    function highlightName(style, status) {
      return 'dsa-' + style + (status === 'resolved' ? '-resolved' : '')
    }

    var CSS_LINES = [
      '[data-dsh-mindmark-ui]{box-sizing:border-box}',
      '[data-dsh-mindmark-ui] *{box-sizing:border-box}',
      '.dsa-header-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:4px;',
      'height:26px;min-width:26px;padding:0 6px;border:1px solid transparent;border-radius:7px;background:transparent;',
      'color:var(--dsw-alias-label-secondary,#a3a8b4);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
      '.dsa-header-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#343844);color:var(--dsw-alias-label-primary,#f2f4f7)}',
      '.dsa-header-btn.is-active{color:var(--dsw-alias-brand-primary,#4d7cfe);background:var(--dsw-alias-interactive-bg-hover,#343844)}',
      '.dsa-header-btn:focus-visible,.dsa-tool-btn:focus-visible,.dsa-tool-close:focus-visible,.dsa-panel-close:focus-visible,',
      '.dsa-item-btn:focus-visible,.dsa-btn:focus-visible,.dsa-mode-btn:focus-visible,.dsa-note-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d7cfe);outline-offset:1px}',
      '.dsa-header-btn svg{display:block;flex:none}',
      '.dsa-header-badge{min-width:15px;height:15px;padding:0 4px;border-radius:999px;',
      'background:var(--dsw-alias-brand-primary,#4d7cfe);color:var(--dsw-alias-label-primary-foreground,#10131a);',
      'font-size:10px;line-height:15px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}',
      // selection action bar (rendered inside the Chat view's own surface)
      '.dsa-toolbar{display:flex;align-items:center;gap:2px;padding:4px;',
      'border-radius:10px;background:var(--dsw-alias-button-floating-fill,var(--dsw-alias-bg-overlay,#2a2d36));',
      'border:1px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1,#3b3f4a));',
      'box-shadow:var(--dsw-elevation-panel,0 10px 28px rgba(0,0,0,.32));color:var(--dsw-alias-label-primary,#f2f4f7);',
      'font-family:inherit;font-size:13px;line-height:1;white-space:nowrap;pointer-events:auto}',
      '.dsa-toolbar.is-note{flex-direction:column;align-items:stretch;gap:6px;padding:8px;white-space:normal;min-width:260px;max-width:min(420px,80vw)}',
      '.dsa-tool-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:0;border-radius:7px;',
      'background:transparent;color:inherit;font:inherit;font-size:12.5px;line-height:1;cursor:pointer;white-space:nowrap}',
      '.dsa-tool-btn:hover{background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-interactive-bg-hover,#343844))}',
      '.dsa-tool-glyph{width:10px;height:10px;flex:none;border-radius:2px}',
      '.dsa-tool-glyph-highlight{background:#f5c542}',
      '.dsa-tool-glyph-underline{height:9px;border-radius:0;border-bottom:2px solid #4d7cfe}',
      '.dsa-tool-glyph-strike{height:9px;border-radius:0;background:linear-gradient(transparent 40%,#e5484d 40%,#e5484d 60%,transparent 60%)}',
      '.dsa-tool-glyph-comment{border-radius:50%;background:#2fb36f}',
      '.dsa-tool-glyph-rewrite{background:#a06bff}',
      '.dsa-tool-glyph-quote{width:9px;height:9px;border-left:3px solid var(--dsw-alias-label-secondary,#a3a8b4);border-radius:0}',
      '.dsa-tool-glyph-move{width:12px;height:9px;border-radius:0;border-bottom:2px dashed #ff8a3d}',
      '.dsa-tool-glyph-reference{border:2px solid #19b5c9;background:transparent}',
      '.dsa-toolbar.is-rows{flex-direction:column;align-items:stretch;gap:2px}',
      '.dsa-tool-row{display:flex;align-items:center;gap:2px}',
      '.dsa-kbd{margin-left:1px;padding:0 3px;border-radius:3px;border:1px solid var(--dsw-alias-border-l1,#3b3f4a);',
      'font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8a8f9c)}',
      '.dsa-toolbar.is-ref{min-width:320px;max-width:min(460px,86vw)}',
      '.dsa-ref-dialog{position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:71;width:min(460px,calc(100vw - 32px));',
      'max-height:calc(100vh - 180px);overflow-y:auto;animation:dsa-panel-in 140ms ease-out}',
      '.dsa-ref-file input[type=file]{display:none}',
      '.dsa-ref-tabs{display:inline-flex;gap:2px;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,#343844);align-self:flex-start}',
      '.dsa-ref-tab{height:22px;padding:0 9px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#a3a8b4);',
      'font:inherit;font-size:12px;line-height:1;cursor:pointer}',
      '.dsa-ref-tab.is-on{background:var(--dsw-alias-bg-overlay,#2a2d36);color:var(--dsw-alias-label-primary,#f2f4f7);box-shadow:0 1px 2px rgba(0,0,0,.25)}',
      '.dsa-ref-line,.dsa-move-reason{height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#3b3f4a);',
      'background:var(--dsw-alias-bg-layer-1,#20232b);color:var(--dsw-alias-label-primary,#f2f4f7);font:inherit;font-size:13px}',
      '.dsa-ref-line{width:100%}',
      '.dsa-ref-meta{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a8f9c)}',
      '.dsa-ref-file{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#a3a8b4)}',
      '.dsa-ref-file span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsa-ref-file input{display:none}',
      '.dsa-ref-error{margin:0;font-size:11.5px;line-height:16px;color:var(--dsw-alias-state-error-primary,#ff6b6b)}',
      '.dsa-note-input.is-small{min-height:40px}',
      '.dsa-ref-tab:focus-visible,.dsa-ref-line:focus-visible,.dsa-move-reason:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d7cfe);outline-offset:1px}',
      '.dsa-tool-divider{width:1px;height:16px;margin:0 2px;flex:none;background:var(--dsw-alias-border-l1,#3b3f4a)}',
      '.dsa-tool-close{width:26px;height:26px;padding:0;display:inline-grid;place-items:center;border:0;border-radius:7px;',
      'background:transparent;color:var(--dsw-alias-label-secondary,#a3a8b4);font:inherit;font-size:15px;line-height:1;cursor:pointer}',
      '.dsa-tool-close:hover{color:var(--dsw-alias-label-primary,#f2f4f7);background:var(--dsw-alias-interactive-bg-hover,#343844)}',
      '.dsa-note-head{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a3a8b4)}',
      '.dsa-note-quote{margin:0;max-height:56px;overflow:hidden;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#a3a8b4);',
      'border-left:2px solid var(--dsw-alias-border-l1,#3b3f4a);padding-left:8px;white-space:normal;word-break:break-word}',
      '.dsa-note-input{width:100%;min-height:58px;max-height:160px;resize:vertical;padding:7px 9px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1,#3b3f4a);background:var(--dsw-alias-bg-layer-1,#20232b);color:var(--dsw-alias-label-primary,#f2f4f7);',
      'font:inherit;font-size:13px;line-height:1.5;white-space:pre-wrap}',
      '.dsa-note-actions{display:flex;justify-content:flex-end;gap:6px}',
      // composer mode switch
      '.dsa-mode{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 8px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1,#3b3f4a);color:var(--dsw-alias-label-secondary,#a3a8b4);font:inherit;font-size:12px;line-height:1;white-space:nowrap}',
      '.dsa-mode-label{display:inline-flex;align-items:center;gap:4px}',
      '.dsa-mode-label svg{display:block}',
      '.dsa-mode-seg{display:inline-flex;padding:2px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#343844);gap:2px}',
      '.dsa-mode-btn{height:20px;padding:0 7px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:11.5px;line-height:1;cursor:pointer}',
      '.dsa-mode-btn.is-on{background:var(--dsw-alias-bg-overlay,#2a2d36);color:var(--dsw-alias-label-primary,#f2f4f7);box-shadow:0 1px 2px rgba(0,0,0,.25)}',
      '.dsa-mode-btn:disabled{cursor:default;opacity:.6}',
      '.dsa-mode-badge{min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d7cfe);',
      'color:var(--dsw-alias-label-primary-foreground,#10131a);font-size:10px;line-height:15px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}',
      '@container (max-width: 520px){.dsa-mode-label span{display:none}}',
      // panel
      '[data-dsh-mindmark-ui].dsa-layer{position:fixed;inset:0;z-index:70;pointer-events:none}',
      '.dsa-panel{position:fixed;z-index:70;pointer-events:auto;top:64px;right:16px;width:360px;',
      'max-width:calc(100vw - 24px);max-height:min(600px,calc(100vh - 96px));display:flex;flex-direction:column;',
      'border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#3b3f4a);background:var(--dsw-alias-bg-overlay,#2a2d36);',
      'color:var(--dsw-alias-label-primary,#f2f4f7);box-shadow:0 18px 48px rgba(0,0,0,.36);font-family:inherit;',
      'font-size:13px;overflow:hidden;animation:dsa-panel-in 140ms ease-out}',
      '@keyframes dsa-panel-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '.dsa-panel-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1,#3b3f4a)}',
      '.dsa-panel-title{font-size:13.5px;font-weight:600;line-height:20px}',
      '.dsa-panel-count{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#343844);',
      'color:var(--dsw-alias-label-secondary,#a3a8b4);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}',
      '.dsa-spacer{flex:1}',
      '.dsa-panel-close{width:24px;height:24px;padding:0;display:inline-grid;place-items:center;border:0;border-radius:6px;',
      'background:transparent;color:var(--dsw-alias-label-secondary,#a3a8b4);font:inherit;font-size:15px;line-height:1;cursor:pointer}',
      '.dsa-panel-close:hover{color:var(--dsw-alias-label-primary,#f2f4f7);background:var(--dsw-alias-interactive-bg-hover,#343844)}',
      '.dsa-panel-body{flex:1;min-height:40px;overflow-y:auto;overscroll-behavior:contain;padding:6px 8px;',
      'display:flex;flex-direction:column;gap:2px}',
      '.dsa-empty,.dsa-loading{margin:0;padding:18px 10px;color:var(--dsw-alias-label-secondary,#a3a8b4);',
      'font-size:12.5px;line-height:1.7;text-align:center}',
      '.dsa-item{display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:8px}',
      '.dsa-item:hover{background:var(--dsw-alias-interactive-bg-hover,#343844)}',
      '.dsa-item.is-resolved{opacity:.72}',
      '.dsa-chip{flex:none;margin-top:1px;padding:1px 6px;border-radius:5px;font-size:11px;line-height:16px;white-space:nowrap;color:var(--dsw-alias-label-primary,#f2f4f7)}',
      '.dsa-chip-highlight{background:color-mix(in srgb,#f5c542 32%,transparent)}',
      '.dsa-chip-underline{border:1px solid color-mix(in srgb,#4d7cfe 55%,transparent);color:#7ea0ff}',
      '.dsa-chip-strike{background:color-mix(in srgb,#e5484d 22%,transparent)}',
      '.dsa-chip-comment{background:color-mix(in srgb,#2fb36f 24%,transparent)}',
      '.dsa-chip-rewrite{background:color-mix(in srgb,#a06bff 24%,transparent)}',
      '.dsa-chip-move{background:color-mix(in srgb,#ff8a3d 24%,transparent)}',
      '.dsa-chip-reference{background:color-mix(in srgb,#19b5c9 24%,transparent)}',
      '.dsa-move-banner{position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:71;pointer-events:auto;',
      'display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:max-content;max-width:min(760px,calc(100vw - 32px));padding:8px 10px;',
      'border-radius:10px;border:1px solid #ff8a3d;background:var(--dsw-alias-bg-overlay,#2a2d36);color:var(--dsw-alias-label-primary,#f2f4f7);',
      'box-shadow:0 12px 32px rgba(0,0,0,.32);font-family:inherit;font-size:12.5px;line-height:1.5}',
      '.dsa-move-text{flex:1 1 280px;min-width:0}',
      '.dsa-move-title{font-weight:600}',
      '.dsa-move-state{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary,#a3a8b4);word-break:break-all}',
      '.dsa-move-state.is-ready{color:#ff8a3d}',
      '.dsa-move-state.is-error{color:var(--dsw-alias-state-error-primary,#ff6b6b)}',
      '.dsa-move-reason{width:170px;height:26px;font-size:12px}',
      '.dsa-item-main{flex:1;min-width:0}',
      '.dsa-quote{margin:0;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary,#f2f4f7);',
      'overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word}',
      '.dsa-note{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#f2f4f7);word-break:break-word;',
      'border-left:2px solid var(--dsw-alias-border-l1,#3b3f4a);padding-left:7px;white-space:pre-wrap}',
      '.dsa-note b{font-weight:600;color:var(--dsw-alias-label-secondary,#a3a8b4);margin-right:4px}',
      '.dsa-meta{margin:3px 0 0;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#8a8f9c);',
      'font-variant-numeric:tabular-nums;display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
      '.dsa-status{padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#343844)}',
      '.dsa-status.is-pending{color:var(--dsw-alias-brand-primary,#4d7cfe)}',
      '.dsa-item-actions{flex:none;display:flex;gap:2px}',
      '.dsa-item-btn{width:22px;height:22px;padding:0;display:inline-grid;place-items:center;border:0;',
      'border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#a3a8b4);font:inherit;',
      'font-size:13px;line-height:1;cursor:pointer;opacity:.7}',
      '.dsa-item-btn:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,#343844);color:var(--dsw-alias-label-primary,#f2f4f7)}',
      '.dsa-item-btn.is-del:hover{color:var(--dsw-alias-state-error-primary,#e5484d);',
      'background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 12%,transparent)}',
      '.dsa-lessons{flex:none;max-height:170px;overflow-y:auto;border-top:1px solid var(--dsw-alias-border-l1,#3b3f4a);padding:6px 10px 4px}',
      '.dsa-lessons-title{margin:0 0 4px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#a3a8b4)}',
      '.dsa-lesson{display:flex;align-items:flex-start;gap:6px;padding:3px 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#f2f4f7)}',
      '.dsa-lesson span{flex:1;min-width:0;word-break:break-word}',
      '.dsa-lesson small{flex:none;color:var(--dsw-alias-label-tertiary,#8a8f9c);font-variant-numeric:tabular-nums}',
      '.dsa-lessons-empty{margin:0 0 4px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a8f9c)}',
      '.dsa-panel-foot{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px 10px;flex-wrap:wrap;',
      'border-top:1px solid var(--dsw-alias-border-l1,#3b3f4a)}',
      '.dsa-hint{flex:1 1 100%;min-width:0;margin:0;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,#a3a8b4)}',
      '.dsa-btn{flex:none;height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,#3b3f4a);',
      'background:transparent;color:var(--dsw-alias-label-primary,#f2f4f7);font:inherit;font-size:12px;cursor:pointer}',
      '.dsa-btn.is-primary{background:var(--dsw-alias-brand-primary,#4d7cfe);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#10131a)}',
      '.dsa-btn:hover:not(:disabled){filter:brightness(1.1);background:var(--dsw-alias-interactive-bg-hover,#343844)}',
      '.dsa-btn.is-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary,#4d7cfe)}',
      '.dsa-btn:disabled{opacity:.5;cursor:default}',
      '.dsa-warning,.dsa-error{flex:none;margin:8px 10px 0;padding:7px 9px;border-radius:8px;font-size:11.5px;line-height:16px}',
      '.dsa-warning{color:var(--dsw-alias-state-warn-primary,#f0b35b);',
      'background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f0b35b) 12%,transparent)}',
      '.dsa-error{color:var(--dsw-alias-state-error-primary,#ff6b6b);',
      'background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 12%,transparent)}',
      '@media (max-width:560px){.dsa-panel{top:56px;right:8px;left:8px;width:auto;max-width:none}}',
      '@media (prefers-reduced-motion:reduce){.dsa-panel{animation:none}}',
    ]
    STYLES.forEach(function (style) {
      CSS_LINES.push('::highlight(' + highlightName(style, 'pending') + '){' + MARK_COLORS[style].pending + '}')
      CSS_LINES.push('::highlight(' + highlightName(style, 'resolved') + '){' + MARK_COLORS[style].resolved + '}')
    })
    CSS_LINES.push('::highlight(dsa-move-pending){background-color:color-mix(in srgb,#ff8a3d 34%,transparent);text-decoration:underline dashed;text-decoration-thickness:2px;text-decoration-color:#ff8a3d}')
    CSS_LINES.push('::highlight(dsa-move-replace){background-color:color-mix(in srgb,#ff8a3d 26%,transparent);text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:#ff8a3d}')
    CSS_LINES.push('.dsa-caret{position:fixed;z-index:69;width:2px;margin-left:-1px;border-radius:1px;background:#ff8a3d;pointer-events:none;' +
      'box-shadow:0 0 0 1px color-mix(in srgb,#ff8a3d 35%,transparent);animation:dsa-blink 1.06s steps(1,end) infinite}')
    CSS_LINES.push('.dsa-caret.is-saved{opacity:.85}')
    CSS_LINES.push('@keyframes dsa-blink{0%{opacity:1}50%{opacity:0}}')
    CSS_LINES.push('#' + CARET_LAYER_ID + '.is-scrolling .dsa-caret{visibility:hidden}')
    CSS_LINES.push('@media (prefers-reduced-motion:reduce){.dsa-caret{animation:none}}')
    CSS_LINES.push('::highlight(dsa-ref-pending){background-color:color-mix(in srgb,#19b5c9 34%,transparent);text-decoration:underline double;text-decoration-color:#19b5c9}')
    var CSS_TEXT = CSS_LINES.join('\n')

    // ------------------------------------------------------------------- icons

    function MarkerIcon(props) {
      var size = props && typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M9.8 2.4l3.8 3.8-6.6 6.6H3.1v-3.9l6.7-6.5z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        h('path', { d: 'M8.5 3.7l3.8 3.8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M3.3 14.2h9.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    // ------------------------------------------------------------------- utils

    function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key)
    }

    function clipString(value, max) {
      if (typeof value !== 'string') return ''
      return value.length > max ? value.slice(0, max) : value
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function formatTimestamp(value) {
      try {
        var date = new Date(value)
        if (Number.isNaN(date.getTime())) return ''
        return (
          date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
          ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())
        )
      } catch (error) {
        return ''
      }
    }

    function previewQuote(quote, max) {
      var limit = typeof max === 'number' ? max : 140
      var text = String(quote || '').replace(/\s+/g, ' ').trim()
      if (text.length > limit) return text.slice(0, limit) + '…'
      return text
    }

    function compareCreatedAt(left, right) {
      var leftTime = Date.parse(left && left.createdAt) || 0
      var rightTime = Date.parse(right && right.createdAt) || 0
      if (leftTime === rightTime) return 0
      return leftTime < rightTime ? -1 : 1
    }

    function createClientId() {
      return 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    }

    function errorText(t, error) {
      if (!error || typeof error !== 'object') return ''
      if (error.code === 'http' && typeof error.message === 'string' && error.message.length > 0) return error.message
      var key = 'err.' + (typeof error.code === 'string' ? error.code : 'generic')
      var localized = t(key)
      if (localized !== key) return localized
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return t('err.generic')
    }

    function failureToError(failure, operation) {
      var code = failure && typeof failure.code === 'string' ? failure.code : 'http'
      var message = failure && typeof failure.message === 'string' ? failure.message : ''
      if (code === 'network') return { code: 'network', operation: operation, message: message }
      if (code === 'http') return { code: 'http', operation: operation, message: message }
      return { code: operation || 'generic', message: message }
    }

    function isStyle(value) {
      return STYLES.indexOf(value) >= 0
    }

    function normalizeMode(value) {
      return MODES.indexOf(value) >= 0 ? value : 'brief'
    }

    // ------------------------------------------------------------ DOM helpers

    function elementOfNode(node) {
      if (!node) return null
      if (node.nodeType === 1) return node
      if (node.parentElement) return node.parentElement
      return null
    }

    function isOurUiNode(node) {
      try {
        var element = elementOfNode(node)
        if (!element || typeof element.closest !== 'function') return false
        return element.closest(UI_SELECTOR) !== null
      } catch (error) {
        return false
      }
    }

    function isOurUiElement(element) {
      if (!element || element.nodeType !== 1 || typeof element.closest !== 'function') return false
      try {
        return element.closest(UI_SELECTOR) !== null
      } catch (error) {
        return false
      }
    }

    function isSkippedElement(element, checkOwnUi) {
      if (!element || element.nodeType !== 1) return false
      var tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : ''
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return true
      if (checkOwnUi === false) return false
      return isOurUiElement(element)
    }

    function isScrollContainer(element) {
      try {
        if (!element || element.nodeType !== 1) return false
        if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false
        var style = window.getComputedStyle(element)
        if (!style) return false
        var overflowY = style.overflowY
        if (overflowY !== 'auto' && overflowY !== 'scroll') return false
        return element.scrollHeight > element.clientHeight + 20
      } catch (error) {
        return false
      }
    }

    // A selection belongs to exactly one answer already admitted by its session
    // interaction owner. Never index a scroll container or the document body.
    function findRoot(range) {
      var body = messageBodyOf(range && range.startContainer)
      if (!body || body !== messageBodyOf(range.endContainer)) return null
      return ownsBody(body) ? body : null
    }

    function admitSelection(props) {
      if (props.sessionId !== ownerSessionId || typeof props.readText !== 'function') return null
      var text = props.readText()
      var range = readLiveRange()
      // Host readText projects visible block boundaries; it is not range.toString().
      if (!range || typeof text !== 'string' || !text.trim()) return null
      var body = messageBodyOf(range.startContainer)
      if (!body || body !== messageBodyOf(range.endContainer) || !ownsBody(body)) return null
      // Require both owner-scoped readText and the DOM's explicit session seat.
      return range
    }

    // Raw text-node values in document order (never whitespace-normalized), with
    // cumulative offsets, skipping our own UI and script/style subtrees.
    function buildIndex(root) {
      var nodes = []
      var starts = new Map()
      var text = ''
      try {
        if (!root) return { nodes: nodes, text: text, starts: starts }
        var checkOwnUi = root === document.body
        var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null)
        var node = walker.nextNode()
        while (node !== null) {
          if (!isSkippedElement(node.parentElement, checkOwnUi)) {
            var value = node.nodeValue
            if (typeof value === 'string' && value.length > 0) {
              nodes.push({ node: node, start: text.length, length: value.length })
              starts.set(node, text.length)
              text += value
            }
          }
          node = walker.nextNode()
        }
      } catch (error) {
        console.error('dsh-mindmark: text indexing failed', error)
      }
      return { nodes: nodes, text: text, starts: starts }
    }

    function firstIndexedTextNodeIn(subtree, index) {
      if (!subtree) return null
      if (subtree.nodeType === 3) return index.starts.has(subtree) ? subtree : null
      if (subtree.nodeType !== 1) return null
      try {
        var walker = document.createTreeWalker(subtree, 4, null)
        var node = walker.nextNode()
        while (node !== null) {
          if (index.starts.has(node)) return node
          node = walker.nextNode()
        }
      } catch (error) {
        /* the subtree is unreadable: treat it as containing no text */
      }
      return null
    }

    function lastIndexedTextNodeIn(container, index) {
      try {
        if (!container || typeof document.createTreeWalker !== 'function') return null
        var walker = document.createTreeWalker(container, 4, null)
        var node = walker.nextNode()
        var last = null
        while (node !== null) {
          if (index.starts.has(node)) last = node
          node = walker.nextNode()
        }
        return last
      } catch (error) {
        return null
      }
    }

    function offsetOf(index, container, offset) {
      try {
        if (!index || !container) return 0
        if (container.nodeType === 3) {
          var known = index.starts.get(container)
          if (typeof known === 'number') {
            var length = typeof container.nodeValue === 'string' ? container.nodeValue.length : 0
            var local = typeof offset === 'number' ? offset : 0
            return known + Math.max(0, Math.min(local, length))
          }
          return index.text.length
        }
        var children = container.childNodes
        if (!children) return index.text.length
        var position = typeof offset === 'number' ? Math.max(0, Math.min(offset, children.length)) : 0
        for (var childIndexValue = position; childIndexValue < children.length; childIndexValue += 1) {
          var staged = firstIndexedTextNodeIn(children[childIndexValue], index)
          if (staged !== null) {
            var stagedStart = index.starts.get(staged)
            if (typeof stagedStart === 'number') return stagedStart
          }
        }
        var lastText = lastIndexedTextNodeIn(container, index)
        if (lastText !== null) {
          var lastStart = index.starts.get(lastText)
          if (typeof lastStart === 'number') {
            return lastStart + (typeof lastText.nodeValue === 'string' ? lastText.nodeValue.length : 0)
          }
        }
        return index.text.length
      } catch (error) {
        console.error('dsh-mindmark: offset lookup failed', error)
        return 0
      }
    }

    function escapeIdent(value) {
      var text = String(value)
      try {
        if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(text)
      } catch (error) {
        /* fall through to the hand-rolled escape */
      }
      return text.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
    }

    function elementSiblingIndex(element) {
      var index = 1
      var sibling = element
      while (sibling && sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling
        index += 1
      }
      return index
    }

    function cssPath(element) {
      try {
        if (!element || element.nodeType !== 1) return ''
        var segments = []
        var current = element
        var depth = 0
        while (current && current.nodeType === 1 && depth < 6) {
          if (current === document.documentElement) {
            segments.unshift('html')
            break
          }
          if (current === document.body) {
            segments.unshift('body')
            break
          }
          var tag = typeof current.tagName === 'string' ? current.tagName.toLowerCase() : ''
          if (tag.length === 0) break
          var segment = tag
          if (current.id) {
            segment += '#' + escapeIdent(current.id)
            segments.unshift(segment)
            break
          }
          var classList = current.classList
          var classCount = 0
          if (classList && classList.length > 0) {
            for (var index = 0; index < classList.length && classCount < 3; index += 1) {
              var className = classList[index]
              if (typeof className !== 'string' || className.length === 0 || className.length > 40) continue
              segment += '.' + escapeIdent(className)
              classCount += 1
            }
          }
          var parent = current.parentElement
          if (parent) segment += ':nth-child(' + elementSiblingIndex(current) + ')'
          segments.unshift(segment)
          current = parent
          depth += 1
        }
        var path = segments.join(' > ')
        while (segments.length > 1 && path.length > SELECTOR_MAX) {
          segments.shift()
          path = segments.join(' > ')
        }
        return path.length > SELECTOR_MAX ? '' : path
      } catch (error) {
        console.error('dsh-mindmark: cannot build a CSS path', error)
        return ''
      }
    }

    function resolveRoot(selector, messageKey) {
      if (disposedRuntime || typeof messageKey !== 'string' || !messageKey) return null
      var matches = []
      var seats = document.querySelectorAll('[data-conversation-session]')
      for (var seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
        var seat = seats[seatIndex]
        if (seat.getAttribute('data-conversation-session') !== ownerSessionId) continue
        var bodies = seat.querySelectorAll('[data-text-interaction-source]')
        for (var bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
          var body = bodies[bodyIndex]
          if (body.isConnected !== false && ownsBody(body) && messageKeyOf(body, buildIndex(body)) === messageKey && matches.indexOf(body) < 0) matches.push(body)
        }
      }
      // Ambiguous or recycled DOM must never paint a different answer/session.
      return matches.length === 1 ? matches[0] : null
    }

    // --------------------------------------------------------- anchoring

    function commonPrefixLen(left, right) {
      if (typeof left !== 'string' || typeof right !== 'string') return 0
      var max = Math.min(left.length, right.length)
      var index = 0
      while (index < max && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
      return index
    }

    function commonSuffixLen(left, right) {
      if (typeof left !== 'string' || typeof right !== 'string') return 0
      var max = Math.min(left.length, right.length)
      var index = 0
      while (index < max && left.charCodeAt(left.length - 1 - index) === right.charCodeAt(right.length - 1 - index)) {
        index += 1
      }
      return index
    }

    function positionAtOffset(index, offset) {
      var nodes = index.nodes
      if (!nodes || nodes.length === 0) return null
      if (offset <= 0) return { node: nodes[0].node, offset: 0 }
      if (offset >= index.text.length) {
        var last = nodes[nodes.length - 1]
        var lastLength = typeof last.node.nodeValue === 'string' ? last.node.nodeValue.length : 0
        return { node: last.node, offset: lastLength }
      }
      var low = 0
      var high = nodes.length - 1
      var found = 0
      while (low <= high) {
        var mid = (low + high) >> 1
        if (nodes[mid].start <= offset) {
          found = mid
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      var entry = nodes[found]
      var local = offset - entry.start
      var maxLocal = typeof entry.node.nodeValue === 'string' ? entry.node.nodeValue.length : 0
      return { node: entry.node, offset: Math.max(0, Math.min(local, maxLocal)) }
    }

    function rangeFromOffsets(index, start, end) {
      var maxOffset = index.text.length
      var safeStart = Math.max(0, Math.min(start, maxOffset))
      var safeEnd = Math.max(0, Math.min(end, maxOffset))
      if (safeEnd <= safeStart) return null
      var startPosition = positionAtOffset(index, safeStart)
      var endPosition = positionAtOffset(index, safeEnd)
      if (startPosition === null || endPosition === null) return null
      try {
        var range = document.createRange()
        range.setStart(startPosition.node, startPosition.offset)
        range.setEnd(endPosition.node, endPosition.offset)
        return range
      } catch (error) {
        return null
      }
    }

    function locateAnnotationRange(annotation, index) {
      try {
        if (!annotation || typeof annotation.quote !== 'string' || annotation.quote.length === 0) return null
        var text = index.text
        if (!text || text.length === 0) return null
        var quote = annotation.quote
        var prefix = typeof annotation.prefix === 'string' ? annotation.prefix : ''
        var suffix = typeof annotation.suffix === 'string' ? annotation.suffix : ''
        var bestStart = -1
        var bestScore = -1
        var bestPossible = prefix.length + suffix.length
        var searchFrom = 0
        var guard = 0
        while (guard < 500) {
          var found = text.indexOf(quote, searchFrom)
          if (found === -1) break
          var score = 0
          var beforeContext = text.slice(Math.max(0, found - prefix.length), found)
          score += commonSuffixLen(prefix, beforeContext)
          var afterContext = text.slice(found + quote.length, found + quote.length + suffix.length)
          score += commonPrefixLen(suffix, afterContext)
          if (score > bestScore) {
            bestScore = score
            bestStart = found
          }
          if (bestScore >= bestPossible) break
          searchFrom = found + 1
          guard += 1
        }
        if (bestStart < 0) return null
        return rangeFromOffsets(index, bestStart, bestStart + quote.length)
      } catch (error) {
        return null
      }
    }

    function ensureIndexEntry(cache, selector, messageKey) {
      var key = JSON.stringify([selector, messageKey])
      if (hasOwn(cache, key)) return cache[key]
      var entry = null
      try {
        var root = resolveRoot(selector, messageKey)
        if (!root) return null
        entry = { root: root, index: buildIndex(root) }
      } catch (error) {
        entry = null
      }
      cache[key] = entry
      return entry
    }

    function collectRanges(annotations) {
      var resolved = []
      var cache = {}
      for (var index = 0; index < annotations.length; index += 1) {
        var annotation = annotations[index]
        try {
          var entry = ensureIndexEntry(cache, annotation.rootSelector, annotation.messageKey)
          if (entry === null) continue
          var range = locateAnnotationRange(annotation, entry.index)
          if (range !== null) resolved.push({ annotation: annotation, range: range })
        } catch (error) {
          /* one bad record must not stop the others */
        }
      }
      return resolved
    }

    // ------------------------------------------------------------- painting

    function supportsHighlights() {
      try {
        if (typeof Highlight !== 'function') return false
        if (typeof CSS === 'undefined' || CSS === null) return false
        return CSS.highlights !== undefined && CSS.highlights !== null
      } catch (error) {
        return false
      }
    }

    function setHighlightGroup(name, ranges) {
      try {
        if (!supportsHighlights()) return
        var registry = CSS.highlights
        if (ranges.length === 0) {
          registry.delete(name + '-' + runtimeId)
          return
        }
        var group = null
        try {
          group = new Highlight(...ranges)
        } catch (error) {
          group = null
        }
        if (group === null) {
          group = new Highlight()
          for (var index = 0; index < ranges.length; index += 1) group.add(ranges[index])
        }
        registry.set(name + '-' + runtimeId, group)
      } catch (error) {
        console.error('dsh-mindmark: cannot paint highlights', error)
      }
    }

    function clearHighlights() {
      try {
        if (!supportsHighlights()) return
        STYLES.forEach(function (style) {
          CSS.highlights.delete(highlightName(style, 'pending') + '-' + runtimeId)
          CSS.highlights.delete(highlightName(style, 'resolved') + '-' + runtimeId)
        })
        MOVE_EXTRA_HIGHLIGHTS.forEach(function (name) {
          CSS.highlights.delete(name + '-' + runtimeId)
        })
        removeCarets()
      } catch (error) {
        console.error('dsh-mindmark: cannot clear highlights', error)
      }
    }

    var applyTimer = null

    function paintHighlightsNow() {
      try {
        if (!supportsHighlights()) return
        var current = getState()
        var annotations = current.sessionId !== null && Array.isArray(current.annotations) ? current.annotations : []
        var resolved = annotations.length === 0 ? [] : collectRanges(annotations)
        var groups = {}
        STYLES.forEach(function (style) {
          groups[highlightName(style, 'pending')] = []
          groups[highlightName(style, 'resolved')] = []
        })
        for (var index = 0; index < resolved.length; index += 1) {
          var item = resolved[index]
          var name = highlightName(item.annotation.style, item.annotation.status)
          if (groups[name]) groups[name].push(item.range)
        }
        MOVE_EXTRA_HIGHLIGHTS.forEach(function (extra) {
          groups[extra] = []
        })
        var cache = {}
        var carets = []
        function markTarget(entry, prefix, quote, suffix, saved) {
          if (entry === null) return
          var spot = locateTargetIn(entry.index, prefix, quote, suffix)
          if (spot === null) return
          if (spot.end > spot.start) {
            var replaced = rangeFromOffsets(entry.index, spot.start, spot.end)
            if (replaced !== null) groups['dsa-move-replace'].push(replaced)
          } else {
            var box = visibleCaret(entry, spot.start, saved)
            if (box !== null) carets.push(box)
          }
        }
        for (var moveIndex = 0; moveIndex < annotations.length; moveIndex += 1) {
          var move = annotations[moveIndex]
          if (move.style !== 'move' || move.status === 'resolved') continue
          markTarget(ensureIndexEntry(cache, move.rootSelector, move.messageKey), move.targetPrefix, move.targetQuote, move.targetSuffix, true)
        }
        var pendingRef = current.referenceDraft
        if (pendingRef && pendingRef.built && current.sessionId !== null) {
          var refEntry = ensureIndexEntry(cache, pendingRef.built.record.rootSelector, pendingRef.built.record.messageKey)
          var refRange = refEntry === null ? null : locateAnnotationRange(pendingRef.built.record, refEntry.index)
          if (refRange !== null) groups['dsa-ref-pending'].push(refRange)
        }
        var pendingMove = current.pendingMove
        if (pendingMove && pendingMove.built && current.sessionId !== null) {
          var pendingEntry = ensureIndexEntry(cache, pendingMove.built.record.rootSelector, pendingMove.built.record.messageKey)
          if (pendingEntry !== null) {
            var sourceRange = locateAnnotationRange(pendingMove.built.record, pendingEntry.index)
            if (sourceRange !== null) groups['dsa-move-pending'].push(sourceRange)
            if (pendingMove.target) {
              markTarget(pendingEntry, pendingMove.target.prefix, pendingMove.target.quote, pendingMove.target.suffix, false)
            }
          }
        }
        drawCarets(carets)
        Object.keys(groups).forEach(function (name) {
          setHighlightGroup(name, groups[name])
        })
      } catch (error) {
        console.error('dsh-mindmark: repaint failed', error)
      }
    }

    function cancelPaintTimer() {
      if (applyTimer !== null) {
        clearTimeout(applyTimer)
        applyTimer = null
      }
    }

    function schedulePaint(delay) {
      try {
        if (applyTimer !== null) return
        var wait = typeof delay === 'number' && delay >= 0 ? delay : MUTATION_DEBOUNCE
        applyTimer = setTimeout(function () {
          applyTimer = null
          paintHighlightsNow()
        }, wait)
      } catch (error) {
        console.error('dsh-mindmark: cannot schedule a repaint', error)
      }
    }

    function paintNow() {
      cancelPaintTimer()
      paintHighlightsNow()
    }

    // ----------------------------------------------- selection → record

    function readLiveRange() {
      var nativeSelection = null
      try {
        nativeSelection = typeof window.getSelection === 'function' ? window.getSelection() : null
      } catch (error) {
        return null
      }
      if (!nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) return null
      var text = ''
      try {
        text = nativeSelection.toString()
      } catch (error) {
        return null
      }
      if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_QUOTE) return null
      try {
        var range = nativeSelection.getRangeAt(0)
        if (!range || !range.startContainer || !range.endContainer) return null
        if (isOurUiNode(range.startContainer) || isOurUiNode(range.endContainer)) return null
        return range
      } catch (error) {
        return null
      }
    }

    // The message body is the Chat view's own interaction source element (the
    // rendered Markdown of one assistant answer); the flow item above it carries
    // the node key and the turn. Only attribute names the Chat view documents
    // for plugins are consulted, and a miss simply yields an unanchored record.
    function locateMessage(range) {
      try {
        var element = elementOfNode(range.commonAncestorContainer)
        if (!element || typeof element.closest !== 'function') return null
        var body = element.closest('[data-text-interaction-source]')
        if (!body) return null
        var item = body.closest('[data-chat-node-key]')
        var key = item && typeof item.getAttribute === 'function' ? item.getAttribute('data-chat-node-key') : null
        var turnRaw = item && typeof item.getAttribute === 'function' ? item.getAttribute('data-chat-turn') : null
        var turn = turnRaw !== null && /^\d+$/.test(turnRaw) ? Number(turnRaw) : undefined
        var index = buildIndex(body)
        if (!index.text || index.text.length === 0 || index.text.length > MAX_MESSAGE_TEXT) return null
        var start = offsetOf(index, range.startContainer, range.startOffset)
        var end = offsetOf(index, range.endContainer, range.endOffset)
        if (!(end > start)) return null
        if (!key) key = 'text:' + hashText(index.text)
        return { key: clipString(key, 200), text: index.text, turn: turn, start: start, end: end }
      } catch (error) {
        return null
      }
    }

    // The rendered body of one answer that contains `node`, or null.
    function messageBodyOf(node) {
      var element = elementOfNode(node)
      if (!element || typeof element.closest !== 'function' || isOurUiElement(element)) return null
      try {
        return element.closest('[data-text-interaction-source]')
      } catch (error) {
        return null
      }
    }

    function messageKeyOf(body, index) {
      var item = body.closest('[data-chat-node-key]')
      var key = item && typeof item.getAttribute === 'function' ? item.getAttribute('data-chat-node-key') : null
      if (!key) key = 'text:' + hashText(index.text)
      return clipString(key, 200)
    }

    // Where a move would land, read from the selection inside an answer: a
    // collapsed selection (a click) is an insertion point; a selection over
    // some text means that text is replaced. Returns the message key, the
    // offsets, the replaced text (`quote`, '' for an insertion) and the text
    // right before and after.
    function caretTarget() {
      try {
        var nativeSelection = typeof window.getSelection === 'function' ? window.getSelection() : null
        if (!nativeSelection || nativeSelection.rangeCount === 0) return null
        var range = nativeSelection.getRangeAt(0)
        var body = messageBodyOf(range.startContainer)
        if (!body || !ownsBody(body) || messageBodyOf(range.endContainer) !== body) return null
        var index = buildIndex(body)
        if (!index.text || index.text.length > MAX_MESSAGE_TEXT) return null
        var offset = offsetOf(index, range.startContainer, range.startOffset)
        var end = offset
        if (!range.collapsed && messageBodyOf(range.endContainer) === body) {
          end = offsetOf(index, range.endContainer, range.endOffset)
          if (end - offset > MAX_QUOTE || index.text.slice(offset, end).trim().length === 0) end = offset
        }
        if (end < offset) end = offset
        return {
          key: messageKeyOf(body, index),
          offset: offset,
          end: end,
          quote: index.text.slice(offset, end),
          prefix: index.text.slice(Math.max(0, offset - CONTEXT_MAX), offset),
          suffix: index.text.slice(end, Math.min(index.text.length, end + CONTEXT_MAX)),
        }
      } catch (error) {
        return null
      }
    }

    // Offsets of a move target inside an indexed root, found by its context.
    function locateTargetIn(index, prefix, quote, suffix) {
      var before = typeof prefix === 'string' ? prefix : ''
      var middle = typeof quote === 'string' ? quote : ''
      var after = typeof suffix === 'string' ? suffix : ''
      if (!index || !index.text || before.length + middle.length + after.length === 0) return null
      var found = index.text.indexOf(before + middle + after)
      if (found < 0) return null
      var start = found + before.length
      return { start: start, end: start + middle.length }
    }

    // The on-screen box of the caret at an insertion point: the left edge of
    // the next character, or the right edge of the previous one at a line end.
    function caretBox(index, at) {
      var text = index.text
      function rectOf(start, end, side) {
        var range = rangeFromOffsets(index, start, end)
        if (range === null) return null
        var rects = range.getClientRects()
        var rect = rects.length > 0 ? (side === 'left' ? rects[0] : rects[rects.length - 1]) : null
        if (!rect || (rect.width === 0 && rect.height === 0)) return null
        return { x: side === 'left' ? rect.left : rect.right, top: rect.top, height: rect.height }
      }
      var next = at < text.length && !/\s/.test(text.charAt(at)) ? rectOf(at, at + 1, 'left') : null
      if (next !== null) return next
      var previous = at > 0 && text.charAt(at - 1) !== '\n' ? rectOf(at - 1, at, 'right') : null
      if (previous !== null) return previous
      return at < text.length ? rectOf(at, at + 1, 'left') : null
    }

    // Blinking carets live in one fixed layer outside the chat DOM.
    var caretScrollTimer = null

    function caretLayer() {
      var layer = document.getElementById(CARET_LAYER_ID)
      if (layer === null && document.body) {
        layer = document.createElement('div')
        layer.id = CARET_LAYER_ID
        layer.setAttribute(UI_ATTR, '1')
        layer.setAttribute('aria-hidden', 'true')
        document.body.appendChild(layer)
      }
      return layer
    }

    function hideCaretsWhileScrolling() {
      var layer = document.getElementById(CARET_LAYER_ID)
      if (layer === null) return
      layer.classList.add('is-scrolling')
      if (caretScrollTimer !== null) clearTimeout(caretScrollTimer)
      caretScrollTimer = setTimeout(function () {
        caretScrollTimer = null
        layer.classList.remove('is-scrolling')
      }, MUTATION_DEBOUNCE + 60)
    }

    function drawCarets(boxes) {
      var layer = caretLayer()
      if (layer === null) return
      while (layer.childNodes.length > boxes.length) layer.removeChild(layer.lastChild)
      for (var index = 0; index < boxes.length; index += 1) {
        var box = boxes[index]
        var caret = layer.childNodes[index]
        if (!caret) {
          caret = document.createElement('div')
          layer.appendChild(caret)
        }
        caret.className = 'dsa-caret' + (box.saved ? ' is-saved' : '')
        caret.style.left = box.x + 'px'
        caret.style.top = box.top + 'px'
        caret.style.height = box.height + 'px'
      }
    }

    function removeCarets() {
      var layer = document.getElementById(CARET_LAYER_ID)
      if (layer !== null && layer.parentNode !== null) layer.parentNode.removeChild(layer)
    }

    // A caret box clipped to its scroll container, or null when scrolled out.
    function visibleCaret(entry, at, saved) {
      var box = caretBox(entry.index, at)
      if (box === null) return null
      var bounds = entry.root && entry.root !== document.body ? entry.root.getBoundingClientRect() : null
      if (bounds && (box.top + box.height < bounds.top || box.top > bounds.bottom)) return null
      box.saved = saved === true
      return box
    }

    function hashText(text) {
      var hash = 5381
      for (var index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
      return (hash >>> 0).toString(36)
    }

    function buildRecord(range, style) {
      try {
        var root = findRoot(range)
        if (!root) return null
        var index = buildIndex(root)
        if (!index.text || index.nodes.length === 0) return null
        var start = offsetOf(index, range.startContainer, range.startOffset)
        var end = offsetOf(index, range.endContainer, range.endOffset)
        if (!(end > start)) return null
        var quote = index.text.slice(start, end)
        if (!quote || quote.trim().length === 0 || quote.length > MAX_QUOTE) return null
        var message = locateMessage(range)
        if (!message) return null
        var record = {
          id: createClientId(),
          style: isStyle(style) ? style : 'highlight',
          quote: quote,
          note: '',
          prefix: index.text.slice(Math.max(0, start - CONTEXT_MAX), start),
          suffix: index.text.slice(end, Math.min(index.text.length, end + CONTEXT_MAX)),
          rootSelector: cssPath(root),
          createdAt: new Date().toISOString(),
          status: 'pending',
        }
        if (message !== null) {
          record.messageKey = message.key
          record.messageStart = message.start
          record.messageEnd = message.end
          if (typeof message.turn === 'number') record.turn = message.turn
        }
        return { record: record, message: message === null ? null : { key: message.key, text: message.text, turn: message.turn } }
      } catch (error) {
        console.error('dsh-mindmark: cannot build the annotation record', error)
        return null
      }
    }

    function rangesIntersect(left, right) {
      try {
        if (left.compareBoundaryPoints(1, right) >= 0) return false
        if (right.compareBoundaryPoints(1, left) >= 0) return false
        return true
      } catch (error) {
        return false
      }
    }

    function annotationsIntersecting(range) {
      var current = getState()
      var hits = []
      if (current.sessionId === null || current.annotations.length === 0) return hits
      var cache = {}
      for (var index = 0; index < current.annotations.length; index += 1) {
        var annotation = current.annotations[index]
        var entry = ensureIndexEntry(cache, annotation.rootSelector, annotation.messageKey)
        if (entry === null) continue
        var annotationRange = locateAnnotationRange(annotation, entry.index)
        if (annotationRange !== null && rangesIntersect(annotationRange, range)) hits.push(annotation.id)
      }
      return hits
    }

    // -------------------------------------------------------------- controller

    var state = {
      sessionId: ownerSessionId,
      annotations: [],
      mode: 'brief',
      lessons: [],
      loading: false,
      error: null,
      panelOpen: false,
      // { built, target, reason, error } while a passage waits for Alt+V.
      pendingMove: null,
      // The open reference form: { built, kind, title, content, url, fileName, text, error }.
      referenceDraft: null,
    }
    var stateListeners = new Set()
    var loadToken = 0
    var mutationQueue = Promise.resolve()
    var pendingAdds = new Map()
    var serverIds = new Map()

    function resolvedIds(ids) {
      return ids.map(function (id) { return serverIds.get(id) || id })
    }

    function getState() {
      return state
    }

    function subscribeState(listener) {
      stateListeners.add(listener)
      return function () {
        stateListeners.delete(listener)
      }
    }

    function publishState(patch) {
      if (disposedRuntime) return
      var next = {}
      for (var key in state) next[key] = state[key]
      for (var patchKey in patch) next[patchKey] = patch[patchKey]
      state = next
      stateListeners.forEach(function (listener) {
        try {
          listener()
        } catch (error) {
          console.error('dsh-mindmark: state listener failed', error)
        }
      })
    }

    function enqueueMutation(run) {
      mutationQueue = mutationQueue.then(run, run).catch(function (error) {
        console.error('dsh-mindmark: mutation failed', error)
      })
      return mutationQueue
    }

    function normalizeAnnotation(raw) {
      if (!raw || typeof raw !== 'object') return null
      var id = typeof raw.id === 'string' ? raw.id : ''
      if (id.length === 0 || id.length > ID_MAX) return null
      if (!isStyle(raw.style)) return null
      var quote = typeof raw.quote === 'string' ? raw.quote : ''
      if (quote.length === 0 || quote.trim().length === 0 || quote.length > MAX_QUOTE) return null
      var record = {
        id: id,
        style: raw.style,
        quote: quote,
        note: clipString(raw.note, MAX_NOTE),
        prefix: clipString(raw.prefix, CONTEXT_MAX),
        suffix: clipString(raw.suffix, CONTEXT_MAX),
        rootSelector: clipString(raw.rootSelector, SELECTOR_MAX),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
        status: raw.status === 'resolved' ? 'resolved' : 'pending',
        resolvedBy: typeof raw.resolvedBy === 'string' ? raw.resolvedBy : '',
        injections: typeof raw.injections === 'number' ? raw.injections : 0,
      }
      if (typeof raw.messageKey === 'string' && raw.messageKey.length > 0) {
        record.messageKey = raw.messageKey
        record.messageStart = raw.messageStart
        record.messageEnd = raw.messageEnd
      }
      if (typeof raw.turn === 'number') record.turn = raw.turn
      if (raw.style === 'move') {
        record.targetPrefix = clipString(raw.targetPrefix, CONTEXT_MAX)
        record.targetSuffix = clipString(raw.targetSuffix, CONTEXT_MAX)
        if (record.targetPrefix.length === 0 && record.targetSuffix.length === 0) return null
        if (typeof raw.targetOffset === 'number') record.targetOffset = raw.targetOffset
        if (typeof raw.targetQuote === 'string' && raw.targetQuote.trim().length > 0) {
          record.targetQuote = clipString(raw.targetQuote, MAX_QUOTE)
          if (typeof raw.targetEnd === 'number') record.targetEnd = raw.targetEnd
        }
      }
      if (raw.style === 'reference') {
        var material = normalizeMaterial(raw.material)
        if (material === null) return null
        record.material = material
      }
      return record
    }

    // Display-side material metadata; the content itself stays on the Host.
    function normalizeMaterial(raw) {
      if (!raw || typeof raw !== 'object' || MATERIAL_KINDS.indexOf(raw.kind) < 0) return null
      var title = clipString(typeof raw.title === 'string' ? raw.title : '', 120)
      if (raw.kind === 'url') {
        var url = typeof raw.url === 'string' ? raw.url : typeof raw.content === 'string' ? raw.content.trim() : ''
        if (!/^https?:\/\//i.test(url)) return null
        return { kind: 'url', title: title, url: url, length: 0, excerpt: '' }
      }
      var content = typeof raw.content === 'string' ? raw.content.trim() : ''
      return {
        kind: raw.kind,
        title: title,
        length: typeof raw.length === 'number' ? raw.length : content.length,
        excerpt: clipString(typeof raw.excerpt === 'string' ? raw.excerpt : content, 600),
      }
    }

    function normalizeAnnotationList(raw) {
      var list = []
      if (!Array.isArray(raw)) return list
      for (var index = 0; index < raw.length; index += 1) {
        var item = normalizeAnnotation(raw[index])
        if (item !== null) list.push(item)
      }
      list.sort(compareCreatedAt)
      return list
    }

    function wireRecord(record) {
      var wire = {
        id: record.id,
        style: record.style,
        quote: record.quote,
        note: record.note,
        prefix: record.prefix,
        suffix: record.suffix,
        rootSelector: record.rootSelector,
        createdAt: record.createdAt,
      }
      if (typeof record.messageKey === 'string') {
        wire.messageKey = record.messageKey
        wire.messageStart = record.messageStart
        wire.messageEnd = record.messageEnd
      }
      if (typeof record.turn === 'number') wire.turn = record.turn
      if (record.style === 'move') {
        wire.targetPrefix = record.targetPrefix
        wire.targetSuffix = record.targetSuffix
        if (typeof record.targetOffset === 'number') wire.targetOffset = record.targetOffset
        if (typeof record.targetQuote === 'string' && record.targetQuote.length > 0) {
          wire.targetQuote = record.targetQuote
          if (typeof record.targetEnd === 'number') wire.targetEnd = record.targetEnd
        }
      }
      if (record.style === 'reference' && record.material) {
        wire.material = { kind: record.material.kind, title: record.material.title, content: record.material.content }
      }
      return wire
    }

    function networkFailure(cause) {
      var failure = new Error(cause && cause.message ? cause.message : 'network error')
      failure.code = 'network'
      return failure
    }

    function requestJson(url, options) {
      var pending = null
      try {
        if (typeof fetch !== 'function') return Promise.reject(networkFailure(new Error('fetch is unavailable')))
        if (disposedRuntime) return Promise.reject(networkFailure(new Error('session disposed')))
        if (url !== ROUTE && url.indexOf(ROUTE + '?') !== 0) throw new Error('unexpected endpoint')
        options = Object.assign({}, options, { credentials: 'same-origin', redirect: 'error', headers: Object.assign({}, options && options.headers, { 'x-dsh-mindmark': '1' }) })
        pending = fetch(url, options)
      } catch (failure) {
        return Promise.reject(networkFailure(failure))
      }
      if (!pending || typeof pending.then !== 'function') {
        return Promise.reject(networkFailure(new Error('fetch returned no promise')))
      }
      return pending.then(
        function (response) {
          if (!response || typeof response.text !== 'function') throw networkFailure(new Error('empty response'))
          return response.text().then(
            function (text) {
              var data = null
              if (typeof text === 'string' && text.length > 0) {
                try {
                  data = JSON.parse(text)
                } catch (error) {
                  data = null
                }
              }
              if (response.ok === true && data && data.ok === true) return data
              var failure = new Error('HTTP ' + String(response.status))
              failure.code = 'http'
              if (data && data.error && typeof data.error.message === 'string') failure.message = data.error.message
              throw failure
            },
            function (failure) {
              throw networkFailure(failure)
            },
          )
        },
        function (failure) {
          throw networkFailure(failure)
        },
      )
    }

    function normalizeLessons(raw) {
      var list = []
      if (!Array.isArray(raw)) return list
      for (var index = 0; index < raw.length; index += 1) {
        var item = raw[index]
        if (item && typeof item.text === 'string' && item.text.length > 0) {
          list.push({ text: clipString(item.text, 300), date: typeof item.date === 'string' ? item.date : '' })
        }
      }
      return list
    }

    // The composer-side slot hands us its draft setter so the panel (root
    // scope, no composer access) can prefill the distill request.
    var draftSetter = null

    function requestDistill(prompt) {
      if (typeof draftSetter !== 'function') return false
      try {
        draftSetter(prompt)
        return true
      } catch (error) {
        console.error('dsh-mindmark: cannot prefill the composer', error)
        return false
      }
    }

    function forgetLesson(text) {
      var sessionId = state.sessionId
      if (sessionId === null || typeof text !== 'string') return
      var previous = state.lessons
      publishState({
        lessons: previous.filter(function (item) {
          return item.text !== text
        }),
        error: null,
      })
      enqueueMutation(function () {
        return postAction({ action: 'forget-lesson', sessionId: sessionId, lessons: [text] }).then(
          function (data) {
            if (state.sessionId !== sessionId) return
            applyServerPayload(data)
          },
          function (failure) {
            if (state.sessionId !== sessionId) return
            publishState({ lessons: previous, error: failureToError(failure, 'resolve') })
          },
        )
      })
    }

    function applyServerPayload(data, extra) {
      var patch = extra || {}
      if (Array.isArray(data.annotations)) {
        patch.annotations = normalizeAnnotationList(data.annotations)
        pendingAdds.forEach(function (record) {
          if (!patch.annotations.some(function (item) { return item.id === record.id })) patch.annotations.push(record)
        })
      }
      if (typeof data.mode === 'string') patch.mode = normalizeMode(data.mode)
      if (Array.isArray(data.lessons)) patch.lessons = normalizeLessons(data.lessons)
      if (patch.error === undefined) patch.error = null
      publishState(patch)
    }

    function loadSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      loadToken += 1
      var token = loadToken
      publishState({ loading: true, error: null })
      requestJson(ROUTE + '?sessionId=' + encodeURIComponent(sessionId), {
        method: 'GET',
        headers: { accept: 'application/json' },
      }).then(
        function (data) {
          if (token !== loadToken || state.sessionId !== sessionId) return
          applyServerPayload(data, { loading: false })
        },
        function (failure) {
          if (token !== loadToken || state.sessionId !== sessionId) return
          publishState({ loading: false, error: failureToError(failure, 'load') })
        },
      )
    }

    // Session identity is immutable. A seat cannot retarget another seat's work.
    function setCurrentSession(rawSessionId) {
      if (rawSessionId !== ownerSessionId || disposedRuntime) return
    }

    function reload() {
      var sessionId = state.sessionId
      if (sessionId === null) return
      loadSession(sessionId)
    }

    function postAction(body) {
      return requestJson(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    function addAnnotation(annotation, message) {
      var sessionId = state.sessionId
      if (sessionId === null) return
      var record = normalizeAnnotation(annotation)
      if (record === null) {
        publishState({ error: { code: 'invalid', message: '' } })
        return
      }
      loadToken += 1
      pendingAdds.set(record.id, record)
      publishState({ annotations: state.annotations.concat([record]), loading: false, error: null })
      // The wire copy comes from the raw record: it still carries the material text.
      var body = { action: 'add', sessionId: sessionId, annotation: wireRecord(annotation) }
      if (message && typeof message.text === 'string') body.message = message
      enqueueMutation(function () {
        return postAction(body).then(
          function (data) {
            if (state.sessionId !== sessionId || disposedRuntime) return
            pendingAdds.delete(record.id)
            if (data.annotation && typeof data.annotation.id === 'string') serverIds.set(record.id, data.annotation.id)
            applyServerPayload(data)
          },
          function (failure) {
            pendingAdds.delete(record.id)
            if (state.sessionId !== sessionId || disposedRuntime) return
            publishState({
              annotations: state.annotations.filter(function (item) {
                return item.id !== record.id
              }),
              error: failureToError(failure, 'add'),
            })
          },
        )
      })
    }

    function uniqueIds(ids) {
      var seen = Object.create(null)
      var unique = []
      if (!Array.isArray(ids)) return unique
      for (var index = 0; index < ids.length; index += 1) {
        var id = ids[index]
        if (typeof id === 'string' && id.length > 0 && seen[id] !== true) {
          seen[id] = true
          unique.push(id)
        }
      }
      return unique
    }

    function removeAnnotations(ids) {
      var sessionId = state.sessionId
      if (sessionId === null) return
      var unique = uniqueIds(ids)
      if (unique.length === 0) return
      var seen = Object.create(null)
      unique.forEach(function (id) {
        seen[id] = true
      })
      var removed = state.annotations.filter(function (item) {
        return seen[item.id] === true
      })
      if (removed.length === 0) return
      loadToken += 1
      publishState({
        annotations: state.annotations.filter(function (item) {
          return seen[item.id] !== true
        }),
        loading: false,
        error: null,
      })
      enqueueMutation(function () {
        return postAction({ action: 'remove', sessionId: sessionId, ids: resolvedIds(unique) }).then(
          function (data) {
            if (state.sessionId !== sessionId) return
            applyServerPayload(data)
          },
          function (failure) {
            if (state.sessionId !== sessionId) return
            var present = Object.create(null)
            state.annotations.forEach(function (item) {
              present[item.id] = true
            })
            var restored = state.annotations.concat(
              removed.filter(function (item) {
                return present[item.id] !== true
              }),
            )
            restored.sort(compareCreatedAt)
            publishState({ annotations: restored, error: failureToError(failure, 'remove') })
          },
        )
      })
    }

    function clearAll() {
      var sessionId = state.sessionId
      if (sessionId === null) return
      var previous = state.annotations
      if (previous.length === 0) {
        publishState({ error: null })
        return
      }
      loadToken += 1
      publishState({ annotations: [], loading: false, error: null })
      enqueueMutation(function () {
        return postAction({ action: 'clear', sessionId: sessionId }).then(
          function (data) {
            if (state.sessionId !== sessionId) return
            applyServerPayload(data)
          },
          function (failure) {
            if (state.sessionId !== sessionId) return
            publishState({ annotations: previous, error: failureToError(failure, 'clear') })
          },
        )
      })
    }

    function setStatus(ids, status) {
      var sessionId = state.sessionId
      if (sessionId === null) return
      var unique = uniqueIds(ids)
      var all = unique.length === 0
      var previous = state.annotations
      var changed = false
      var next = previous.map(function (item) {
        if (!all && unique.indexOf(item.id) < 0) return item
        if (item.status === status && status === 'resolved') return item
        if (item.status === status && status === 'pending' && item.injections === 0) return item
        changed = true
        var copy = {}
        for (var key in item) copy[key] = item[key]
        copy.status = status
        copy.resolvedBy = status === 'resolved' ? 'user' : ''
        if (status === 'pending') copy.injections = 0
        return copy
      })
      if (!changed) return
      loadToken += 1
      publishState({ annotations: next, loading: false, error: null })
      enqueueMutation(function () {
        return postAction({ action: status === 'resolved' ? 'resolve' : 'reopen', sessionId: sessionId, ids: resolvedIds(unique) }).then(
          function (data) {
            if (state.sessionId !== sessionId) return
            applyServerPayload(data)
          },
          function (failure) {
            if (state.sessionId !== sessionId) return
            publishState({ annotations: previous, error: failureToError(failure, 'resolve') })
          },
        )
      })
    }

    function setMode(mode) {
      var sessionId = state.sessionId
      var next = normalizeMode(mode)
      if (sessionId === null || next === state.mode) return
      var previous = state.mode
      publishState({ mode: next, error: null })
      enqueueMutation(function () {
        return postAction({ action: 'set-mode', sessionId: sessionId, mode: next }).then(
          function (data) {
            if (state.sessionId !== sessionId) return
            applyServerPayload(data)
          },
          function (failure) {
            if (state.sessionId !== sessionId) return
            publishState({ mode: previous, error: failureToError(failure, 'mode') })
          },
        )
      })
    }

    function copyOf(object, patch) {
      var next = {}
      for (var key in object) next[key] = object[key]
      for (var patchKey in patch) next[patchKey] = patch[patchKey]
      return next
    }

    function startMove(built) {
      if (state.sessionId === null || !built || !built.record) return
      publishState({
        pendingMove: { built: built, target: null, reason: '', error: built.message === null ? 'moveUnanchored' : '' },
      })
    }

    function setMoveTarget(target) {
      var pending = state.pendingMove
      if (!pending || !target || pending.error === 'moveUnanchored') return
      var record = pending.built.record
      var error = ''
      var replaces = typeof target.end === 'number' && target.end > target.offset
      if (pending.built.message && target.key !== pending.built.message.key) error = 'moveOtherMessage'
      else if (typeof record.messageStart === 'number') {
        if (replaces && target.offset < record.messageEnd && target.end > record.messageStart) error = 'moveOverlap'
        else if (!replaces && target.offset >= record.messageStart && target.offset <= record.messageEnd) error = 'moveSamePlace'
      }
      publishState({ pendingMove: copyOf(pending, { target: error === '' ? target : null, error: error }) })
    }

    function setMoveReason(text) {
      var pending = state.pendingMove
      if (!pending) return
      publishState({ pendingMove: copyOf(pending, { reason: clipString(String(text || ''), MAX_NOTE) }) })
    }

    function cancelMove() {
      if (state.pendingMove) publishState({ pendingMove: null })
    }

    function placeMove() {
      var pending = state.pendingMove
      if (!pending) return false
      if (pending.error === 'moveUnanchored') return false
      if (!pending.target) {
        publishState({ pendingMove: copyOf(pending, { error: pending.error || 'moveNoTarget' }) })
        return false
      }
      var record = copyOf(pending.built.record, {
        id: createClientId(),
        style: 'move',
        note: String(pending.reason || '').trim(),
        targetPrefix: pending.target.prefix,
        targetSuffix: pending.target.suffix,
        targetOffset: pending.target.offset,
        createdAt: new Date().toISOString(),
      })
      if (pending.target.quote) {
        record.targetQuote = pending.target.quote
        record.targetEnd = pending.target.end
      }
      publishState({ pendingMove: null })
      addAnnotation(record, pending.built.message)
      return true
    }

    function startReference(built) {
      if (state.sessionId === null || !built || !built.record) return
      publishState({
        referenceDraft: { token: {}, fileGeneration: 0, built: built, kind: 'text', title: '', content: '', url: '', fileName: '', text: '', error: '' },
      })
    }

    function patchReference(patch) {
      if (!state.referenceDraft) return
      if (patch.kind && patch.kind !== state.referenceDraft.kind) patch = copyOf(patch, { fileGeneration: state.referenceDraft.fileGeneration + 1 })
      publishState({ referenceDraft: copyOf(state.referenceDraft, patch) })
    }

    function cancelReference() {
      if (state.referenceDraft) publishState({ referenceDraft: null })
    }

    // Identity and generation guard every callback, including errors and a
    // second chooser result. Editing the title does not invalidate a read.
    function readReferenceFile(file, t, expectedToken) {
      var draft = state.referenceDraft
      if (!file || !draft || draft.kind !== 'file' || disposedRuntime || (expectedToken && draft.token !== expectedToken)) return
      var token = draft.token
      var generation = draft.fileGeneration + 1
      patchReference({ fileGeneration: generation, content: '', fileName: '', error: '' })
      function currentDraft() {
        var current = state.referenceDraft
        return !disposedRuntime && current && current.token === token && current.fileGeneration === generation && current.kind === 'file' ? current : null
      }
      function fail(key) {
        if (currentDraft()) patchReference({ error: t(key, { max: MAX_MATERIAL }), content: '', fileName: '' })
      }
      if (typeof file.size === 'number' && file.size > MAX_MATERIAL_FILE_BYTES) { fail('refTooLong'); return }
      try {
        var reader = new FileReader()
        reader.onload = function () {
          var current = currentDraft()
          if (!current) return
          var text = typeof reader.result === 'string' ? reader.result : ''
          if (text.indexOf('\u0000') >= 0 || !text.trim()) fail('refFileError')
          else if (text.length > MAX_MATERIAL) fail('refTooLong')
          else patchReference({ content: text, fileName: file.name, title: current.title || file.name, error: '' })
        }
        reader.onerror = function () { fail('refFileError') }
        reader.readAsText(file)
      } catch (error) { fail('refFileError') }
    }

    // Returns an error dictionary key, or '' once the reference is saved.
    function submitReference() {
      var draft = state.referenceDraft
      if (!draft) return ''
      if (!referenceReady(draft)) return draft.kind === 'url' ? 'refBadUrl' : ''
      var record = copyOf(draft.built.record, {
        style: 'reference',
        note: String(draft.text || '').trim().slice(0, MAX_NOTE),
        material: {
          kind: draft.kind,
          title: String(draft.title || '').trim(),
          content: draft.kind === 'url' ? String(draft.url || '').trim() : String(draft.content || ''),
        },
      })
      publishState({ referenceDraft: null })
      addAnnotation(record, draft.built.message)
      return ''
    }

    function setPanelOpen(open) {
      var next = open === true
      if (state.panelOpen === next) return
      publishState({ panelOpen: next })
      if (next && state.sessionId !== null) reload()
    }

    function togglePanel() {
      if (state.sessionId === null && state.panelOpen !== true) return
      setPanelOpen(state.panelOpen !== true)
    }

    var controller = {
      getState: getState,
      subscribe: subscribeState,
      setCurrentSession: setCurrentSession,
      reload: reload,
      addAnnotation: addAnnotation,
      removeAnnotations: removeAnnotations,
      clearAll: clearAll,
      resolve: function (ids) {
        setStatus(ids, 'resolved')
      },
      reopen: function (ids) {
        setStatus(ids, 'pending')
      },
      setMode: setMode,
      startMove: startMove,
      startReference: startReference,
      patchReference: patchReference,
      cancelReference: cancelReference,
      submitReference: submitReference,
      setMoveTarget: setMoveTarget,
      setMoveReason: setMoveReason,
      cancelMove: cancelMove,
      placeMove: placeMove,
      forgetLesson: forgetLesson,
      requestDistill: requestDistill,
      togglePanel: togglePanel,
      setPanelOpen: setPanelOpen,
    }

    function useControllerState() {
      return useSyncExternalStore(subscribeState, getState, getState)
    }

    function pendingCount(current) {
      var count = 0
      for (var index = 0; index < current.annotations.length; index += 1) {
        if (current.annotations[index].status !== 'resolved') count += 1
      }
      return count
    }

    // ------------------------------------------------------------- components

    function keepSelection(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
    }

    function ToolButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dsa-tool-btn',
          title: props.title,
          'aria-label': props.label,
          onPointerDown: keepSelection,
          onMouseDown: keepSelection,
          onClick: props.onClick,
        },
        props.glyph ? h('span', { className: 'dsa-tool-glyph dsa-tool-glyph-' + props.glyph, 'aria-hidden': 'true' }) : null,
        h('span', null, props.label),
        props.kbd ? h('span', { className: 'dsa-kbd', 'aria-hidden': 'true' }, props.kbd) : null,
      )
    }

    // Wrap a material name in 《》 unless it already starts with a title mark.
    function bookTitle(title) {
      var text = String(title || '').trim() || '—'
      return /^[《「“"]/.test(text) ? text : '《' + text + '》'
    }

    function referenceReady(draft) {
      if (!draft) return false
      if (draft.kind === 'url') return /^https?:\/\/\S+$/i.test(String(draft.url || '').trim())
      var length = String(draft.content || '').trim().length
      return length > 0 && length <= MAX_MATERIAL
    }

    // The action bar the Chat view mounts next to a selection. `props` carry the
    // area-local surface actions (dismiss / readText / clearSelection) plus the
    // standard session seat (sessionId, inputActions).
    function SelectionActions(props) {
      var t = props.t
      var sessionId = typeof props.sessionId === 'string' ? props.sessionId : null
      var current = useControllerState()
      var noteState = useState(null)
      var draft = noteState[0]
      var setDraft = noteState[1]
      var inputRef = useRef(null)

      useEffect(
        function () {
          if (sessionId !== null && current.sessionId !== sessionId) controller.setCurrentSession(sessionId)
        },
        [sessionId, current.sessionId],
      )
      var focusKey = draft === null ? '' : draft.style
      useEffect(
        function () {
          if (focusKey !== '' && inputRef.current && typeof inputRef.current.focus === 'function') {
            try {
              inputRef.current.focus()
            } catch (error) {
              /* focus is best effort */
            }
          }
        },
        [focusKey],
      )

      function dismiss() {
        if (typeof props.dismiss === 'function') props.dismiss()
      }

      function finish() {
        if (typeof props.clearSelection === 'function') props.clearSelection()
        dismiss()
      }

      function mark(style) {
        var range = admitSelection(props)
        if (range === null) {
          dismiss()
          return
        }
        var built = buildRecord(range, style)
        if (built === null) {
          dismiss()
          return
        }
        if (style === 'move') {
          controller.startMove(built)
          paintNow()
          finish()
          return
        }
        if (style === 'reference') {
          controller.startReference(built)
          paintNow()
          finish()
          return
        }
        if (NOTE_STYLES[style] === true) {
          setDraft({ style: style, built: built, text: '' })
          return
        }
        controller.addAnnotation(built.record, built.message)
        paintNow()
        finish()
      }

      function unmark() {
        var range = admitSelection(props)
        if (range === null) {
          dismiss()
          return
        }
        var hits = annotationsIntersecting(range)
        if (hits.length > 0) {
          controller.removeAnnotations(hits)
          paintNow()
        }
        finish()
      }

      function quote() {
        var text = typeof props.readText === 'function' ? props.readText() : null
        if (text === null) {
          dismiss()
          return
        }
        var actions = props.inputActions
        if (actions && typeof actions.insertQuote === 'function' && actions.insertQuote(text) === false) return
        finish()
      }

      function submitDraft() {
        if (draft === null) return
        var text = String(draft.text || '').trim()
        if (text.length === 0 || text.length > MAX_NOTE) return
        draft.built.record.note = text
        controller.addAnnotation(draft.built.record, draft.built.message)
        setDraft(null)
        paintNow()
        finish()
      }

      if (draft !== null) {
        var isRewrite = draft.style === 'rewrite'
        return h(
          'div',
          { className: 'dsa-toolbar is-note', role: 'dialog', 'aria-label': t(draft.style), 'data-dsh-mindmark-ui': String(runtimeId) },
          h(
            'div',
            { className: 'dsa-note-head' },
            h('span', { className: 'dsa-tool-glyph dsa-tool-glyph-' + draft.style, 'aria-hidden': 'true' }),
            h('span', null, t(draft.style)),
          ),
          h('p', { className: 'dsa-note-quote' }, previewQuote(draft.built.record.quote, 160)),
          h('textarea', {
            ref: inputRef,
            className: 'dsa-note-input',
            placeholder: t(isRewrite ? 'rewritePlaceholder' : 'commentPlaceholder'),
            value: draft.text,
            maxLength: MAX_NOTE,
            rows: 3,
            onChange: function (event) {
              setDraft({ style: draft.style, built: draft.built, text: event.target.value })
            },
            onKeyDown: function (event) {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setDraft(null)
                dismiss()
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submitDraft()
              }
            },
          }),
          h(
            'div',
            { className: 'dsa-note-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsa-btn',
                onClick: function () {
                  setDraft(null)
                  dismiss()
                },
              },
              t('cancel'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsa-btn is-primary', disabled: String(draft.text || '').trim().length === 0, onClick: submitDraft },
              t('confirm'),
            ),
          ),
        )
      }

      // While a passage waits to be dropped, a selection in the answer is the
      // text it would replace: offer exactly that.
      if (current.pendingMove !== null) {
        var pendingTarget = current.pendingMove.target
        var canReplace = pendingTarget !== null && Boolean(pendingTarget.quote) && !current.pendingMove.error
        return h(
          'div',
          { className: 'dsa-toolbar', role: 'toolbar', 'aria-label': t('move'), 'data-dsh-mindmark-ui': String(runtimeId) },
          canReplace
            ? h(ToolButton, {
                label: t('movePlaceReplace'),
                title: t('moveReplaceReady', { quote: previewQuote(pendingTarget.quote, 30) }),
                glyph: 'move',
                kbd: 'Alt+V',
                onClick: function () {
                  if (controller.placeMove()) paintNow()
                  finish()
                },
              })
            : h('span', { className: 'dsa-move-state is-error', style: { padding: '0 8px' } }, t(current.pendingMove.error || 'moveHowTo')),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-tool-close',
              title: t('cancel'),
              'aria-label': t('cancel'),
              onPointerDown: keepSelection,
              onMouseDown: keepSelection,
              onClick: function () {
                controller.cancelMove()
                paintNow()
                finish()
              },
            },
            '×',
          ),
        )
      }

      var hasQuote = props.inputActions && typeof props.inputActions.insertQuote === 'function'
      function styleButton(style) {
        return h(ToolButton, {
          key: style,
          label: t(style),
          title: t('hint.' + style),
          glyph: style,
          kbd: style === 'move' ? 'Alt+C' : null,
          onClick: function () {
            mark(style)
          },
        })
      }
      return h(
        'div',
        { className: 'dsa-toolbar is-rows', role: 'toolbar', 'aria-label': t('toolbarLabel'), 'data-dsh-mindmark-ui': String(runtimeId) },
        h(
          'div',
          { className: 'dsa-tool-row' },
          hasQuote ? h(ToolButton, { label: t('quote'), title: t('hint.quote'), glyph: 'quote', onClick: quote }) : null,
          hasQuote ? h('span', { className: 'dsa-tool-divider', 'aria-hidden': 'true' }) : null,
          QUICK_STYLES.map(styleButton),
          h('span', { className: 'dsa-tool-divider', 'aria-hidden': 'true' }),
          h(ToolButton, { label: t('unmark'), title: t('unmark'), onClick: unmark }),
          h('span', { className: 'dsa-spacer', 'aria-hidden': 'true' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-tool-close',
              title: t('close'),
              'aria-label': t('close'),
              onPointerDown: keepSelection,
              onMouseDown: keepSelection,
              onClick: dismiss,
            },
            '×',
          ),
        ),
        h('div', { className: 'dsa-tool-row' }, INPUT_STYLES.map(styleButton)),
      )
    }

    function ModeSwitch(props) {
      var t = props.t
      var sessionId = typeof props.sessionId === 'string' && props.sessionId.length > 0 ? props.sessionId : null
      var current = useControllerState()
      useEffect(
        function () {
          if (sessionId !== null && current.sessionId !== sessionId) controller.setCurrentSession(sessionId)
        },
        [sessionId, current.sessionId],
      )
      var inputActions = props.inputActions
      useEffect(
        function () {
          if (inputActions && typeof inputActions.setDraft === 'function') {
            draftSetter = function (text) {
              inputActions.setDraft(text)
            }
            return function () {
              draftSetter = null
            }
          }
          return undefined
        },
        [inputActions],
      )
      var isCurrent = sessionId !== null && current.sessionId === sessionId
      var pending = isCurrent ? pendingCount(current) : 0
      var mode = isCurrent ? current.mode : 'brief'
      var locked = props.locked === true
      return h(
        'div',
        { className: 'dsa-mode', 'data-dsh-mindmark-ui': String(runtimeId), title: t('modeTitle'), role: 'group', 'aria-label': t('modeLabel') },
        h('span', { className: 'dsa-mode-label' }, h(MarkerIcon, { size: 13 }), h('span', null, t('modeLabel'))),
        h(
          'span',
          { className: 'dsa-mode-seg' },
          MODES.map(function (option) {
            return h(
              'button',
              {
                key: option,
                type: 'button',
                className: 'dsa-mode-btn' + (mode === option ? ' is-on' : ''),
                title: t(option === 'full' ? 'modeFullHint' : 'modeBriefHint'),
                'aria-pressed': mode === option ? 'true' : 'false',
                disabled: locked || !isCurrent,
                onClick: function () {
                  controller.setMode(option)
                },
              },
              t(option === 'full' ? 'modeFull' : 'modeBrief'),
            )
          }),
        ),
        pending > 0 ? h('span', { className: 'dsa-mode-badge', title: t('pendingCount', { count: pending }) }, String(pending)) : null,
      )
    }

    function AnnotationItem(props) {
      var t = props.t
      var annotation = props.annotation
      var resolved = annotation.status === 'resolved'
      var time = formatTimestamp(annotation.createdAt)
      var by = annotation.resolvedBy === 'model' ? t('byModel') : annotation.resolvedBy === 'cap' ? t('byCap') : annotation.resolvedBy === 'user' ? t('byUser') : ''
      var note = null
      if (annotation.note) {
        var noteLabel = { rewrite: 'rewriteLabel', move: 'reasonLabel', reference: 'requirementLabel' }[annotation.style] || 'noteLabel'
        note = h('p', { className: 'dsa-note' }, h('b', null, t(noteLabel)), annotation.note)
      }
      var detail = null
      if (annotation.style === 'move') {
        detail = h(
          'p',
          { className: 'dsa-note' },
          h('b', null, t(annotation.targetQuote ? 'moveReplaceLabel' : 'moveTargetLabel')),
          annotation.targetQuote
            ? '「' + previewQuote(annotation.targetQuote, 60) + '」'
            : '…' + previewQuote(annotation.targetPrefix, 400).slice(-18) + ' ▮ ' + previewQuote(annotation.targetSuffix, 18).replace(/…$/, '') + '…',
        )
      } else if (annotation.style === 'reference' && annotation.material) {
        var material = annotation.material
        detail = h(
          'p',
          { className: 'dsa-note' },
          h('b', null, t('materialLabel')),
          material.kind === 'url'
            ? material.url
            : bookTitle(material.title) + ' ' + t('chars', { count: material.length }),
        )
      }
      return h(
        'div',
        { className: 'dsa-item' + (resolved ? ' is-resolved' : '') },
        h('span', { className: 'dsa-chip dsa-chip-' + annotation.style }, t(annotation.style)),
        h(
          'div',
          { className: 'dsa-item-main' },
          h('p', { className: 'dsa-quote' }, previewQuote(annotation.quote)),
          detail,
          note,
          h(
            'p',
            { className: 'dsa-meta' },
            h('span', { className: 'dsa-status' + (resolved ? '' : ' is-pending') }, resolved ? t('statusResolved') : t('statusPending')),
            resolved && by ? h('span', null, by) : null,
            time === '' ? null : h('span', null, time),
          ),
        ),
        h(
          'div',
          { className: 'dsa-item-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-item-btn',
              title: resolved ? t('reopen') : t('resolve'),
              'aria-label': resolved ? t('reopen') : t('resolve'),
              onClick: function () {
                if (resolved) controller.reopen([annotation.id])
                else controller.resolve([annotation.id])
                paintNow()
              },
            },
            resolved ? '↺' : '✓',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-item-btn is-del',
              title: t('delete'),
              'aria-label': t('delete'),
              onClick: function () {
                controller.removeAnnotations([annotation.id])
                paintNow()
              },
            },
            '×',
          ),
        ),
      )
    }

    function AnnotationPanel(props) {
      var t = props.t
      var current = props.state
      var canHighlight = props.canHighlight
      var annotations = Array.isArray(current.annotations) ? current.annotations : []
      var lessons = Array.isArray(current.lessons) ? current.lessons : []
      var pending = pendingCount(current)
      var loading = current.loading === true
      var items = annotations
        .slice()
        .reverse()
        .map(function (annotation) {
          return h(AnnotationItem, { key: annotation.id, t: t, annotation: annotation })
        })
      var body =
        loading && annotations.length === 0
          ? h('p', { className: 'dsa-loading' }, t('loading'))
          : annotations.length === 0
            ? h('p', { className: 'dsa-empty' }, t('empty'))
            : items
      return h(
        'div',
        { className: 'dsa-panel', role: 'dialog', 'aria-label': t('panelTitle'), 'aria-labelledby': PANEL_TITLE_ID },
        h(
          'div',
          { className: 'dsa-panel-head' },
          h('span', { className: 'dsa-panel-title', id: PANEL_TITLE_ID }, t('panelTitle')),
          annotations.length > 0 ? h('span', { className: 'dsa-panel-count' }, t('pendingCount', { count: pending })) : null,
          h('span', { className: 'dsa-spacer', 'aria-hidden': 'true' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-panel-close',
              title: t('close'),
              'aria-label': t('close'),
              onClick: function () {
                controller.setPanelOpen(false)
              },
            },
            '×',
          ),
        ),
        canHighlight ? null : h('p', { className: 'dsa-warning', role: 'status' }, t('warning')),
        current.error ? h('p', { className: 'dsa-error', role: 'alert' }, errorText(t, current.error)) : null,
        h('div', { className: 'dsa-panel-body' }, body),
        h(
          'div',
          { className: 'dsa-lessons' },
          h('p', { className: 'dsa-lessons-title' }, t('lessonsTitle') + (lessons.length > 0 ? ' · ' + lessons.length : '')),
          lessons.length === 0
            ? h('p', { className: 'dsa-lessons-empty' }, t('lessonsEmpty'))
            : lessons.map(function (lesson, index) {
                return h(
                  'div',
                  { className: 'dsa-lesson', key: lesson.text + index },
                  h('span', null, lesson.text),
                  lesson.date ? h('small', null, lesson.date) : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsa-item-btn is-del',
                      title: t('forget'),
                      'aria-label': t('forget'),
                      onClick: function () {
                        controller.forgetLesson(lesson.text)
                      },
                    },
                    '×',
                  ),
                )
              }),
        ),
        h(
          'div',
          { className: 'dsa-panel-foot' },
          h('p', { className: 'dsa-hint' }, t('footerHint')),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-btn is-primary',
              title: t('distillHint'),
              disabled: annotations.length === 0,
              onClick: function () {
                if (controller.requestDistill(t('distillPrompt'))) controller.setPanelOpen(false)
              },
            },
            t('distill'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-btn',
              disabled: pending === 0,
              onClick: function () {
                controller.resolve([])
                paintNow()
              },
            },
            t('resolveAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsa-btn',
              disabled: annotations.length === 0,
              onClick: function () {
                controller.clearAll()
                paintNow()
              },
            },
            t('clearAll'),
          ),
        ),
      )
    }

    function MoveBanner(props) {
      var t = props.t
      var pending = props.pending
      var target = pending.target
      var status
      if (pending.error) status = h('span', { className: 'dsa-move-state is-error' }, t(pending.error))
      else if (target && target.quote) {
        status = h('span', { className: 'dsa-move-state is-ready' }, t('moveReplaceReady', { quote: previewQuote(target.quote, 30) }))
      } else if (target) {
        status = h(
          'span',
          { className: 'dsa-move-state is-ready' },
          t('moveReady', {
            before: previewQuote(target.prefix, 400).slice(-12),
            after: previewQuote(target.suffix, 12).replace(/…$/, ''),
          }),
        )
      } else status = h('span', { className: 'dsa-move-state' }, t('moveHowTo'))
      return h(
        'div',
        { className: 'dsa-move-banner', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { className: 'dsa-move-text' },
          h('span', { className: 'dsa-move-title' }, t('moveBanner', { quote: previewQuote(pending.built.record.quote, 24) })),
          status,
        ),
        h('input', {
          className: 'dsa-move-reason',
          type: 'text',
          maxLength: MAX_NOTE,
          placeholder: t('moveReasonPlaceholder'),
          value: pending.reason,
          onChange: function (event) {
            controller.setMoveReason(event.target.value)
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (controller.placeMove()) paintNow()
            }
          },
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'dsa-btn is-primary',
            disabled: !target || pending.error === 'moveUnanchored',
            onMouseDown: keepSelection,
            onClick: function () {
              if (controller.placeMove()) paintNow()
            },
          },
          t('movePlace'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsa-btn',
            onMouseDown: keepSelection,
            onClick: function () {
              controller.cancelMove()
              paintNow()
            },
          },
          t('cancel'),
        ),
      )
    }

    // The reference form, rendered in the overlay so a native file dialog
    // (which blurs the window) cannot dismiss it.
    function ReferenceDialog(props) {
      var t = props.t
      var draft = props.draft
      var inputRef = useRef(null)
      var fileRef = useRef(null)
      var length = String(draft.content || '').trim().length

      useEffect(
        function () {
          if (inputRef.current && typeof inputRef.current.focus === 'function') {
            try {
              inputRef.current.focus()
            } catch (error) {
              /* focus is best effort */
            }
          }
        },
        [draft.kind],
      )

      function patch(next) {
        controller.patchReference(next)
      }

      function submit() {
        var problem = controller.submitReference()
        if (problem) patch({ error: t(problem) })
        else paintNow()
      }

      function cancel() {
        controller.cancelReference()
        paintNow()
      }

      function keys(event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          submit()
        }
      }

      function chooseFile() {
        var input = fileRef.current
        if (!input) return
        try {
          input.value = ''
          input.click()
        } catch (error) {
          patch({ error: t('refFileError') })
        }
      }

      function readFile(event) {
        var input = event && event.target
        readReferenceFile(input && input.files && input.files[0], t, draft.token)
      }

      var source
      if (draft.kind === 'url') {
        source = h('input', {
          ref: inputRef,
          className: 'dsa-ref-line',
          type: 'url',
          placeholder: t('refUrlPlaceholder'),
          value: draft.url,
          onChange: function (event) {
            patch({ url: event.target.value, error: '' })
          },
          onKeyDown: keys,
        })
      } else if (draft.kind === 'file') {
        source = h(
          'div',
          { className: 'dsa-ref-file' },
          h('button', { ref: inputRef, type: 'button', className: 'dsa-btn', onClick: chooseFile }, t('refFileChoose')),
          h('input', { ref: fileRef, type: 'file', accept: MATERIAL_FILE_ACCEPT, tabIndex: -1, onChange: readFile }),
          h('span', { title: draft.fileName }, draft.fileName ? draft.fileName + ' · ' + t('chars', { count: length }) : t('refFileNone')),
        )
      } else {
        source = h('textarea', {
          ref: inputRef,
          className: 'dsa-note-input',
          placeholder: t('refTextPlaceholder'),
          value: draft.content,
          rows: 5,
          onChange: function (event) {
            patch({ content: event.target.value, error: '' })
          },
          onKeyDown: keys,
        })
      }

      return h(
        'div',
        { className: 'dsa-toolbar is-note is-ref dsa-ref-dialog', role: 'dialog', 'aria-label': t('reference') },
        h(
          'div',
          { className: 'dsa-note-head' },
          h('span', { className: 'dsa-tool-glyph dsa-tool-glyph-reference', 'aria-hidden': 'true' }),
          h('span', null, t('reference')),
        ),
        h('p', { className: 'dsa-note-quote' }, previewQuote(draft.built.record.quote, 160)),
        h(
          'div',
          { className: 'dsa-ref-tabs', role: 'tablist' },
          MATERIAL_KINDS.map(function (kind) {
            var label = kind === 'url' ? 'refTabUrl' : kind === 'file' ? 'refTabFile' : 'refTabText'
            return h(
              'button',
              {
                key: kind,
                type: 'button',
                role: 'tab',
                'aria-selected': draft.kind === kind ? 'true' : 'false',
                className: 'dsa-ref-tab' + (draft.kind === kind ? ' is-on' : ''),
                onClick: function () {
                  patch({ kind: kind, error: '' })
                },
              },
              t(label),
            )
          }),
        ),
        draft.kind === 'url'
          ? null
          : h('input', {
              className: 'dsa-ref-line',
              type: 'text',
              maxLength: 120,
              placeholder: t('refTitlePlaceholder'),
              value: draft.title,
              onChange: function (event) {
                patch({ title: event.target.value })
              },
              onKeyDown: keys,
            }),
        source,
        draft.kind === 'text'
          ? h('div', { className: 'dsa-ref-meta' }, h('span', null, ''), h('span', null, t('chars', { count: length })))
          : draft.kind === 'file'
            ? h('div', { className: 'dsa-ref-meta' }, h('span', null, t('refFileHint')))
            : null,
        h('textarea', {
          className: 'dsa-note-input is-small',
          placeholder: t('refNotePlaceholder'),
          value: draft.text,
          maxLength: MAX_NOTE,
          rows: 2,
          onChange: function (event) {
            patch({ text: event.target.value })
          },
          onKeyDown: keys,
        }),
        draft.error ? h('p', { className: 'dsa-ref-error', role: 'alert' }, draft.error) : null,
        h(
          'div',
          { className: 'dsa-note-actions' },
          h('button', { type: 'button', className: 'dsa-btn', onClick: cancel }, t('cancel')),
          h('button', { type: 'button', className: 'dsa-btn is-primary', disabled: !referenceReady(draft), onClick: submit }, t('confirm')),
        ),
      )
    }

    function AnnotationOverlay(props) {
      var t = props.t
      var current = useControllerState()
      var moving = current.pendingMove !== null && current.sessionId !== null
      var referencing = current.referenceDraft !== null && current.sessionId !== null
      if (!current.panelOpen && !moving && !referencing) return null
      return h(
        'div',
        { className: 'dsa-layer', 'data-dsh-mindmark-ui': String(runtimeId) },
        current.panelOpen ? h(AnnotationPanel, { t: t, state: current, canHighlight: supportsHighlights() }) : null,
        moving && !referencing ? h(MoveBanner, { t: t, pending: current.pendingMove }) : null,
        referencing ? h(ReferenceDialog, { t: t, draft: current.referenceDraft }) : null,
      )
    }

    function AnnotationHeader(props) {
      var t = props.t
      var sessionId = typeof props.sessionId === 'string' && props.sessionId.length > 0 ? props.sessionId : null
      var current = useControllerState()
      useEffect(
        function () {
          controller.setCurrentSession(sessionId)
          return function () {}
        },
        [sessionId],
      )
      var isCurrent = sessionId !== null && current.sessionId === sessionId
      var count = isCurrent ? pendingCount(current) : 0
      var panelOpen = isCurrent && current.panelOpen === true
      var title = count > 0 ? t('headerTitle', { count: count }) : t('headerLabel')
      return h(
        'button',
        {
          type: 'button',
          'data-dsh-mindmark-ui': String(runtimeId),
          className: 'dsa-header-btn' + (panelOpen ? ' is-active' : ''),
          title: title,
          'aria-label': title,
          'aria-expanded': panelOpen ? 'true' : 'false',
          onClick: function () {
            controller.togglePanel()
          },
        },
        h(MarkerIcon, { size: 16 }),
        count > 0 ? h('span', { className: 'dsa-header-badge', 'aria-hidden': 'true' }, String(count)) : null,
      )
    }

    // ---------------------------------------------------------------- runtime

    function addListener(target, type, handler, capture) {
      var useCapture = capture === true
      try {
        target.addEventListener(type, handler, useCapture)
      } catch (error) {
        console.error('dsh-mindmark: cannot listen for ' + type, error)
      }
      return function () {
        try {
          target.removeEventListener(type, handler, useCapture)
        } catch (error) {
          console.error('dsh-mindmark: cannot stop listening for ' + type, error)
        }
      }
    }

    function observeMutations(target, handler) {
      try {
        if (typeof MutationObserver !== 'function' || !target || typeof target.nodeType !== 'number') return function () {}
        var observer = new MutationObserver(handler)
        observer.observe(target, { childList: true, subtree: true, characterData: true })
        return function () {
          try {
            observer.disconnect()
          } catch (error) {
            console.error('dsh-mindmark: cannot disconnect the mutation observer', error)
          }
        }
      } catch (error) {
        console.error('dsh-mindmark: cannot observe the DOM', error)
        return function () {}
      }
    }

    // Re-anchoring plumbing only: the Chat view owns selection gestures now.
    function installRuntime() {
      var disposers = []
      var disposed = false
      var watchedSessionId = getState().sessionId
      var watchedAnnotations = getState().annotations
      var watchedMove = getState().pendingMove
      var watchedRef = getState().referenceDraft

      function onScrollOrResize() {
        if (disposed) return
        hideCaretsWhileScrolling()
        schedulePaint(MUTATION_DEBOUNCE)
      }

      function isEditableTarget(target) {
        var element = elementOfNode(target)
        if (!element) return false
        var tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : ''
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
        try {
          return element.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]') !== null
        } catch (error) {
          return false
        }
      }

      // Alt+C: pick up the selected passage of an answer.
      function beginMoveFromSelection() {
        if (getState().sessionId === null) return false
        var range = readLiveRange()
        if (range === null) return false
        var body = messageBodyOf(range.startContainer)
        if (body === null || body !== messageBodyOf(range.endContainer)) return false
        var built = buildRecord(range, 'move')
        if (built === null) return false
        controller.startMove(built)
        try {
          window.getSelection().removeAllRanges()
        } catch (error) {
          /* the selection stays; harmless */
        }
        paintNow()
        return true
      }

      function onKeyDown(event) {
        if (disposed || !event) return
        var targetElement = elementOfNode(event.target)
        var ui = targetElement && targetElement.closest(UI_SELECTOR)
        if (ui) {
          if (ui.getAttribute(UI_ATTR) !== String(runtimeId)) return
        } else if (!ownsBody(targetElement)) {
          // Non-focusable answer text leaves keyboard focus on body. In that
          // case use the live range's explicit session, never a global current.
          if (targetElement !== document.body && targetElement !== document.documentElement) return
          var selection = typeof window.getSelection === 'function' ? window.getSelection() : null
          if (!selection || selection.rangeCount !== 1) return
          var selectedRange = selection.getRangeAt(0)
          var selectedBody = messageBodyOf(selectedRange.startContainer)
          if (!selectedBody || !ownsBody(selectedBody) || selectedBody !== messageBodyOf(selectedRange.endContainer)) return
        }
        var code = event.code
        if (
          event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
          (code === 'KeyC' || code === 'KeyV')
        ) {
          // Typing Alt+C in the composer or any other field is not ours.
          if (isEditableTarget(event.target) && !isOurUiNode(event.target)) return
          if (event.repeat) {
            if (code === 'KeyC' || getState().pendingMove) event.preventDefault()
            return
          }
          if (code === 'KeyC') {
            if (beginMoveFromSelection()) {
              event.preventDefault()
              event.stopPropagation()
            }
            return
          }
          if (getState().pendingMove) {
            event.preventDefault()
            event.stopPropagation()
            if (!isOurUiNode(event.target)) {
              var target = caretTarget()
              if (target !== null) controller.setMoveTarget(target)
            }
            if (controller.placeMove()) paintNow()
          }
          return
        }
        if (event.key !== 'Escape' && event.key !== 'Esc') return
        if (getState().referenceDraft) {
          controller.cancelReference()
          paintNow()
          return
        }
        if (getState().pendingMove) {
          controller.cancelMove()
          paintNow()
          return
        }
        if (getState().panelOpen === true && !isOurUiNode(event.target)) controller.setPanelOpen(false)
      }

      // While a passage waits to be dropped, every click in an answer moves the target.
      function onSelectionChange() {
        if (disposed || !getState().pendingMove) return
        var target = caretTarget()
        if (target !== null) controller.setMoveTarget(target)
      }

      function onMutations(mutations) {
        if (disposed) return
        try {
          for (var index = 0; index < mutations.length; index += 1) {
            if (!isOurUiNode(mutations[index].target)) {
              schedulePaint(MUTATION_DEBOUNCE)
              return
            }
          }
        } catch (error) {
          console.error('dsh-mindmark: mutation handling failed', error)
        }
      }

      function onControllerChange() {
        if (disposed) return
        var current = getState()
        if (
          current.sessionId !== watchedSessionId ||
          current.annotations !== watchedAnnotations ||
          current.pendingMove !== watchedMove ||
          (current.referenceDraft === null) !== (watchedRef === null)
        ) {
          watchedRef = current.referenceDraft
          watchedSessionId = current.sessionId
          watchedAnnotations = current.annotations
          watchedMove = current.pendingMove
          schedulePaint(STATE_REPAINT_DELAY)
        }
      }

      if (typeof document !== 'undefined') {
        disposers.push(addListener(document, 'keydown', onKeyDown, true))
        disposers.push(addListener(document, 'selectionchange', onSelectionChange, false))
        disposers.push(addListener(document, 'scroll', onScrollOrResize, true))
        if (typeof window !== 'undefined') disposers.push(addListener(window, 'resize', onScrollOrResize, false))
        if (document.body) disposers.push(observeMutations(document.body, onMutations))
      }
      disposers.push(subscribeState(onControllerChange))

      return function () {
        disposed = true
        cancelPaintTimer()
        for (var index = 0; index < disposers.length; index += 1) {
          try {
            disposers[index]()
          } catch (error) {
            console.error('dsh-mindmark: disposer failed', error)
          }
        }
        disposers.length = 0
        clearHighlights()
      }
    }

    function installStyles() {
      if (typeof document === 'undefined') return function () {}
      var tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', CSS_ID)
      tag.textContent = CSS_TEXT.replace(/::highlight\(([^)]+)\)/g, function (_, name) { return '::highlight(' + name + '-' + runtimeId + ')' })
      var mount = document.head || document.documentElement
      if (!mount) return function () {}
      mount.appendChild(tag)
      return function () {
        if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
      }
    }

    if (locale && typeof locale.getSnapshot === 'function' && typeof locale.subscribe === 'function') localeService = locale
    var stopRuntime = null
    var stopStyles = null
    return {
      SelectionActions: WithTranslate(SelectionActions),
      ModeSwitch: WithTranslate(ModeSwitch),
      AnnotationHeader: WithTranslate(AnnotationHeader),
      AnnotationOverlay: WithTranslate(AnnotationOverlay),
      start: function () {
        if (stopRuntime) return
        stopStyles = installStyles()
        stopRuntime = installRuntime()
        loadSession(ownerSessionId)
      },
      dispose: function () {
        disposedRuntime = true
        loadToken += 1
        state.referenceDraft = null
        if (stopRuntime) stopRuntime()
        if (stopStyles) stopStyles()
        pendingAdds.clear()
        serverIds.clear()
        stateListeners.clear()
      },
    }
    }

    function injectSlot(slots, name, options, component) {
      try {
        slots.inject(name, function () {
          return slots.register(options, component)
        })
      } catch (error) {
        console.error('dsh-mindmark: cannot register into ' + name, error)
      }
    }

    function getService(ctx, key) {
      try {
        if (ctx && typeof ctx.get === 'function') {
          var found = ctx.get(key)
          if (found) return found
        }
      } catch (error) {
        /* fall through */
      }
      try {
        return ctx ? ctx[key] : null
      } catch (error) {
        return null
      }
    }

    // ------------------------------------------------------------------ plugin

    function apply(ctx) {
      var locale = getService(ctx, 'locale')
      var runtimes = new Map()
      var serial = 0
      var listeners = new Set()
      var snapshot = []
      function changed() { snapshot = Array.from(runtimes.values()); listeners.forEach(function (f) { f() }) }
      function subscribe(f) { listeners.add(f); return function () { listeners.delete(f) } }
      function getSnapshot() { return snapshot }
      function SessionSeat(props) {
        var sessionId = props.sessionId
        var holder = useState(null)
        useEffect(function () {
          if (typeof sessionId !== 'string' || !sessionId) return
          var entry = runtimes.get(sessionId)
          if (!entry) {
            entry = { sessionId: sessionId, refs: 0, runtime: createSessionRuntime(sessionId, ++serial, locale) }
            runtimes.set(sessionId, entry)
            entry.runtime.start()
            changed()
          }
          entry.refs += 1
          holder[1](entry)
          return function () {
            entry.refs -= 1
            if (!entry.refs) {
              entry.runtime.dispose()
              runtimes.delete(sessionId)
              changed()
            }
          }
        }, [sessionId])
        var entry = holder[0]
        if (!entry || entry.sessionId !== sessionId) return null
        return h(entry.runtime[props.component], props)
      }
      function seat(component) {
        return function (props) { return h(SessionSeat, Object.assign({}, props, { component: component })) }
      }
      function Overlays() {
        var entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
        return h(React.Fragment, null, entries.map(function (entry) {
          return h(entry.runtime.AnnotationOverlay, { key: entry.sessionId })
        }))
      }
      if (ctx && typeof ctx.effect === 'function') ctx.effect(function () {
        return function () {
          runtimes.forEach(function (entry) { entry.runtime.dispose() })
          runtimes.clear()
          changed()
        }
      }, 'dsh-mindmark-hardened: session runtimes')

      var slots = getService(ctx, 'slots')
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        console.error('dsh-mindmark: the slots service is unavailable; the client half cannot render')
        return
      }

      var actions = seat('SelectionActions')
      // Take over the Quote plugin's selection surface (it still admits the
      // gesture and we keep Quote as the first action) …
      injectSlot(
        slots,
        'conversation.chat.text-interaction',
        { name: 'conversation.chat.text-interaction', key: 'quote', priority: -10 },
        actions,
      )
      // … and own a surface of our own for hosts without the Quote plugin.
      injectSlot(
        slots,
        'conversation.chat.text-interaction',
        { name: 'conversation.chat.text-interaction', key: 'dsh-mindmark-hardened' },
        actions,
      )
      var conversation = getService(ctx, 'uiConversation')
      if (conversation && conversation.interactions && typeof conversation.interactions.register === 'function') {
        try {
          ctx.effect(
            function () {
              return conversation.interactions.register({
                id: 'dsh-mindmark-hardened',
                onInteraction: function (request) {
                  if (request.trigger !== 'selection' || request.readText() === null) return
                  request.open()
                },
              })
            },
            'dsh-mindmark: selection interaction',
          )
        } catch (error) {
          console.error('dsh-mindmark: cannot register the selection interaction', error)
        }
      }

      injectSlot(
        slots,
        'conversation.input.left',
        { name: 'conversation.input.left', id: 'dsh-mindmark.mode', order: 60 },
        seat('ModeSwitch'),
      )
      injectSlot(
        slots,
        'conversation.session.header.utilities',
        { name: 'conversation.session.header.utilities', id: 'dsh-mindmark', order: 40 },
        seat('AnnotationHeader'),
      )
      injectSlot(
        slots,
        'shell.overlay',
        { name: 'shell.overlay', id: 'dsh-mindmark.overlay', order: 40 },
        Overlays,
      )
    }

    exports.apply = apply
    // Wait for the host locale service instead of capturing a startup fallback.
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
