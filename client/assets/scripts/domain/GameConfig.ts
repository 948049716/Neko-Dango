/**
 * 配置类型与构建期校验。数值来源：主策划 v2.2.0 第三章数值表、第二章规则，
 * 以及架构设计中的 tick 化口径（60Hz 固定步）。配置 JSON 由 Cocos 侧作为 JsonAsset 加载后注入，
 * 无头测试则从 client/assets/configs/game-config.json 读取同一份文件。
 */
export interface CatLevelConfig {
  level: number;
  name: string;
  radiusLu: number;
  mass: number;
  restitution: number;
  baseScore: number;
  displayWeightKg: number;
  codexLine: string;
}

export interface RulesConfig {
  mergeContactTicks: number;
  mergeMaxNormalSpeedLuS: number;
  mergeCommitTicks: number;
  dualTopLevelCommitTicks: number;
  dualTopLevelScore: number;
  dropShowDelayTicks: number;
  dropFirstContactTimeoutTicks: number;
  dangerTriggerTicks: number;
  dangerCountdownTicks: number;
  dangerClearTicks: number;
  comboWindowTicks: number;
  comboMultipliers: number[];
  fiveComboRepeatScore: number;
  reviveWaitTicks: number;
  shockwaveUpwardKeepRatio: number;
  shockwaveMaxDeltaVelocityLuS: number;
}

export interface SpawnPhaseConfig {
  name: string;
  weightsPercent: number[];
}

export interface SpawnConfig {
  phases: SpawnPhaseConfig[];
  phaseThresholds: number[];
  phaseHysteresis: number;
  phaseHoldTicks: number;
  maxSameLevelStreak: number;
  luckyPityStreak: number;
  tutorialSequence: number[];
}

export interface GameConfig {
  version: string;
  tickRate: number;
  world: { containerWidthLu: number; dangerLineYLu: number; unitsPerMeter: number };
  cats: CatLevelConfig[];
  rules: RulesConfig;
  spawn: SpawnConfig;
  headlessSim: { gravityLuS2: number; substeps: number; spawnYLu: number; restVelocityLuS: number };
}

export const MAX_LEVEL = 11;

/** 校验配置合法性，返回问题列表，空数组表示通过。构建与测试都会调用。 */
export function validateConfig(cfg: GameConfig): string[] {
  const problems: string[] = [];
  if (cfg.tickRate !== 60) problems.push(`tickRate 必须为 60，实际 ${cfg.tickRate}`);
  if (cfg.cats.length !== MAX_LEVEL) problems.push(`猫咪等级必须为 ${MAX_LEVEL} 级，实际 ${cfg.cats.length}`);
  let prevRadius = 0;
  cfg.cats.forEach((cat, idx) => {
    if (cat.level !== idx + 1) problems.push(`等级序号不连续：下标 ${idx} 的 level=${cat.level}`);
    if (cat.radiusLu <= prevRadius) problems.push(`Lv${cat.level} 半径未严格递增`);
    prevRadius = cat.radiusLu;
    if (cat.mass <= 0) problems.push(`Lv${cat.level} 质量必须为正`);
    if (cat.restitution < 0 || cat.restitution > 1) problems.push(`Lv${cat.level} 弹性超出 [0,1]`);
  });
  const top = cfg.cats[MAX_LEVEL - 1];
  if (top) {
    // 双 Lv11 交错堆叠总高度必须低于危险线，对应主策划 3.1 的拓扑验算
    const w = cfg.world.containerWidthLu;
    const stackHeight = 2 * top.radiusLu + Math.sqrt(Math.max(0, 4 * w * top.radiusLu - w * w));
    if (stackHeight >= cfg.world.dangerLineYLu) {
      problems.push(`双 Lv11 堆叠高度 ${stackHeight.toFixed(1)}lu 不低于危险线 ${cfg.world.dangerLineYLu}lu`);
    }
  }
  cfg.spawn.phases.forEach((phase) => {
    if (phase.weightsPercent.length !== 4) {
      problems.push(`掉落阶段 ${phase.name} 权重必须为 Lv01~Lv04 共 4 项`);
    }
    const sum = phase.weightsPercent.reduce((a, b) => a + b, 0);
    if (sum !== 100) problems.push(`掉落阶段 ${phase.name} 权重和为 ${sum}，应为 100`);
  });
  if (cfg.spawn.phaseThresholds.length !== cfg.spawn.phases.length - 1) {
    problems.push("阶段阈值数量应为阶段数减一");
  }
  if (cfg.rules.comboMultipliers.length < 5) problems.push("Combo 倍率表至少需要 5 档");
  if (cfg.rules.dualTopLevelScore <= 0) problems.push("双 Lv11 奖励分必须为正");
  if (cfg.rules.mergeMaxNormalSpeedLuS !== 80) problems.push("合成法向速度阈值应与主策划一致（80lu/s）");
  return problems;
}

/** 按等级取猫咪配置，等级从 1 开始。 */
export function catByLevel(cfg: GameConfig, level: number): CatLevelConfig {
  const cat = cfg.cats[level - 1];
  if (!cat) throw new Error(`不存在的猫咪等级：${level}`);
  return cat;
}
