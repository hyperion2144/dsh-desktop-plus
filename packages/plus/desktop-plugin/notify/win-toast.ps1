# Posts one Windows toast for dsh-desktop-plus (#116).
#
# Called by the plugin host half as:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File win-toast.ps1 -Base64 <b64 JSON>
#
# The toast needs no registration: the AUMID is the one the dsh-desktop-plus
# shell already owns. A body click is protocol activation (#116 passthrough): the URL
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
    # -DryRun: build and parse the XML only, never create or show a toast. Used by
    # build-time tests: the two defect classes (#117) only surface on a real
    # payload - a missing brace, or a bare & that makes the XML invalid.
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
    # A bare & in an XML attribute makes LoadXml fail with 0xC00CE50D and kills
    # every toast, so the separator is written as &amp;. Windows decodes it back to
    # & when parsing, so protocol activation still receives a normal URL.
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
