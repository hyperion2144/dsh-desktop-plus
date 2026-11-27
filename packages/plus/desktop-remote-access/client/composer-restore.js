//! 发送失败后把正文放回输入框。
//!
//! 远程会话的请求发不出去时，内容留在消息记录里会让人以为「发出去了、只是在等回复」。
//! 这里把它退回输入框：用户可以直接重试，记录里也不会留一条没有回答的消息。

const COMPOSER_SELECTORS = [
  '[data-dsh-composer-input]',
  'textarea[data-dsh-composer]',
  'textarea',
  '[contenteditable="true"]',
];

function findComposer() {
  for (const selector of COMPOSER_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const usable = nodes.filter((node) => node instanceof HTMLElement && node.offsetParent !== null);
    if (usable.length > 0) return usable[usable.length - 1];
  }
  return undefined;
}

function writeTextarea(element, text) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  if (descriptor === undefined || descriptor.set === undefined) return false;
  // React 受控组件只认原生 setter 触发的变化，直接赋值会被下一次渲染覆盖。
  descriptor.set.call(element, text);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function writeEditable(element, text) {
  element.textContent = text;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  return true;
}

/**
 * 把一段正文放回输入框，并让输入框获得焦点。
 *
 * @param text 要恢复的正文。
 * @returns 找到并写入输入框时返回 true。
 */
export function restoreComposer(text) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  const composer = findComposer();
  if (composer === undefined) return false;
  const written = composer instanceof HTMLTextAreaElement
    ? writeTextarea(composer, text)
    : writeEditable(composer, text);
  if (!written) return false;
  composer.focus();
  return true;
}
