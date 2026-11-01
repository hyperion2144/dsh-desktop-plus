import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { ShellApp } from '../shell/ShellApp';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { wantAgent, WantAgent } from '@kit.AbilityKit';
import { ShellLog } from '../shell/ShellLog';

/**
 * 壳的入口 Ability。
 *
 * 职责只有两件：
 *  1. 建好进程级单例（ShellApp：仓库 / 偏好 / 配对 / 锁），并把当前主机恢复出来；
 *  2. 装载主页面（pages/Index：顶栏 + ArkWeb 页面 + 浮层切换器）。
 *
 * 其余逻辑都在 shell/ 下按依赖方向分层：store → host → pair/connect → page/bridge → ui。
 */
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0xD00, 'DshMobile', '%{public}s', '壳进程已创建');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    ShellApp.initialize(this.context).then(() => {
      windowStage.loadContent('pages/Index', (error: BusinessError) => {
        if (error.code) {
          hilog.error(0xD00, 'DshMobile', '%{public}s', `页面装载失败：${JSON.stringify(error)}`);
          return;
        }
        hilog.info(0xD00, 'DshMobile', '%{public}s', '主页面已装载');
      });
    }).catch((error: Error) => {
      hilog.error(0xD00, 'DshMobile', '%{public}s', `壳初始化失败：${error.message}`);
    });
  }

  onDestroy(): void {
    ShellApp.shutdown();
  }

  /**
   * 进后台：申请 multiDeviceConnection 长时任务，防止系统冻结网络/回收渲染，
   * 导致回前台时页面被 ArkWeb 重新加载、连接全部重连。
   */
  onBackground(): void {
    const wantAgentInfo: wantAgent.WantAgentInfo = {
      wants: [{ bundleName: 'io.github.hyperion2144.dsh.plusm', abilityName: 'EntryAbility' }],
      operationType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
    };
    wantAgent.getWantAgent(wantAgentInfo).then((agent: WantAgent) => {
      return backgroundTaskManager.startBackgroundRunning(this.context,
        backgroundTaskManager.BackgroundMode.MULTI_DEVICE_CONNECTION, agent);
    }).then(() => {
      ShellLog.info('后台保活已申请（multiDeviceConnection）');
    }).catch((error: BusinessError) => {
      ShellLog.warn(`后台保活申请失败：${error.message}`);
    });
  }

  /** 回前台：后台保活任务完成使命，归还给系统。 */
  onForeground(): void {
    backgroundTaskManager.stopBackgroundRunning(this.context).catch(() => {
      // 已停止或未申请：无需处理。
    });
  }
}
