# Posts one Windows toast for dsh-desktop-plus (#116).
#
# Called by the plugin host half as:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File win-toast.ps1 -Base64 <b64 JSON>
#
# The toast needs no registration: the AUMID is the one the dsh-desktop-plus
# shell already owns. A body click is protocol activation (#116 直通): the URL
# carries profile + session and the registered dsh-plus:// command is the
# application executable itself, so the single-instance second-instance handler
# in the shell routes it to the right profile window and the page switches to
# the session - no record files, no queue, no polling in the chain.
#
# Sound policy (#116): the toast <audio> element is the only Windows audio
# channel the system's Do Not Disturb actually governs, so:
#   sound=default  -> no <audio> element (system default toast sound, DND-governed)
#   sound=none     -> <audio silent="true"/>
#   sound=custom   -> <audio silent="true"/> here; the host self-plays the file

param(
    [Parameter(Mandatory = $true)][string]$Base64,
    # -DryRun：只构建并解析 XML，不创建/Show toast——给构建期测试用（#117 两类只在真实
    # payload 上暴露的缺陷：缺花括号的语法、裸 & 的非法 XML）。
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

function XmlEscape([string]$Value) {
    if ($null -eq $Value) { return "" }
    return $Value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace('"', "&quot;").Replace("'", "&apos;")
}

$payloadText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64))
$payload = $payloadText | ConvertFrom-Json
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($payload.aumid)

$title = XmlEscape $payload.title
$body = XmlEscape $payload.body

$visual = '<visual><binding template="ToastGeneric"><text>' + $title + '</text><text>' + $body + '</text></binding></visual>'

# Body click: protocol activation back into the shell, URL carrying profile and
# session so the shell can pick the right window and the page can switch to
# the conversation without any intermediate record.
$query = ''
if ($payload.profile) { $query = 'profile=' + [Uri]::EscapeDataString($payload.profile) }
if ($payload.session) {
    # XML 属性里的 & 必须写成 &amp;（裸 & 会让 LoadXml 报 0xC00CE50D，所有通知全灭）。
    # Windows 解析 XML 后会还原成 &，协议激活拿到的仍是正常 URL。
    if ($query) { $query = $query + '&amp;' }
    $query = $query + 'session=' + [Uri]::EscapeDataString($payload.session)
}
if ($query) {
    $launch = ' launch="dsh-plus://open?' + $query + '" activationType="protocol"'
} else {
    $launch = ' launch="dsh-plus://open" activationType="protocol"'
}

$audio = ""
if ($payload.sound -ne "default") { $audio = '<audio silent="true"/>' }

$xml = '<toast' + $launch + '>' + $visual + $audio + '</toast>'

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
if ($DryRun) { Write-Output 'OK'; exit 0 }
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Group = "dsh-desktop-plus"
if ($payload.tag) { $toast.Tag = $payload.tag }
$notifier.Show($toast)
