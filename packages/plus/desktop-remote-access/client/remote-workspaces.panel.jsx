// 远程工作区面板（settings.section 的第二块）：配对一台主机 → 把它的目录登记成本机官方工作区
// → 把这台主机该目录下的会话物化到本机渲染。所有交互都走 hostCall('/api/remote-access.*')。
import React, { useCallback, useEffect, useState } from "react";

const labelStyle = { fontSize: 12, opacity: 0.72, marginBottom: 4 };
const inputStyle = { padding: "6px 8px", borderRadius: 6, border: "1px solid #2a2f3a", background: "transparent", color: "inherit", width: "100%" };
const rowStyle = { display: "flex", gap: 8, alignItems: "center" };
const stateColor = { online: "#46a758", offline: "#d18f00", unpaired: "#e5484d", incompatible: "#e5484d" };

/** 主机显示名：只有用户改过名才用名字，否则一律用地址（不要凭空冒出一个「A机」）。 */
const displayNameOf = (host) => (host && host.renamedAt !== undefined && host.name ? host.name : (host?.origin ?? ""));

/**
 * 探测所有已配对主机的连接状态（#108：未配对 / 离线 / 版本不符三态）。
 * 探测本身失败时该主机不进映射，界面按「状态未知」降级，不假装在线。
 * @param hostCall host 控制面调用器。
 * @param hosts 已配对主机列表。
 * @returns hostId → { state, description, retryable } 映射。
 */
async function probeHosts(hostCall, hosts) {
  const entries = await Promise.all(
    hosts.map(async (host) => {
      try {
        const result = await hostCall("remoteStatus.probe", { hostId: host.hostId });
        const status = result?.status;
        return status
          ? [host.hostId, { state: status.state, description: result.description, retryable: status.retryable === true }]
          : [host.hostId, null];
      } catch {
        return [host.hostId, null];
      }
    }),
  );
  const map = {};
  for (const [hostId, status] of entries) if (status) map[hostId] = status;
  return map;
}

/**
 * 远端工作区在列表里的展示名：#106 要求来源可辨，官方侧栏只认注册时给的标题，
 * 所以来源标记写进标题本身（重复添加时不会叠加）。
 * @param workspace 工作区记录。
 * @param host 来源主机。
 */
function displayTitle(workspace, host) {
  const suffix = ` · 来自 ${host?.name || host?.origin || workspace.hostId}`;
  return workspace.title.includes(suffix) ? workspace.title : `${workspace.title}${suffix}`;
}
const cardStyle = { border: "1px solid #2a2f3a", borderRadius: 8, padding: 12, marginTop: 12 };

/**
 * 远程工作区设置面板。
 * @param props.hostCall host 控制面调用器：`(endpoint, payload) => Promise<value>`。
 */
export function RemoteWorkspacesPanel({ hostCall }) {
  const [hosts, setHosts] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState("");
  const [hostId, setHostId] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null); // { kind: 'ok' | 'err', text }
  const [statuses, setStatuses] = useState({}); // hostId → 三态探测结果
  const [renaming, setRenaming] = useState(""); // 正在改名的主机 hostId
  const [renameDraft, setRenameDraft] = useState("");

  const refresh = useCallback(async () => {
    try {
      const hostState = await hostCall("remoteHosts.list");
      const workspaceState = await hostCall("remoteWorkspace.list");
      const hostList = Array.isArray(hostState?.hosts) ? hostState.hosts : [];
      setHosts(hostList);
      setStatuses(await probeHosts(hostCall, hostList));
      setWorkspaces(Array.isArray(workspaceState?.workspaces) ? workspaceState.workspaces : []);
      setHostId((current) => current || hostState?.hosts?.[0]?.hostId || "");
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    }
  }, [hostCall]);

  useEffect(() => { void refresh(); }, [refresh]);

  const pair = async () => {
    setBusy("pair");
    try {
      const result = await hostCall("remoteHosts.pair", { origin, token, name: origin });
      setNotice({ kind: "ok", text: `已配对：${result?.host?.name ?? origin}` });
      setToken("");
      await refresh();
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  const addWorkspace = async () => {
    setBusy("add");
    try {
      const target = hosts.find((host) => host.hostId === hostId);
      const title = `${path.split("/").filter(Boolean).pop() || path} · 来自 ${target?.name || target?.origin || hostId}`;
      const result = await hostCall("remoteWorkspace.add", { hostId, path, title });
      setNotice({ kind: "ok", text: `已添加：${result?.workspace?.title ?? path}` });
      setPath("");
      await refresh();
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  const sync = async (workspace) => {
    setBusy(`sync:${workspace.path}`);
    try {
      const result = await hostCall("remoteSessions.sync", { hostId: workspace.hostId, path: workspace.path });
      const count = Array.isArray(result?.sessions) ? result.sessions.length : 0;
      setNotice({ kind: "ok", text: `已同步 ${count} 个会话` });
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  const syncContent = async (workspace) => {
    setBusy(`pull:${workspace.path}`);
    try {
      const result = await hostCall("remoteWorkspace.syncNow", { hostId: workspace.hostId, path: workspace.path });
      const created = Number(result?.created ?? 0);
      const existing = Number(result?.existing ?? 0);
      setNotice({ kind: "ok", text: `已拉取：新建 ${created} 个，更新 ${existing} 个` });
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  const removeWorkspace = async (workspace) => {
    setBusy(`remove:${workspace.path}`);
    try {
      await hostCall("remoteWorkspace.remove", { hostId: workspace.hostId, path: workspace.path });
      setNotice({ kind: "ok", text: `已移除：${workspace.title}` });
      await refresh();
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  /**
   * 单台主机重试（#108：三态各自有可重试入口，不阻塞其它主机与本地功能）。
   * @param host 要重试的主机。
   */
  const retry = async (host) => {
    setBusy(`probe:${host.hostId}`);
    try {
      const result = await hostCall("remoteStatus.probe", { hostId: host.hostId });
      const status = result?.status;
      if (status) {
        setStatuses((current) => ({
          ...current,
          [host.hostId]: { state: status.state, description: result.description, retryable: status.retryable === true },
        }));
      }
      setNotice({ kind: status?.state === "online" ? "ok" : "err", text: result?.description ?? "探测失败" });
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };
  const unpair = async (host) => {
    setBusy(`unpair:${host.hostId}`);
    try {
      await hostCall("remoteHosts.remove", { hostId: host.hostId });
      setNotice({ kind: "ok", text: `已撤销配对：${displayNameOf(host)}` });
      await refresh();
    } catch (error) {
      setNotice({ kind: "err", text: String(error?.message ?? error) });
      const startRename = (host) => {
        setRenaming(host.hostId);
        setRenameDraft(host.name || "");
      };

      const commitRename = async (host) => {
        const name = renameDraft.trim();
        if (name === "") { setNotice({ kind: "err", text: "名字不能为空" }); return; }
        setBusy(`rename:${host.hostId}`);
        try {
          await hostCall("remoteHosts.rename", { hostId: host.hostId, name });
          setRenaming("");
          setNotice({ kind: "ok", text: `已重命名：${name}` });
          await refresh();
        } catch (error) {
          setNotice({ kind: "err", text: String(error?.message ?? error) });
        } finally {
          setBusy(null);
        }
      };
    } finally { setBusy(null); }
  };

  return (
    <div>
      <div style={labelStyle}>配对另一台主机（在对方「远程访问」面板铸造配对令牌）</div>
      <div style={rowStyle}>
        <input style={inputStyle} placeholder="http://192.168.1.9:3091" value={origin} onChange={(e) => setOrigin(e.target.value)} />
        <input style={inputStyle} placeholder="配对令牌" value={token} onChange={(e) => setToken(e.target.value)} />
        <button disabled={busy === "pair" || !origin || !token} onClick={pair}>配对</button>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>添加远程目录（该目录必须已登记在对方主机上）</div>
        <div style={rowStyle}>
          <select style={inputStyle} value={hostId} onChange={(e) => setHostId(e.target.value)}>
            {hosts.length === 0 ? <option value="">（还没有已配对主机）</option> : null}
            {hosts.map((host) => <option key={host.hostId} value={host.hostId}>{displayNameOf(host)}</option>)}
          </select>
          <input style={inputStyle} placeholder="/Users/a/proj" value={path} onChange={(e) => setPath(e.target.value)} />
          <button disabled={busy === "add" || !hostId || path === ""} onClick={addWorkspace}>添加</button>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>已配对主机（撤销后对侧记录立刻不可用）</div>
        {hosts.length === 0 ? (
          <div style={{ fontSize: 12, color: "#d18f00" }}>
            还没有配对任何主机：先在对方主机的「远程访问」面板铸造一次性令牌，再把地址与令牌填到上面一行完成配对。
            未配对时远端工作区与远端会话全部不可用，本机功能不受影响。
          </div>
        ) : null}
        {hosts.map((host) => {
          const status = statuses[host.hostId];
          const color = status ? stateColor[status.state] : "#8b949e";
          return (
            <div key={host.hostId} style={{ ...rowStyle, marginTop: 6 }}>
              <span style={{ flex: 1 }}>
                {renaming === host.hostId ? (
                  <input
                    style={{ ...inputStyle, width: 180 }}
                    aria-label="主机名称"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(host);
                      if (e.key === "Escape") setRenaming("");
                    }}
                  />
                ) : (displayNameOf(host))}
                <span style={{ marginLeft: 8, fontSize: 12, color }}>
                  {status ? status.description : "状态未知（点重试探测）"}
                </span>
              </span>
              {status && status.retryable ? (
                <button disabled={busy === `probe:${host.hostId}`} onClick={() => retry(host)}>重试</button>
                ) : null}
                {renaming === host.hostId ? (
                  <>
                    <button disabled={busy === `rename:${host.hostId}`} onClick={() => commitRename(host)}>保存</button>
                    <button onClick={() => setRenaming("")}>取消</button>
                  </>
                ) : (
                  <button onClick={() => startRename(host)}>重命名</button>
                )}
              <button disabled={busy === `unpair:${host.hostId}`} onClick={() => unpair(host)}>撤销配对</button>
            </div>
          );
        })}
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>已登记的远程工作区</div>
        {workspaces.length === 0 ? <div style={labelStyle}>（还没有）</div> : null}
          {workspaces.map((workspace) => {
            const host = hosts.find((item) => item.hostId === workspace.hostId);
            const status = statuses[workspace.hostId];
            const online = status?.state === "online";
            return (
              <div key={workspace.hostId + ":" + workspace.path}>
                <div style={{ ...rowStyle, marginTop: 6 }}>
                  <span style={{ flex: 1 }}>
                    {displayTitle(workspace, host)} <span style={{ opacity: 0.6 }}>{workspace.path}</span>
                    {online ? null : (
                      <span style={{ marginLeft: 8, fontSize: 12, color: status ? stateColor[status.state] : "#8b949e" }}>
                        {status ? status.description : "状态未知"}（远端不可用）
                      </span>
                    )}
                  </span>
                  <button
                    disabled={busy === "sync:" + workspace.path || !online}
                    title={online ? undefined : "对端离线或版本不符时不能同步；先在上面的主机行点重试"}
                    onClick={() => sync(workspace)}
                  >同步会话</button>
                  <button
                    disabled={busy === "pull:" + workspace.path || !online}
                    title="把远端该目录下所有会话的最新内容拉到本机"
                    onClick={() => syncContent(workspace)}
                  >同步最新内容</button>
                  <button disabled={busy === "remove:" + workspace.path} onClick={() => removeWorkspace(workspace)}>移除</button>
                </div>
                <RemoteSessionsPanel
                  hostCall={hostCall}
                  hostId={workspace.hostId}
                  path={workspace.path}
                  hostName={host ? (displayNameOf(host)) : workspace.hostId}
                  online={online}
                />
              </div>
            );
          })}
      </div>

      {notice ? <div style={{ marginTop: 10, fontSize: 12, color: notice.kind === "err" ? "#e5484d" : "#46a758" }}>{notice.text}</div> : null}
    </div>
  );
}

/**
 * 远端会话面板（#107 只读渲染 / #109 单向流转）。
 *
 * 与主面板分开成一个组件：它按「一个远程工作区」取会话列表与事件，
 * 状态（列表、打开中的会话）只属于这一块，不污染主机/工作区的状态。
 *
 * @param props.hostCall host 控制面调用器。
 * @param props.hostId 来源主机。
 * @param props.path 来源目录（绝对路径）。
 * @param props.hostName 来源主机展示名。
 * @param props.online 对端是否在线（离线/版本不符时禁用远端动作）。
 */
export function RemoteSessionsPanel({ hostCall, hostId, path, hostName, online }) {
  const [sessions, setSessions] = useState([]);
  const [open, setOpen] = useState(null); // { session, events, handedOff }
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    if (!online) { setSessions([]); return; }
    try {
      const result = await hostCall("remoteSessions.list", { hostId, path });
      setSessions(Array.isArray(result?.sessions) ? result.sessions : []);
    } catch (error) {
      setNote({ kind: "err", text: String(error?.message ?? error) });
    }
  }, [hostCall, hostId, path, online]);

  useEffect(() => { void load(); }, [load]);

  const openSession = async (session) => {
    setBusy("open:" + session.id);
    try {
      const result = await hostCall("remoteSessions.read", { sessionId: session.id });
      setOpen({
        session: result?.session ?? { id: session.id, cwd: session.cwd },
        events: Array.isArray(result?.events) ? result.events : [],
        handedOff: result?.handedOff ?? null,
      });
    } catch (error) {
      setNote({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  const handoff = async (session) => {
    setBusy("handoff:" + session.id);
    try {
      const result = await hostCall("remoteSessions.handoff", { hostId, path, sessionId: session.id });
      setNote(result?.handedOff
        ? { kind: "ok", text: "已流转到本机：" + session.id + "（可写副本，来源已标注）" }
        : { kind: "err", text: result?.reason ?? "流转被拒绝" });
      await load();
    } catch (error) {
      setNote({ kind: "err", text: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ ...cardStyle, marginTop: 8 }}>
      <div style={labelStyle}>
        该目录在本机的会话（只读；"流转"会把会话搬成可写副本，同一会话只搬一次）
      </div>
      {!online ? <div style={{ fontSize: 12, color: "#d18f00" }}>对端不可用，会话列表与流转已停用（本地会话不受影响）。</div> : null}
      {online && sessions.length === 0 ? <div style={labelStyle}>（本机还没有该目录的会话，先点上面的「同步会话」）</div> : null}
      {sessions.map((session) => (
        <div key={session.id} style={{ ...rowStyle, marginTop: 6, alignItems: "flex-start" }}>
          <span style={{ flex: 1, fontSize: 12 }}>
            {session.id}
            <span style={{ marginLeft: 8, opacity: 0.6 }}>{String(session.createdAt ?? "")}</span>
            <span style={{ marginLeft: 8, color: session.handedOff ? "#46a758" : "#8b949e" }}>
              {session.handedOff ? "已流转自 " + session.handedOff.hostName + "（原会话 " + session.handedOff.originSessionId + "）" : "只读物化（未流转）"}
            </span>
          </span>
          <button disabled={busy === "open:" + session.id} onClick={() => openSession(session)}>查看</button>
          <button disabled={busy === "handoff:" + session.id || session.writable} onClick={() => handoff(session)}>
            {session.writable ? "已流转" : "流转到本机"}
          </button>
        </div>
      ))}
      {open ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, opacity: 0.72 }}>
            只读视图：{open.session.id}（{open.events.length} 个事件，按顺序）
            {open.handedOff ? " · 来自 " + open.handedOff.hostName : ""}
          </div>
          <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #2a2f3a", borderRadius: 6, padding: 8, marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap" }}>
            {open.events.map((event, index) => <div key={index}>{eventLine(event, index)}</div>)}
          </div>
        </div>
      ) : null}
      {note ? <div style={{ marginTop: 8, fontSize: 12, color: note.kind === "err" ? "#e5484d" : "#46a758" }}>{note.text}</div> : null}
    </div>
  );
}

/**
 * 把一条会话事件压成一行可读文本（只读视图用，不解析业务语义）。
 * @param event 会话事件。
 * @param index 序号（事件没有 seq 时的兜底显示）。
 */
function eventLine(event, index) {
  const payload = event && typeof event === "object" ? (event.payload ?? event.data ?? {}) : {};
  const text = typeof payload.text === "string" ? payload.text
    : typeof event?.text === "string" ? event.text
    : typeof payload.content === "string" ? payload.content
    : "";
  const seq = event?.seq ?? index;
  const type = String(event?.type ?? event?.kind ?? "event");
  return text ? seq + " · " + type + " · " + text.slice(0, 200) : seq + " · " + type;
}

