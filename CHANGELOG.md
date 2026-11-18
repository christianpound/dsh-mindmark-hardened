# 更新记录 / Changelog

## 0.4.1-hardened.2

- Explicitly depend on the Client locale service so annotation controls follow DSH's language setting.
- Default to English, rather than Chinese, when locale information is absent or fails.
- Added regression tests for fallback labels, habit prompts and live language changes.

## 0.4.1-hardened.1

- Forked upstream 0.4.0; retained MIT attribution and seven annotation styles.
- Required DSH browser-owner authentication and same-origin requests; removed permissive CORS.
- Added session-isolated material paths, server UUIDs, safe map keys and isolated storage.
- Required explicit human confirmation for model-requested global instruction changes; sanitized delimiters and removed inferred consent.
- Bound file reads, UI state and DOM anchors to their owning draft/session/message.
- Added host, storage and client security regressions; documented provider disclosure and retention.

## v0.4.0

新增两种标记，标记从五种变成七种；选区浮条分成两排。

- **依据**：选中一段，挂上参考材料，助手只按材料改这一段，并说明改动依据了材料的哪一句。
  - 材料可以粘贴文本、贴链接，或选一个纯文本文件（txt、md、csv、json、html 等）。
  - 2000 字以内的材料随标注整段发给助手；更长的只发开头摘录，助手需要时自己分段读全文。
  - 材料单独存放，删标注时一起删。
- **移动**：像剪切粘贴一样挪动一段文字。
  - 选中一段按 Alt+C 拿起，在同一条回答里点一下，出现闪烁竖线，这段会插到竖线之后。
  - 拖选一段文字作为目标，则用被移动的那段替换它。
  - 按 Alt+V 放下，Esc 取消；提示条里可以写一句为什么要移。
- **浮条分两排**：第一排点一下就生效（引用、高亮、下划线、删除、清除标记），第二排要补充内容（批注、改写、依据、移动）。
- 修复：精简模式发给助手的上下文只取回答正文，不再混进思考过程等页面文字。

## v0.3.0

- 沉淀为习惯：让助手把反复出现的标注归纳成一句话偏好，写进全局 `AGENTS.md`，新对话自动遵守。
- 演示 GIF、英文 README，发布到 npm。

## v0.2.0

- 第一版：高亮、下划线、删除、批注、改写五种标记；精简和完整两种注入模式；助手处理后回传确认。
