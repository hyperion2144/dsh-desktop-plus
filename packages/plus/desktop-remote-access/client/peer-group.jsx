//! 设备管理里的「同组设备」区（#156）：列出某位介绍人名下的其它设备，发起配对并显示进度。
//!
//! 清单与介绍凭证都来自介绍人（remotePeers.list）；点「请求配对」后由对方弹审批卡决定。
//! 对方拒绝过的不再列出，不留半配状态；介绍人离线时保留上一次的清单，已配对的同组设备照常可用。
import { useCallback, useEffect, useState } from "react";
import { peerGroupState } from "./peer-approvals.js";

const labelStyle = { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" };
const buttonStyle = {
  font: "inherit",
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

/**
 * 同组设备区。
 * @param props.hostCall 与宿主的控制面通道。
 * @param props.host 介绍人（已配对设备卡片对应的那台）。
 * @returns 清单与进度；介绍人没启用组网时什么都不显示。
 */
export function PeerGroup({ hostCall, host }) {
  const [peers, setPeers] = useState(null);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try {
      const state = await hostCall("remotePeers.list", { hostId: host.hostId });
      const list = Array.isArray(state?.peers) ? state.peers : [];
      // 有请求在等对方确认时顺带问一次进度：对方一同意，本机就完成双向配对。
      let changed = false;
      for (const peer of list) {
        if (peer?.request !== "pending") continue;
        try {
          const progress = await hostCall("remotePeers.status", { hostId: host.hostId, deviceId: peer.deviceId });
          if (typeof progress?.state === "string" && progress.state !== "pending") {
            changed = true;
            setNotice(progress.state === "paired" ? `已和 ${peer.name} 完成配对，两边互相登记` : String(progress.message ?? "对方没有同意"));
          }
        } catch {
          // 问不到就下一拍再问。
        }
      }
      if (!changed) { setPeers(list); return; }
      const again = await hostCall("remotePeers.list", { hostId: host.hostId });
      setPeers(Array.isArray(again?.peers) ? again.peers : list);
    } catch {
      // 介绍人不可达（或它那边的版本不带组网）：保留上一次的清单。
    }
  }, [hostCall, host.hostId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const request = async (peer) => {
    setNotice(`正在向 ${peer.name} 发起配对请求…`);
    try {
      const result = await hostCall("remotePeers.request", { hostId: host.hostId, deviceId: peer.deviceId });
      setNotice(result?.state === "pending" ? `已向 ${peer.name} 发起请求，等待对方确认…` : String(result?.message ?? "请求没有送到"));
    } catch (error) {
      setNotice(String(error?.message ?? error));
    }
    await refresh();
  };

  if (peers === null) return null;
  return (
    <div
      data-dsh-remote-peer-group={host.hostId}
      style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--dsw-alias-border-secondary, #3a3a3f)" }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>同组设备（经这位设备介绍）</div>
      {peers.length === 0 ? (
        <div style={labelStyle}>这位设备名下还没有别的设备。</div>
      ) : (
        peers.map((peer) => {
          const state = peerGroupState(peer);
          const askable = state.kind === "idle" || state.kind === "expired";
          const stale = typeof peer.lastSeen === "number" && peer.lastSeen > 0 && Date.now() - peer.lastSeen > 10 * 60_000;
          return (
            <div
              key={peer.deviceId}
              data-dsh-remote-peer={peer.deviceId}
              data-dsh-remote-peer-state={state.kind}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", fontSize: 13 }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peer.name}</span>
              {state.text !== "" ? (
                <span style={labelStyle} role={state.kind === "failed" ? "alert" : undefined}>{state.text}</span>
              ) : null}
              {stale && state.kind !== "paired" ? (
                <span style={labelStyle} title="介绍人已经超过 10 分钟没连上这台设备，它可能早已不在线">很久未在线</span>
              ) : null}
              {askable ? (
                <button type="button" style={buttonStyle} onClick={() => { void request(peer); }}>请求配对</button>
              ) : null}
            </div>
          );
        })
      )}
      {notice !== "" ? <div role="status" style={{ ...labelStyle, marginTop: 6 }}>{notice}</div> : null}
    </div>
  );
}
