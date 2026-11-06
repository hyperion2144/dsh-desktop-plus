//! 设备管理：新增设备 + 可折叠设备卡片（工作区与会话）。
//!
//! 设备信息全部来自插件自己的存储（remoteHosts.list），不再读桌面设置。
//! 连接必须双向成功才添加——host 侧 remoteHosts.pair 会回调对端，失败即回滚。
import { useCallback, useEffect, useState } from "react";

const cardStyle = {
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  borderRadius: 10,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const inputStyle = {
  // border-box：width:100% 时 padding 与边框算在宽度内，否则输入框会撑出外层卡片。
  boxSizing: "border-box",
  width: "100%",
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  fontSize: 13,
};

const buttonStyle = {
  font: "inherit",
  fontSize: 13,
  padding: "6px 11px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

const primaryStyle = {
  ...buttonStyle,
  borderColor: "var(--dsw-alias-label-primary, #e7eaf0)",
  fontWeight: 500,
};

const ghostStyle = {
  ...buttonStyle,
  borderColor: "transparent",
  color: "var(--dsw-alias-label-secondary, #9aa4b2)",
};

const dangerStyle = {
  ...buttonStyle,
  borderColor: "transparent",
  color: "#e5484d",
};

const STATE_COLOR = { online: "#16a34a", offline: "#9ca3af", unpaired: "#f59e0b", incompatible: "#ef4444" };

/** 折叠箭头：纯 CSS 三角，不用 emoji。 */
function Chevron({ open }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 0,
        height: 0,
        borderTop: "4px solid transparent",
        borderBottom: "4px solid transparent",
        borderLeft: "5px solid currentColor",
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 160ms ease-out",
        opacity: 0.6,
      }}
    />
  );
}

/**
 * 设备管理面板。
 * @param props.hostCall 与 host 的控制面通道。
 * @returns 面板。
 */
export function RemoteDeviceManager({ hostCall }) {
  const [hosts, setHosts] = useState([]);
  const [states, setStates] = useState({});
  const [workspaces, setWorkspaces] = useState([]);
  const [sessions, setSessions] = useState({});
  const [open, setOpen] = useState({});
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [hostState, wsState] = await Promise.all([
        hostCall("remoteHosts.list"),
        hostCall("remoteWorkspace.list"),
      ]);
      const list = Array.isArray(hostState?.hosts) ? hostState.hosts : [];
      setHosts(list);
      setWorkspaces(Array.isArray(wsState?.workspaces) ? wsState.workspaces : []);
      const next = {};
      await Promise.all(list.map(async (host) => {
        try {
          const result = await hostCall("remoteStatus.probe", { hostId: host.hostId });
          const state = result?.status?.state;
          if (typeof state === "string") next[host.hostId] = state;
        } catch {
          // 探测失败保持未知，不把在线误判成离线。
        }
      }));
      setStates(next);
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  }, [hostCall]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadSessions = async (hostId, path) => {
    try {
      const result = await hostCall("remoteSessions.list", { hostId, path });
      setSessions((prev) => ({ ...prev, [hostId + "|" + path]: Array.isArray(result?.sessions) ? result.sessions : [] }));
    } catch {
      setSessions((prev) => ({ ...prev, [hostId + "|" + path]: [] }));
    }
  };

  const toggle = (hostId) => {
    const next = !open[hostId];
    setOpen((prev) => ({ ...prev, [hostId]: next }));
    if (next) {
      for (const workspace of workspaces.filter((w) => w.hostId === hostId)) {
        void loadSessions(hostId, workspace.path);
      }
    }
  };

  const addDevice = async () => {
    const value = addr.trim();
    if (value === "") {
      setNotice({ kind: "error", text: "请先粘贴连接地址" });
      return;
    }
    setBusy(true);
    setNotice({ kind: "info", text: "正在连接…" });
    try {
      // 地址形如 dsh://host:port/pair?token=… 或 http://host:port/pair?token=…
      const url = new URL(value.replace(/^dsh:\/\//, "http://"));
      const token = url.searchParams.get("token") ?? "";
      const origin = url.origin;
      if (token === "") throw new Error("地址里没有 token");
      await hostCall("remoteHosts.pair", { origin, token });
      setAddr("");
      setNotice({ kind: "ok", text: "连接成功，双方已互相登记" });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (hostId) => {
    const name = draft.trim();
    setRenaming(null);
    if (name === "") return;
    try {
      await hostCall("remoteHosts.rename", { hostId, name });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };

  /** 删除/归档前先确认：这两个动作都会让条目从列表里消失，误点代价高。 */
  const [confirming, setConfirming] = useState(null);
  const remove = async (hostId) => {
    try {
      await hostCall("remoteHosts.remove", { hostId });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };

  const archiveSession = async (sessionId) => {
    try {
      await hostCall("remoteSession.invoke", {
        namespace: "workspace",
        method: "archiveSession",
        args: { request: { sessionId } },
      });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>新增设备</div>
        <div style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", lineHeight: 1.6 }}>
          粘贴对端 lane 铸造的连接地址。连接成功才会添加——添加后双方互相登记，任何一方都能发起会话。
        </div>
        <input
          style={inputStyle}
          value={addr}
          placeholder="dsh://192.168.1.42:3091/pair?token=..."
          onChange={(event) => setAddr(event.target.value)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" style={primaryStyle} disabled={busy} onClick={addDevice}>连接并添加</button>
          {notice !== null ? (
            <span style={{ fontSize: 12, color: notice.kind === "error" ? "#e5484d" : notice.kind === "ok" ? "#16a34a" : "var(--dsw-alias-label-secondary, #9aa4b2)" }}>
              {notice.text}
            </span>
          ) : null}
        </div>
      </div>

      {hosts.length === 0 ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }}>还没有添加任何设备。</div>
        </div>
      ) : null}

      {hosts.map((host) => {
        const state = states[host.hostId] ?? "offline";
        const isOpen = open[host.hostId] === true;
        const mine = workspaces.filter((workspace) => workspace.hostId === host.hostId);
        return (
          <div key={host.hostId} style={{ ...cardStyle, padding: 0, gap: 0, overflow: "hidden" }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }}
              onClick={() => toggle(host.hostId)}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATE_COLOR[state] ?? "#9ca3af", flex: "none" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
                  {renaming === host.hostId ? (
                    <input
                      style={{ ...inputStyle, width: 200, padding: "2px 6px", fontSize: 14, fontWeight: 600 }}
                      value={draft}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => void rename(host.hostId)}
                      onKeyDown={(event) => { if (event.key === "Enter") void rename(host.hostId); }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <span>{host.renamedAt !== undefined && host.name !== "" ? host.name : host.origin}</span>
                  )}
                  <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)", color: STATE_COLOR[state] ?? "#9ca3af" }}>
                    {state === "online" ? "已连接" : state === "unpaired" ? "未配对" : state === "incompatible" ? "版本不符" : "已断开"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", marginTop: 3 }}>
                  <span>{host.origin}</span>
                  {host.model ? <span>{host.model}</span> : null}
                  <span>ID <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>{host.deviceId}</code></span>
                </div>
              </div>
              <button type="button" style={ghostStyle} onClick={(event) => { event.stopPropagation(); setRenaming(host.hostId); setDraft(host.name ?? ""); }}>重命名</button>
              <button type="button" style={ghostStyle} onClick={(event) => { event.stopPropagation(); void reconnect(host.hostId); }}>重连</button>
              <button type="button" style={dangerStyle} onClick={(event) => { event.stopPropagation(); setConfirming({ kind: "device", id: host.hostId, label: host.renamedAt !== undefined && host.name !== "" ? host.name : host.origin }); }}>删除</button>
              <Chevron open={isOpen} />
            </div>
            {isOpen ? (
              <div style={{ borderTop: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)", padding: "12px 14px" }}>
                {mine.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }}>这台设备上还没有登记远程工作区。</div>
                ) : null}
                {mine.map((workspace) => {
                  const key = host.hostId + "|" + workspace.path;
                  const rows = sessions[key];
                  return (
                    <div key={workspace.path} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                        <span>{workspace.title}</span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }}>{workspace.path}</span>
                      </div>
                      {rows === undefined ? (
                        <div style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", padding: "4px 8px" }}>加载中…</div>
                      ) : rows.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", padding: "4px 8px" }}>这个工作区还没有会话</div>
                      ) : (
                        rows.map((session) => (
                          <div key={session.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, fontSize: 13 }}>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.title || session.id}</span>
                            <button type="button" style={dangerStyle} onClick={() => setConfirming({ kind: "session", id: session.id, label: session.title || session.id })}>归档</button>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {confirming !== null ? (
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
        onClick={() => setConfirming(null)}
      >
        <div
          style={{ width: 380, maxWidth: "90vw", padding: 18, borderRadius: 12, background: "var(--dsw-alias-bg-layer-1, #171a21)", border: "1px solid var(--dsw-alias-border-l2, #2a2f3a)", display: "flex", flexDirection: "column", gap: 12 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {confirming.kind === "device" ? "删除设备" : "归档会话"}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }}>
            {confirming.kind === "device"
              ? `确定删除「${confirming.label}」？这台设备的远程工作区登记会一并移除，对端不受影响。`
              : `确定归档「${confirming.label}」？归档后它会从侧边栏消失。`}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={buttonStyle} onClick={() => setConfirming(null)}>取消</button>
            <button
              type="button"
              style={{ ...buttonStyle, borderColor: "#e5484d", color: "#e5484d" }}
              onClick={async () => {
                const target = confirming;
                setConfirming(null);
                if (target.kind === "device") await remove(target.id);
                else await archiveSession(target.id);
              }}
            >{confirming.kind === "device" ? "删除" : "归档"}</button>
          </div>
        </div>
      </div>
    ) : null}
    </div>
  );
}
