import { GameConfig } from "./GameConfig";

export type DangerUpdateResult = "none" | "countdownStarted" | "cleared" | "failed";

/**
 * 危险线判定（主策划 2.1 第 6 条与架构设计第 7 节）。
 * 高度一律使用球体顶边 positionY + radius，由会话层按有效实体集合喂入；
 * 单只猫连续越线 0.60s 触发 3s 倒计时；全部回到线下持续 0.30s 解除。
 */
export class DangerRules {
  private overSinceById = new Map<number, number>();
  private countdownDeadlineTick = -1;
  private allClearSinceTick = -1;

  constructor(private readonly cfg: GameConfig) {}

  get inCountdown(): boolean {
    return this.countdownDeadlineTick >= 0;
  }

  get deadlineTick(): number {
    return this.countdownDeadlineTick;
  }

  /**
   * overEntityIds 为本 tick 顶边越过危险线的有效实体集合（已排除 Preview/Falling/Merge/Despawn）。
   */
  update(tick: number, overEntityIds: ReadonlySet<number>): DangerUpdateResult {
    // 维护每只猫的连续越线起点，中断即清零
    for (const id of [...this.overSinceById.keys()]) {
      if (!overEntityIds.has(id)) this.overSinceById.delete(id);
    }
    for (const id of overEntityIds) {
      if (!this.overSinceById.has(id)) this.overSinceById.set(id, tick);
    }

    if (!this.inCountdown) {
      for (const since of this.overSinceById.values()) {
        if (tick - since >= this.cfg.rules.dangerTriggerTicks) {
          this.countdownDeadlineTick = tick + this.cfg.rules.dangerCountdownTicks;
          this.allClearSinceTick = -1;
          return "countdownStarted";
        }
      }
      return "none";
    }

    if (overEntityIds.size === 0) {
      if (this.allClearSinceTick < 0) this.allClearSinceTick = tick;
      if (tick - this.allClearSinceTick >= this.cfg.rules.dangerClearTicks) {
        this.reset();
        return "cleared";
      }
    } else {
      this.allClearSinceTick = -1;
    }
    if (tick >= this.countdownDeadlineTick) {
      return "failed";
    }
    return "none";
  }

  reset(): void {
    this.overSinceById.clear();
    this.countdownDeadlineTick = -1;
    this.allClearSinceTick = -1;
  }
}
