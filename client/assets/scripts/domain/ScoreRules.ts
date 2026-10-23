import { GameConfig } from "./GameConfig";

/**
 * 计分规则（主策划 3.2 与 2.1 第 5 条）。
 * 基础分按生成等级查表；Combo 在 1.2s 窗口内连续合成时递增，倍率封顶第 5 档；
 * 显示分数四舍五入。首次达成 5 连击奖励彩虹球，同局后续达成改为 +200 分。
 */
export class ScoreRules {
  private combo = 0;
  private lastMergeTick = -1;
  private fiveComboRewardClaimed = false;

  constructor(private readonly cfg: GameConfig) {}

  /** 一次普通合成提交时调用，返回本次得分与连击信息。 */
  onMergeCommitted(tick: number, createdLevel: number): {
    baseScore: number;
    combo: number;
    multiplier: number;
    gainedScore: number;
    fiveComboReward: "RainbowBall" | "BonusScore" | null;
    fiveComboBonus: number;
  } {
    const baseScore = this.cfg.cats[createdLevel - 1]!.baseScore;
    if (this.lastMergeTick >= 0 && tick - this.lastMergeTick <= this.cfg.rules.comboWindowTicks) {
      this.combo += 1;
    } else {
      this.combo = 1;
    }
    this.lastMergeTick = tick;
    const table = this.cfg.rules.comboMultipliers;
    const multiplier = table[Math.min(this.combo, table.length) - 1]!;
    const gainedScore = Math.round(baseScore * multiplier);

    let fiveComboReward: "RainbowBall" | "BonusScore" | null = null;
    let fiveComboBonus = 0;
    if (this.combo === 5) {
      if (!this.fiveComboRewardClaimed) {
        fiveComboReward = "RainbowBall";
        this.fiveComboRewardClaimed = true;
      } else {
        fiveComboReward = "BonusScore";
        fiveComboBonus = this.cfg.rules.fiveComboRepeatScore;
      }
    }
    return { baseScore, combo: this.combo, multiplier, gainedScore, fiveComboReward, fiveComboBonus };
  }

  /** 双 Lv11 清场固定 4096 分，不套用基础分与倍率；但刷新连击窗口。 */
  onTopLevelPairCleared(tick: number): number {
    if (this.lastMergeTick >= 0 && tick - this.lastMergeTick <= this.cfg.rules.comboWindowTicks) {
      this.combo += 1;
    } else {
      this.combo = 1;
    }
    this.lastMergeTick = tick;
    return this.cfg.rules.dualTopLevelScore;
  }

  get currentCombo(): number {
    return this.combo;
  }
}
