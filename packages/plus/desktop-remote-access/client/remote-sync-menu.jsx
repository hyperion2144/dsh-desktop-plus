//! 会话菜单里的「分享到远程」入口。
//!
//! 分享不复制会话：会话始终在本机，对端只是同一份日志的另一个视图。
//! 这里只负责建立/撤销分享关系，同步由 SSE 推送自动完成。
import { useEffect, useState } from "react";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  color: "var(--dsw-alias-label-primary)",
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
};

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.35)",
};

const dialogStyle = {
  width: 440,
  maxWidth: "90vw",
  padding: 16,
  borderRadius: 12,
  background: "var(--dsw-alias-bg-elevated, #1f1f22)",
  color: "var(--dsw-alias-label-primary)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  fontSize: 13,
};

const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  fontSize: 13,
};

/**
 * 会话菜单里的分享入口。
 * @param props.sessionId 当前会话。
 * @param props.hostCall 与 host 的控制面通道。
 * @param props.dismiss 关闭菜单。
 * @returns 菜单项。
 */
export function RemoteSyncMenu({ sessionId, hostCall, dismiss }) {
  const [mode, setMode] = useState(null);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [path, setPath] = useState("");
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadShares = async () => {
    try {
      const state = await hostCall("remoteShare.list", { sessionId });
      setShares(Array.isArray(state?.shares) ? state.shares : []);
    } catch {
      setShares([]);
    }
  };

  useEffect(() => {
    void loadShares();
  }, [sessionId]);

  useEffect(() => {
    if (mode !== "share") return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await hostCall("devices.list");
        if (cancelled) return;
        const list = Array.isArray(state?.devices) ? state.devices : [];
        setDevices(list);
        if (list.length > 0) setDeviceId((current) => (current === "" ? list[0].deviceId : current));
      } catch {
        // 设备表拿不到时保持空列表，对话框里会提示先配对。
      }
    })();
    return () => { cancelled = true; };
  }, [mode, hostCall]);

  const openShare = () => {
    setNotice(null);
    setMode("share");
    // 默认远端目录与会话 cwd 相同：对端据此归入对应的远程工作区。
    void (async () => {
      try {
        const state = await hostCall("remoteWorkspace.list");
        const list = Array.isArray(state?.workspaces) ? state.workspaces : [];
        const match = list.find((entry) => entry.sessionIds?.includes?.(sessionId));
        if (typeof match?.path === "string") setPath(match.path);
      } catch {
        // 拿不到就留空，用户自己填。
      }
    })();
  };

  const confirmShare = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await hostCall("remoteShare.add", { sessionId, deviceId, path });
      await loadShares();
      setNotice({ kind: "ok", text: "已分享" });
      setMode(null);
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (target) => {
    setBusy(true);
    try {
      await hostCall("remoteShare.remove", { sessionId, deviceId: target });
      await loadShares();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" style={rowStyle} onClick={openShare}>分享到远程…</button>
      {shares.length > 0 ? (
        <button type="button" style={rowStyle} onClick={() => { setNotice(null); setMode("manage"); void loadShares(); }}>
          分享管理（{shares.length}）
        </button>
      ) : null}
      {notice !== null && mode === null ? (
        <div style={{ padding: "4px 10px", fontSize: 12, color: notice.kind === "error" ? "#ef4444" : "#16a34a" }}>{notice.text}</div>
      ) : null}
      {mode === "share" ? (
        <div style={overlayStyle} onClick={() => { if (!busy) setMode(null); }}>
          <div style={dialogStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ fontWeight: 600 }}>分享到远程</div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "var(--dsw-alias-label-secondary)" }}>目标设备</span>
              <select style={inputStyle} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                {devices.length === 0 ? <option value="">（还没有已配对设备）</option> : null}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.name || device.deviceId}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "var(--dsw-alias-label-secondary)" }}>对端项目目录</span>
              <input
                style={inputStyle}
                value={path}
                placeholder="/path/to/project"
                onChange={(event) => setPath(event.target.value)}
              />
            </label>
            {notice !== null ? (
              <div style={{ fontSize: 12, color: notice.kind === "error" ? "#ef4444" : "#16a34a" }}>{notice.text}</div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" style={{ ...inputStyle, width: "auto", cursor: "pointer" }} onClick={() => setMode(null)} disabled={busy}>取消</button>
              <button
                type="button"
                style={{ ...inputStyle, width: "auto", cursor: "pointer", borderColor: "#16a34a", color: "#16a34a" }}
                onClick={confirmShare}
                disabled={busy || deviceId === "" || path === ""}
              >{busy ? "分享中…" : "确认分享"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {mode === "manage" ? (
        <div style={overlayStyle} onClick={() => { if (!busy) setMode(null); }}>
          <div style={dialogStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ fontWeight: 600 }}>分享管理</div>
            {shares.length === 0 ? <div style={{ opacity: 0.7 }}>还没有分享给任何设备。</div> : null}
            {shares.map((share) => (
              <div key={share.deviceId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1 }}>{share.deviceId}</span>
                <span style={{ opacity: 0.6, fontSize: 12 }}>{share.viewers > 0 ? "在线" : "离线"}</span>
                <button type="button" style={{ ...inputStyle, width: "auto", cursor: "pointer" }} onClick={() => revoke(share.deviceId)} disabled={busy}>撤销</button>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" style={{ ...inputStyle, width: "auto", cursor: "pointer" }} onClick={() => setMode(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
