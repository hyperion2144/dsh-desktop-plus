//! 远程访问的轻量提示。
//!
//! 转发失败必须让人看见：远程会话的请求不会再退回本机，界面上如果还是没反应，
//! 用户会以为「点了没生效」。这里用一个独立浮层把原因直接贴出来。

const CONTAINER_ATTR = 'data-dsh-remote-toast';
const DURATION_MS = 6000;

const containerStyle = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9998;'
  + 'display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';

const pillStyle = 'max-width:min(560px,calc(100vw - 48px));padding:8px 14px;border-radius:10px;'
  + 'background:var(--dsw-alias-bg-layer-2,rgba(28,28,30,.92));color:var(--dsw-alias-label-primary,#fff);'
  + 'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));'
  + 'box-shadow:0 8px 24px rgba(0,0,0,.24);font-size:13px;line-height:20px;';

function container() {
  let node = document.querySelector('[' + CONTAINER_ATTR + ']');
  if (node !== null) return node;
  node = document.createElement('div');
  node.setAttribute(CONTAINER_ATTR, '1');
  node.style.cssText = containerStyle;
  document.body.appendChild(node);
  return node;
}

/**
 * 显示一条远程访问相关的提示。
 *
 * @param text 提示正文。
 * @returns 关闭该提示的函数。
 */
export function showRemoteToast(text) {
  const host = container();
  const pill = document.createElement('div');
  pill.style.cssText = pillStyle;
  pill.textContent = text;
  host.appendChild(pill);
  const timer = setTimeout(() => { pill.remove(); }, DURATION_MS);
  return () => { clearTimeout(timer); pill.remove(); };
}
