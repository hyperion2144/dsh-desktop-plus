//! 「分享到远程」的对话框。
//!
//! 菜单项被点一下，官方菜单就会卸载——对话框不能长在菜单的子树里，否则刚挂上就跟着没了。
//! 所以这里用原生 DOM 直接挂在 document.body 上，生命周期与菜单无关。
//! 样式全部走 DSH 的语义 token，跟随主题。

const Z = 9999;

const css = {
  overlay: `position:fixed;inset:0;z-index:${Z};display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);`,
  panel: 'display:flex;flex-direction:column;gap:12px;width:380px;max-width:calc(100vw - 32px);padding:16px;border-radius:12px;'
    + 'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);'
    + 'border:1px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.18);font-size:13px;',
  label: 'display:flex;flex-direction:column;gap:4px;',
  hint: 'color:var(--dsw-alias-label-secondary);font-size:12px;',
  input: 'box-sizing:border-box;width:100%;padding:6px 10px;border-radius:8px;font:inherit;color:inherit;'
    + 'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);',
  footer: 'display:flex;justify-content:flex-end;gap:8px;',
  button: 'box-sizing:border-box;padding:6px 12px;border-radius:8px;font:inherit;cursor:pointer;'
    + 'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);'
    + 'border:1px solid var(--dsw-alias-border-l2);',
  primary: 'box-sizing:border-box;padding:6px 12px;border-radius:8px;font:inherit;cursor:pointer;border:none;'
    + 'background:var(--dsw-alias-brand-1,#4d6bfe);color:#fff;',
  noticeError: 'font-size:12px;color:#ef4444;',
  noticeOk: 'font-size:12px;color:#16a34a;',
};

function element(tag, style, text) {
  const node = document.createElement(tag);
  if (style !== undefined) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 打开分享对话框。
 *
 * @param {object} options 会话、宿主调用与「分享关系变了」的回调。
 * @returns {void}
 */
export function openShareDialog({ sessionId, hostCall, mode = 'share', onChanged }) {
  const previous = document.querySelector('[data-dsh-remote-share-dialog]');
  if (previous !== null) previous.remove();

  const overlay = element('div', css.overlay);
  overlay.setAttribute('data-dsh-remote-share-dialog', '1');
  const panel = element('div', css.panel);
  overlay.appendChild(panel);
  panel.appendChild(element('div', 'font-weight:600;', mode === 'manage' ? '分享管理' : '分享到远程'));

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  const notice = element('div', css.noticeError);
  notice.style.display = 'none';
  const say = (kind, text) => {
    notice.style.cssText = kind === 'ok' ? css.noticeOk : css.noticeError;
    notice.style.display = 'block';
    notice.textContent = text;
  };

  if (mode === 'manage') {
    const list = element('div', 'display:flex;flex-direction:column;gap:8px;');
    panel.appendChild(list);
    const footer = element('div', css.footer);
    const closeButton = element('button', css.button, '关闭');
    closeButton.type = 'button';
    closeButton.addEventListener('click', close);
    footer.appendChild(closeButton);
    panel.appendChild(notice);
    panel.appendChild(footer);

    const refresh = async () => {
      list.textContent = '';
      try {
        const state = await hostCall('remoteShare.list', { sessionId });
        const shares = Array.isArray(state?.shares) ? state.shares : [];
        if (shares.length === 0) {
          list.appendChild(element('div', 'opacity:.7;', '还没有分享给任何设备。'));
          return;
        }
        for (const share of shares) {
          const row = element('div', 'display:flex;align-items:center;gap:8px;');
          row.appendChild(element('span', 'flex:1;', share.deviceId));
          row.appendChild(element('span', 'opacity:.6;font-size:12px;', share.viewers > 0 ? '在线' : '离线'));
          const remove = element('button', css.button, '撤销');
          remove.type = 'button';
          remove.addEventListener('click', async () => {
            remove.disabled = true;
            try {
              await hostCall('remoteShare.remove', { sessionId, deviceId: share.deviceId });
              await refresh();
              onChanged?.();
            } catch (error) {
              say('error', String(error?.message ?? error));
            } finally {
              remove.disabled = false;
            }
          });
          row.appendChild(remove);
          list.appendChild(row);
        }
      } catch (error) {
        say('error', String(error?.message ?? error));
      }
    };
    void refresh();
    document.body.appendChild(overlay);
    return;
  }

  const deviceLabel = element('label', css.label);
  deviceLabel.appendChild(element('span', css.hint, '目标设备'));
  const select = element('select', css.input);
  deviceLabel.appendChild(select);
  panel.appendChild(deviceLabel);

  const pathLabel = element('label', css.label);
  pathLabel.appendChild(element('span', css.hint, '对端项目目录'));
  const pathInput = element('input', css.input);
  pathInput.placeholder = '/path/to/project';
  pathLabel.appendChild(pathInput);
  panel.appendChild(pathLabel);

  const footer = element('div', css.footer);
  const cancel = element('button', css.button, '取消');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  const confirm = element('button', css.primary, '确认分享');
  confirm.type = 'button';
  footer.appendChild(cancel);
  footer.appendChild(confirm);
  panel.appendChild(notice);
  panel.appendChild(footer);

  let deviceId = '';
  const syncConfirm = () => { confirm.disabled = deviceId === '' || pathInput.value.trim() === ''; };
  syncConfirm();

  void (async () => {
    try {
      const state = await hostCall('devices.list');
      const devices = Array.isArray(state?.devices) ? state.devices : [];
      select.textContent = '';
      if (devices.length === 0) {
        select.appendChild(element('option', undefined, '（还没有已配对设备）'));
        select.value = '';
      } else {
        for (const device of devices) {
          const option = element('option', undefined, device.name || device.deviceId);
          option.value = device.deviceId;
          select.appendChild(option);
        }
        deviceId = devices[0].deviceId;
        select.value = deviceId;
      }
      syncConfirm();
    } catch (error) {
      say('error', String(error?.message ?? error));
    }
    try {
      const state = await hostCall('remoteWorkspace.list');
      const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : [];
      const match = workspaces.find((entry) => entry.sessionIds?.includes?.(sessionId));
      if (typeof match?.path === 'string') pathInput.value = match.path;
    } catch {
      // 拿不到就留空，用户自己填。
    }
    syncConfirm();
  })();

  select.addEventListener('change', () => { deviceId = select.value; syncConfirm(); });
  pathInput.addEventListener('input', syncConfirm);

  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    confirm.textContent = '分享中…';
    try {
      await hostCall('remoteShare.add', { sessionId, deviceId, path: pathInput.value.trim() });
      onChanged?.();
      close();
    } catch (error) {
      say('error', String(error?.message ?? error));
      confirm.textContent = '确认分享';
      syncConfirm();
    }
  });

  document.body.appendChild(overlay);
  pathInput.focus();
}
