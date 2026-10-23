/**
 * 壳生命周期与代理连通性命令（contract 中间层）。
 * 服务与桌面壳重启 / 代理连通性。（运行时下载/切换已删：dsh 随应用分发，更新走官方更新能力。）
 */


/** list_runtime_catalog 回显：#107 目录拉取失败不算失败（error 标记 + 空 catalog 降级）。 */


/** 内置行的显示口径：bundled=随包内置 / external=dev 外部树 / none=拿不到版本。 */



export interface RuntimeCommands {
  /** 面板「重启 dsh 服务」：DSH 侧树级重启，壳本体不退出（#60/#79 语义）。 */
  restart_dsh_service: { args: {}; result: { } }

  /** #119 整应用退出 + 自动重启；失败不抛，原因原样回传让页面说人话。 */
  restart_desktop_app: {
    args: {}
    result: { ok: boolean; reason?: string; message?: string }
  }

  /** TCP 连一次代理，返回耗时 ms。 */
  test_proxy_connectivity: {
    args: { url: string }
    result: number
  }
}
