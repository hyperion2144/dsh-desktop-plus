// 添加工作区的目录选择占位者（#106）：官方 ui-workspace 把「添加工作区…」入口交给
// directoryFlow 洞的占位者。官方占位者是 renderless 的（直接弹系统选择器）；本组件以
// priority 1 遮蔽它（single 槽位低者渲染），在同一处提供两个来源：本机目录与已配对主机的目录。
//
// 本机走官方 pick（桌面桥 __DSH_DIRECTORY_PICKER__，否则 uiWorkspace.pickDirectory）；远程走
// remoteWorkspace.browse 浏览对端目录树，选定后先 remoteWorkspace.add 登记，再把路径交回
// owner 的 onPicked —— owner 用官方 createWorkspace({ path }) 采纳，插件的 registry 包装让
// 远程路径跳过本机 realpath 校验。
//
// 外观全部来自官方 ui-primitives（Modal / SegmentedTabs / Button / PathLabel），不写颜色、
// 不注入样式表；这里只保留布局用的内联 flex 属性。
import React, { useCallback, useEffect, useState } from "react";
import { Button, Modal, PathLabel, SegmentedTabs } from "@deepseek-ai/dsh-client-ui-primitives";
import { useRemoteAccessT } from "../src/client/i18n/provider.tsx";

const columnStyle = { display: "flex", flexDirection: "column", gap: 12 };
const pathRowStyle = { display: "flex", gap: 8, alignItems: "center", width: "100%" };
// 路径输入框：官方 Input 的包裹层是 inline-flex，撑不满对话框；这里直接用原生 input + dsh 语义变量。
const pathInputStyle = {
  flex: "1 1 auto",
  minWidth: 0,
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 35%, transparent)",
  background: "transparent",
  color: "var(--dsw-alias-label-primary)",
  font: "inherit",
  fontSize: 13,
  outline: "none",
};
const listStyle = { display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" };
const rowButtonStyle = { justifyContent: "flex-start" };
const chipsStyle = { display: "flex", flexWrap: "wrap", gap: 8 };

/** 取父目录；根目录的父目录仍是根。 */
function parentOf(target) {
  if (typeof target !== "string" || target === "") return "";
  const trimmed = target.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

/** 把绝对路径切成面包屑：根 + 每一级。 */
function segmentsOf(target) {
  if (typeof target !== "string" || target === "") return [];
  const trimmed = target.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter((part) => part !== "");
  const out = [{ name: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc = acc + "/" + part;
    out.push({ name: part, path: acc });
  }
  return out;
}

/**
 * 目录选择占位者：本机 / 远程设备两个来源。
 * @param props 官方 owner 会话（open/busy/onPicked/onCancel/onError）加注入面（hostCall/pick）。
 * @returns 对话框元素；未请求时返回 null。
 */
export function RemoteDirectoryFlow(props) {
  const { open, busy, onPicked, onCancel, onError, hostCall, pick } = props;
  const t = useRemoteAccessT();
  const [source, setSource] = useState("local");
  const [hosts, setHosts] = useState([]);
  const [hostId, setHostId] = useState("");
  const [listing, setListing] = useState(null);
  const [current, setCurrent] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  const browse = useCallback(async (targetHostId, targetPath, quiet = false) => {
    if (targetHostId === "") return;
    setWorking(true);
    if (!quiet) setError(null);
    try {
      const result = await hostCall("remoteWorkspace.browse", { hostId: targetHostId, path: targetPath });
      setListing(result);
      const next = result?.path ?? targetPath;
      setCurrent(next);
      setDraft(next);
      setError(null);
    } catch (reason) {
      if (!quiet) {
        const raw = String(reason?.message ?? reason);
        setError(/HTTP 5\d\d|list-failed|not-found|ENOENT|ENOTDIR/.test(raw)
          ? `${t("目录不存在或无法访问")}：${targetPath}`
          : raw);
      }
    } finally {
      setWorking(false);
    }
  }, [hostCall, t]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setListing(null);
    setCurrent("");
    void (async () => {
      try {
        const state = await hostCall("remoteHosts.list");
        const list = Array.isArray(state?.hosts) ? state.hosts : [];
        setHosts(list);
        const first = list[0]?.hostId ?? "";
        setHostId(first);
        if (first !== "") await browse(first, "");
      } catch (reason) {
        setError(String(reason?.message ?? reason));
      }
    })();
  }, [open, hostCall, browse]);

  // 输入路径时自动跟随：停顿 400ms 后按草稿浏览，不用先点「前往」。
  useEffect(() => {
    if (!open || hostId === "" || draft === "" || draft === current) return;
    if (!draft.startsWith("/")) return;
    const timer = setTimeout(() => { void browse(hostId, draft, true); }, 400);
    return () => clearTimeout(timer);
  }, [open, hostId, draft, current, browse]);

  if (!open) return null;

  const commit = async () => {
    if (current === "" || hostId === "") return;
    setWorking(true);
    setError(null);
    try {
      await hostCall("remoteWorkspace.add", { hostId, path: current });
      onPicked(current);
    } catch (reason) {
      const message = String(reason?.message ?? reason);
      setError(message);
      onError(message);
    } finally {
      setWorking(false);
    }
  };

  const pickLocalDirectory = async () => {
    try {
      const picked = await pick();
      if (picked === null || picked === undefined) onCancel();
      else onPicked(picked);
    } catch (reason) {
      onError(String(reason?.message ?? reason));
    }
  };

  const tabs = [
    { value: "local", label: t("本机"), id: "dsh-rdf-tab-local", panelId: "dsh-rdf-panel-local" },
    { value: "remote", label: t("远程设备"), id: "dsh-rdf-tab-remote", panelId: "dsh-rdf-panel-remote" },
  ];

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("添加工作区")}
      closeLabel={t("关闭")}
      description={t("选一个本机目录，或从已配对的主机上挑一个目录。")}
      footer={(
        <>
          <Button variant="ghost" onClick={onCancel}>{t("取消")}</Button>
          {source === "remote" ? (
            <Button
              variant="primary"
              onClick={() => void commit()}
              disabled={busy || working || current === "" || hostId === ""}
            >
              {t("使用此目录")}
            </Button>
          ) : null}
        </>
      )}
    >
      <div style={columnStyle}>
        <SegmentedTabs items={tabs} value={source} onChange={setSource} label={t("目录来源")} size="sm" />
        {source === "local" ? (
          <div id="dsh-rdf-panel-local" role="tabpanel" aria-labelledby="dsh-rdf-tab-local" style={columnStyle}>
            <Button variant="primary" onClick={() => void pickLocalDirectory()} disabled={busy}>
              {t("选择本机目录…")}
            </Button>
          </div>
        ) : (
          <div id="dsh-rdf-panel-remote" role="tabpanel" aria-labelledby="dsh-rdf-tab-remote" style={columnStyle}>
            {hosts.length === 0 ? (
              <div>{t("还没有已配对的主机。先到「设置 → 远程访问」配对一台，再回来添加它的目录。")}</div>
            ) : (
              <>
                    <div style={chipsStyle}>
                      {hosts.map((host) => (
                        <Button
                          key={host.hostId}
                          variant={host.hostId === hostId ? "primary" : "outline"}
                          size="sm"
                          onClick={() => { setHostId(host.hostId); void browse(host.hostId, ""); }}
                        >
                          {host.name || host.origin || host.hostId}
                        </Button>
                      ))}
                    </div>
                    <nav aria-label={t("当前路径")} style={chipsStyle}>
                      {segmentsOf(current).map((segment) => (
                        <Button
                          key={segment.path}
                          variant="ghost"
                          size="sm"
                          onClick={() => void browse(hostId, segment.path)}
                        >
                          {segment.name}
                        </Button>
                      ))}
                    </nav>
                    <div style={pathRowStyle}>
                      <input
                        value={draft}
                        aria-label={t("目录路径")}
                        placeholder={t("粘贴绝对路径，例如 /Users/you/project")}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") void browse(hostId, draft); }}
                        style={pathInputStyle}
                      />
                      <Button variant="outline" size="sm" disabled={working || draft === ""} onClick={() => void browse(hostId, draft)}>
                        {t("前往")}
                      </Button>
                    </div>
                <div style={listStyle}>
                  <Button variant="ghost" size="sm" style={rowButtonStyle} onClick={() => void browse(hostId, parentOf(current))}>
                    {t(".. 上一级")}
                  </Button>
                  {(listing?.entries ?? []).map((entry) => (
                    <Button
                      key={entry.path}
                      variant="ghost"
                      size="sm"
                      style={rowButtonStyle}
                      onClick={() => void browse(hostId, entry.path)}
                    >
                      {entry.name}
                    </Button>
                  ))}
                  {(listing?.entries ?? []).length === 0 && !working ? (
                    <div>{t("（没有子目录）")}</div>
                  ) : null}
                </div>
              </>
            )}
            {error === null ? null : <div>{error}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
