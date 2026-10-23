import { GameConfig } from "./GameConfig";
import { Rng } from "./Rng";

export interface DrawResult {
  level: number;
  /** 是否为幸运毛球保底替换（需要在 Next 气泡上显示幸运标记）。 */
  lucky: boolean;
}

/**
 * 掉落策略（主策划 3.3）。只产出 Lv01~Lv04；
 * 阶段按堆叠高度比例切换，跨阈值持续 0.50s 且带 3% 回差后生效；
 * 同一等级连续出现不超过 3 次；连续 8 次投放都无场上可配对等级时，
 * 下一只替换为场上已有的最低等级（幸运毛球）。
 */
export class SpawnPolicy {
  private phaseIndex = 0;
  private pendingPhase = -1;
  private pendingSinceTick = -1;
  private recentLevels: number[] = [];
  private unpairableStreak = 0;
  private pityArmed = false;

  constructor(private readonly cfg: GameConfig) {}

  get currentPhaseIndex(): number {
    return this.phaseIndex;
  }

  /** 每 tick 以当前堆叠高度比例推进阶段切换判定。 */
  updatePhase(tick: number, stackHeightRatio: number): void {
    const { phaseThresholds, phaseHysteresis, phaseHoldTicks } = this.cfg.spawn;
    let desired = this.phaseIndex;
    // 上行用 阈值+回差，下行用 阈值-回差，避免在边界反复横跳
    if (this.phaseIndex < 2 && stackHeightRatio >= phaseThresholds[this.phaseIndex]! + phaseHysteresis) {
      desired = this.phaseIndex + 1;
    } else if (this.phaseIndex > 0 && stackHeightRatio < phaseThresholds[this.phaseIndex - 1]! - phaseHysteresis) {
      desired = this.phaseIndex - 1;
    }
    if (desired === this.phaseIndex) {
      this.pendingPhase = -1;
      this.pendingSinceTick = -1;
      return;
    }
    if (this.pendingPhase !== desired) {
      this.pendingPhase = desired;
      this.pendingSinceTick = tick;
      return;
    }
    if (tick - this.pendingSinceTick >= phaseHoldTicks) {
      this.phaseIndex = desired;
      this.pendingPhase = -1;
      this.pendingSinceTick = -1;
    }
  }

  /**
   * 抽取下一只猫。fieldSettledLevels 为当前场上已结算猫咪的等级集合（用于可配对判定）。
   * 抽取结果在投放时即固定，Next 预览与之一致。
   */
  draw(rng: Rng, fieldSettledLevels: ReadonlySet<number>): DrawResult {
    let level: number;
    let lucky = false;
    if (this.pityArmed && fieldSettledLevels.size > 0) {
      level = Math.min(...fieldSettledLevels);
      lucky = true;
      this.pityArmed = false;
      this.unpairableStreak = 0;
    } else {
      const weights = [...this.cfg.spawn.phases[this.phaseIndex]!.weightsPercent];
      const last = this.recentLevels[this.recentLevels.length - 1];
      if (
        last !== undefined &&
        this.recentLevels.length >= this.cfg.spawn.maxSameLevelStreak &&
        this.recentLevels.slice(-this.cfg.spawn.maxSameLevelStreak).every((lv) => lv === last)
      ) {
        weights[last - 1] = 0; // 连续同级达到上限，本次排除该等级
      }
      level = rng.pickWeighted(weights) + 1;
      // 本次投放若在场上有同级可配对则清零保底计数，否则累加
      if (fieldSettledLevels.has(level)) {
        this.unpairableStreak = 0;
      } else {
        this.unpairableStreak += 1;
        if (this.unpairableStreak >= this.cfg.spawn.luckyPityStreak) {
          this.pityArmed = true;
          this.unpairableStreak = 0;
        }
      }
    }
    this.recentLevels.push(level);
    if (this.recentLevels.length > 16) this.recentLevels.shift();
    return { level, lucky };
  }
}
