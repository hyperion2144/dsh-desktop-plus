//! 会话菜单里的「分享到远程」入口。
//!
//! 分享不复制会话：会话始终在本机，对端只是同一份日志的另一个视图。
//! 这里只负责建立/撤销分享关系，同步由 SSE 推送自动完成。
import { useEffect, useState } from "react";
import { MenuItemButton } from "@deepseek-ai/dsh-client-ui-primitives";
import { shouldHideShareMenu } from "./share-menu-visibility.js";
import { openShareDialog } from "./share-dialog.js";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "6px 10px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--dsw-alias-label-primary)",
  fontSize: 13,
  font: "inherit",
  lineHeight: "20px",
  textAlign: "left",
  cursor: "pointer",
};

/** 分享图标：与官方菜单项同尺寸的 16px 线性图标。 */
function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 9.5v-8M5 4.5l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 7v5.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

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
  background: "var(--dsw-alias-bg-layer-1)",
  border: "1px solid var(--dsw-alias-border-l2)",
  color: "var(--dsw-alias-label-primary)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  fontSize: 13,
};

const inputStyle = {
  boxSizing: "border-box",
  width: "100%",
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
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

  // 远程会话不能分享：它的本体在别的设备上，分享一份远程会话既没有语义也没有数据源。
  // 只有本机会话才有「分享给另一台设备」这件事。
  const remoteSet = globalThis.__DSH_REMOTE_SESSIONS__;
  if (shouldHideShareMenu(sessionId, globalThis.__DSH_REMOTE_SESSIONS__)) return null;

  return (
    <>
      <MenuItemButton icon={<ShareIcon />} onSelect={() => openShareDialog({ sessionId, hostCall, onChanged: loadShares })}>分享到远程…</MenuItemButton>
      {shares.length > 0 ? (
        <MenuItemButton icon={<ShareIcon />} onSelect={() => openShareDialog({ sessionId, hostCall, mode: "manage", onChanged: loadShares })}>
          分享管理（{shares.length}）
        </MenuItemButton>
      ) : null}
    </>
  );
}
