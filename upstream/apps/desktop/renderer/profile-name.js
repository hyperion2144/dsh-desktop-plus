/* 弹窗逻辑：语言跟随页面 locale（与 splash/官方同一套判定），文案全部走 copy。 */
const zh = navigator.language.toLowerCase().startsWith('zh')
const copy = zh
  ? { title: '新建 Profile', label: '名称（小写字母、数字、连字符）', hint: '会在 $DSH_HOME/profiles 下建一份独立的 profile。', cancel: '取消', ok: '创建', busy: '创建中…', busyHint: '正在创建 profile，请不要关闭窗口…', invalid: '只能用小写字母、数字与连字符，且以字母或数字开头', failed: '创建失败' }
  : { title: 'New Profile', label: 'Name (lowercase letters, digits, hyphens)', hint: 'Creates an independent profile under $DSH_HOME/profiles.', cancel: 'Cancel', ok: 'Create', busy: 'Creating…', busyHint: 'Creating the profile. Keep this window open…', invalid: 'Use lowercase letters, digits and hyphens; start with a letter or digit', failed: 'Could not create the profile' }

document.title = copy.title
document.querySelector('h1').textContent = copy.title
document.querySelector('label').textContent = copy.label

const api = window.dshProfileName
const input = document.getElementById('name')
const ok = document.getElementById('ok')
const cancel = document.getElementById('cancel')
const error = document.getElementById('error')
const hint = document.getElementById('hint')
const VALID = /^[a-z0-9][a-z0-9-]*$/

hint.textContent = copy.hint
cancel.textContent = copy.cancel
ok.textContent = copy.ok

const showError = (text) => {
  error.textContent = text
  error.hidden = false
}

const submit = () => {
  const name = input.value.trim()
  if (!VALID.test(name)) {
    showError(copy.invalid)
    return
  }
  ok.disabled = true
  ok.textContent = copy.busy
  hint.textContent = copy.busyHint
  void api.submit(name).then((result) => {
    if (result.ok) return
    ok.disabled = false
    ok.textContent = copy.ok
    hint.textContent = copy.hint
    showError(typeof result.reason === 'string' ? result.reason : copy.failed)
  })
}

ok.addEventListener('click', submit)
cancel.addEventListener('click', () => { void api.cancel() })
input.addEventListener('keydown', (event) => {
  // IME 组词期间（拼音未上屏）的 Enter/Escape 是输入法操作，不触发提交或取消。
  if (event.isComposing) return
  if (event.key === 'Enter') submit()
  if (event.key === 'Escape') void api.cancel()
})
input.addEventListener('input', () => {
  // 旧校验结果随输入作废：红字只描述上一次提交，最终判定留给下一次创建。
  if (!error.hidden) error.hidden = true
})
input.focus()
