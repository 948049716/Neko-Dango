/**
 * 规则层共享类型。规则层只处理普通数据：物理接触与刚体快照由适配层（引擎 Bullet 或无头模拟）
 * 以这里的结构喂入，规则层不导入任何引擎或平台 API。
 */

/** 猫咪在规则层的生命周期。Impact 与 Idle 的表现差异由表现层处理，规则层统一为 Settled。 */
export type CatLifecycleState =
  | "Preview" // 顶部预览，尚未释放
  | "Falling" // 已释放，未发生首次有效碰撞
  | "Settled" // 已进入容器结算集合，可参与合成与危险判定
  | "MergeReserved" // 已被合成事务预占，等待提交
  | "Despawn"; // 等待回收

export interface CatEntity {
  entityId: number;
  /** 对象池租用代数。M0 无头实现暂不真正复用池槽位，字段先行保留。 */
  generation: number;
  level: number;
  state: CatLifecycleState;
  /** 首次有效碰撞发生的 tick，未发生为 -1。 */
  firstContactTick: number;
  /** 被哪个合成事务预占，未预占为 0。 */
  reservedByTxn: number;
}

/** 单个刚体在某一 tick 的只读快照，位置单位为 lu，坐标原点在容器底部内侧左下角。 */
export interface BodySnapshot {
  entityId: number;
  xLu: number;
  yLu: number;
  vxLuS: number;
  vyLuS: number;
}

/** 一对实体在某一 tick 的接触。normalRelSpeedLuS 为沿接触法线的相对速度绝对值。 */
export interface ContactPair {
  aId: number;
  bId: number;
  normalRelSpeedLuS: number;
}

/** 地面/侧壁的伪实体 ID，用于表达与容器的接触（首次有效碰撞判定）。 */
export const CONTAINER_ID = 0;

/** 适配层每个 tick 喂给规则层的完整快照。 */
export interface WorldSnapshot {
  tick: number;
  bodies: BodySnapshot[];
  contacts: ContactPair[];
}

export type RunPhase = "Playing" | "DangerCountdown" | "Frozen" | "Reviving" | "Settled";

/** 领域事件。表现层、音频与无头模拟（冲击波）都只消费事件，不反向修改规则状态。 */
export type DomainEvent =
  | { type: "CatDropped"; tick: number; entityId: number; level: number; xLu: number }
  | { type: "CatFirstContact"; tick: number; entityId: number }
  | {
      type: "MergeReserved";
      tick: number;
      txnId: number;
      aId: number;
      bId: number;
      level: number;
      commitTick: number;
    }
  | {
      type: "MergeCommitted";
      tick: number;
      txnId: number;
      newEntityId: number;
      level: number;
      xLu: number;
      yLu: number;
      baseScore: number;
      combo: number;
      multiplier: number;
      gainedScore: number;
    }
  | { type: "TopLevelPairCleared"; tick: number; txnId: number; gainedScore: number }
  | { type: "FiveComboReached"; tick: number; reward: "RainbowBall" | "BonusScore"; bonusScore: number }
  | { type: "DangerCountdownStarted"; tick: number; deadlineTick: number }
  | { type: "DangerCleared"; tick: number }
  | { type: "RunFailed"; tick: number }
  | { type: "CatsRemovedForRevive"; tick: number; entityIds: number[] }
  | { type: "RunRevived"; tick: number };

/** 规则层要求适配层执行的实体增删指令，与事件分开，避免把演出事件误当指令。 */
export type WorldDirective =
  | { type: "SpawnBody"; entityId: number; level: number; xLu: number; yLu: number; vxLuS: number; vyLuS: number }
  | { type: "RemoveBody"; entityId: number }
  | { type: "ApplyShockwave"; xLu: number; yLu: number; sourceLevel: number }
  | { type: "ZeroVelocity"; entityId: number };
