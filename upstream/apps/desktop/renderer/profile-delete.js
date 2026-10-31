/* 弹窗逻辑：语言跟随页面 locale，文案全部走 copy；确认后由壳执行真正的删除。 */
const zh = navigator.language.toLowerCase().startsWith('zh')
const copy = zh
  ? { title: '删除 Profile', message: '确定要删除这个 Profile 吗？', hint: '整目录删除，不可恢复。', cancel: '取消', ok: '删除' }
  : { title: 'Delete Profile', message: 'Delete this profile?', hint: 'The whole directory is removed and cannot be recovered.', cancel: 'Cancel', ok: 'Delete' }

document.title = copy.title
document.querySelector('h1').textContent = copy.title

const params = new URLSearchParams(location.search)
const name = params.get('name') ?? ''
const api = window.dshProfileDelete
const ok = document.getElementById('ok')
const cancel = document.getElementById('cancel')
const message = document.getElementById('message')
const hint = document.getElementById('hint')

message.textContent = `${copy.message}（${name}）`
hint.textContent = copy.hint
cancel.textContent = copy.cancel
ok.textContent = copy.ok

ok.addEventListener('click', () => { void api.confirm() })
cancel.addEventListener('click', () => { void api.cancel() })
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') ok.click()
  if (event.key === 'Escape') void api.cancel()
})
ok.focus()
