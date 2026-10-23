import { catByLevel, GameConfig, MAX_LEVEL } from "../domain/GameConfig";
import { DangerRules } from "../domain/DangerRules";
import { MergeCoordinator } from "../domain/MergeRules";
import { Rng } from "../domain/Rng";
import { ScoreRules } from "../domain/ScoreRules";
import { DrawResult, SpawnPolicy } from "../domain/SpawnPolicy";
import {
  BodySnapshot,
  CatEntity,
  CONTAINER_ID,
  DomainEvent,
  RunPhase,
  WorldDirective,
  WorldSnapshot,
} from "../domain/Types";

export interface StepResult {
  events: DomainEvent[];
  directives: WorldDirective[];
}

/** 新猫继承速度的上限（主策划只规定受限继承，数值待真机调优）。 */
const INHERIT_SPEED_CAP_LU_S = 120;

/**
 * 单局编排（应用层）。持有实体注册表、预览队列、投放节奏与局面状态机，
 * 每个 tick 按架构设计第 5 节的固定顺序推进规则：首次接触标记 → 合成预占与提交 →
 * 掉落阶段更新 → 危险判定。物理由适配层通过 WorldSnapshot 喂入，规则层不持有刚体。
 */
export class GameSession {
  private readonly rng: Rng;
  private readonly spawnPolicy: SpawnPolicy;
  private readonly scoreRules: ScoreRules;
  private readonly dangerRules: DangerRules;
  private readonly mergeCoordinator: MergeCoordinator;

  private entities = new Map<number, CatEntity>();
  private lastBodies = new Map<number, BodySnapshot>();
  private nextEntityId = 1;
  private tick = 0;

  private _phase: RunPhase = "Playing";
  private _score = 0;
  private currentDraw: DrawResult;
  private nextDraw: DrawResult;
  /** 新手局固定序列（主策划 2.2），非新手局为 null。 */
  private tutorialDraws: number[] | null = null;
  private tutorialIndex = 0;

  private lastDropTick = Number.NEGATIVE_INFINITY;
  private lastDropEntityId = 0;
  private reviveUsed = false;
  private reviveResumeTick = -1;

  readonly runId: string;
  readonly epoch: number;

  constructor(
    private readonly cfg: GameConfig,
    opts: { runId: string; epoch: number; seed: number; tutorial?: boolean },
  ) {
    this.runId = opts.runId;
    this.epoch = opts.epoch;
    this.rng = new Rng(opts.seed);
    this.spawnPolicy = new SpawnPolicy(cfg);
    this.scoreRules = new ScoreRules(cfg);
    this.dangerRules = new DangerRules(cfg);
    this.mergeCoordinator = new MergeCoordinator(cfg);
    if (opts.tutorial) {
      const seq = cfg.spawn.tutorialSequence;
      this.tutorialDraws = [...seq];
      this.currentDraw = { level: seq[0] ?? 1, lucky: false };
      this.nextDraw = { level: seq[1] ?? 1, lucky: false };
      this.tutorialIndex = 2;
    } else {
      this.currentDraw = this.drawFromPolicy();
      this.nextDraw = this.drawFromPolicy();
    }
  }

  get phase(): RunPhase {
    return this._phase;
  }

  get score(): number {
    return this._score;
  }

  get currentTick(): number {
    return this.tick;
  }

  /** 当前待投放与 Next 预览（投放时即固定，不随位置改变）。 */
  get preview(): { current: DrawResult; next: DrawResult } {
    return { current: this.currentDraw, next: this.nextDraw };
  }

  get aliveEntities(): readonly CatEntity[] {
    return [...this.entities.values()];
  }

  entityById(entityId: number): CatEntity | undefined {
    return this.entities.get(entityId);
  }

  private settledLevels(): Set<number> {
    const levels = new Set<number>();
    for (const e of this.entities.values()) {
      if (e.state === "Settled") levels.add(e.level);
    }
    return levels;
  }

  private drawFromPolicy(): DrawResult {
    return this.spawnPolicy.draw(this.rng, this.settledLevels());
  }

  private advanceDrawQueue(): void {
    this.currentDraw = this.nextDraw;
    if (this.tutorialDraws && this.tutorialIndex < this.tutorialDraws.length) {
      this.nextDraw = { level: this.tutorialDraws[this.tutorialIndex]!, lucky: false };
      this.tutorialIndex += 1;
    } else {
      this.nextDraw = this.drawFromPolicy();
    }
  }

  /** 是否允许在当前 tick 释放预览猫（主策划 2.1 第 2、3 条与架构第 7 节的投放节奏）。 */
  canDrop(tick: number): boolean {
    if (this._phase !== "Playing") return false;
    if (this.mergeCoordinator.pendingCount > 0) return false; // 合成生成锁
    if (tick - this.lastDropTick < this.cfg.rules.dropShowDelayTicks) return false;
    if (this.lastDropEntityId !== 0) {
      const prev = this.entities.get(this.lastDropEntityId);
      const prevSettled = !prev || prev.firstContactTick >= 0 || prev.state === "Despawn";
      if (!prevSettled && tick - this.lastDropTick < this.cfg.rules.dropFirstContactTimeoutTicks) {
        return false;
      }
    }
    return true;
  }

  /** 释放当前预览猫。返回实体 ID，不允许时返回 0。 */
  drop(xLu: number, tick: number): { entityId: number; events: DomainEvent[]; directives: WorldDirective[] } {
    if (!this.canDrop(tick)) return { entityId: 0, events: [], directives: [] };
    const level = this.currentDraw.level;
    const radius = catByLevel(this.cfg, level).radiusLu;
    const clampedX = Math.min(
      Math.max(xLu, radius),
      this.cfg.world.containerWidthLu - radius,
    );
    const entity: CatEntity = {
      entityId: this.nextEntityId++,
      generation: 1,
      level,
      state: "Falling",
      firstContactTick: -1,
      reservedByTxn: 0,
    };
    this.entities.set(entity.entityId, entity);
    this.lastDropTick = tick;
    this.lastDropEntityId = entity.entityId;
    const yLu = this.cfg.headlessSim.spawnYLu;
    const events: DomainEvent[] = [
      { type: "CatDropped", tick, entityId: entity.entityId, level, xLu: clampedX },
    ];
    const directives: WorldDirective[] = [
      { type: "SpawnBody", entityId: entity.entityId, level, xLu: clampedX, yLu, vxLuS: 0, vyLuS: 0 },
    ];
    this.advanceDrawQueue();
    return { entityId: entity.entityId, events, directives };
  }

  /** 推进一个逻辑 tick。快照 tick 必须单调递增。 */
  step(snapshot: WorldSnapshot): StepResult {
    const events: DomainEvent[] = [];
    const directives: WorldDirective[] = [];
    this.tick = snapshot.tick;

    if (this._phase === "Reviving") {
      if (snapshot.tick >= this.reviveResumeTick) {
        this._phase = "Playing";
        events.push({ type: "RunRevived", tick: snapshot.tick });
      } else {
        return { events, directives };
      }
    }
    if (this._phase === "Frozen" || this._phase === "Settled") {
      return { events, directives };
    }

    this.lastBodies = new Map(snapshot.bodies.map((b) => [b.entityId, b]));

    // 1. 首次有效碰撞标记：Falling 猫与容器或任意猫发生接触即进入结算集合
    for (const pair of snapshot.contacts) {
      for (const id of [pair.aId, pair.bId]) {
        if (id === CONTAINER_ID) continue;
        const entity = this.entities.get(id);
        if (entity && entity.state === "Falling") {
          entity.state = "Settled";
          entity.firstContactTick = snapshot.tick;
          events.push({ type: "CatFirstContact", tick: snapshot.tick, entityId: id });
        }
      }
    }

    // 2. 合成：维护连续接触 → 预占 → 到期提交
    this.mergeCoordinator.updateContacts(snapshot.tick, snapshot.contacts);
    const isEligible = (id: number): boolean => {
      const e = this.entities.get(id);
      return !!e && e.state === "Settled" && !this.mergeCoordinator.isReserved(id);
    };
    const levelOf = (id: number): number => this.entities.get(id)?.level ?? 0;
    for (const cand of this.mergeCoordinator.findCandidates(snapshot.tick, snapshot.contacts, isEligible, levelOf)) {
      const txn = this.mergeCoordinator.reserve(snapshot.tick, cand.aId, cand.bId, cand.level);
      for (const id of [cand.aId, cand.bId]) {
        const e = this.entities.get(id)!;
        e.state = "MergeReserved";
        e.reservedByTxn = txn.txnId;
      }
      events.push({
        type: "MergeReserved",
        tick: snapshot.tick,
        txnId: txn.txnId,
        aId: cand.aId,
        bId: cand.bId,
        level: cand.level,
        commitTick: txn.commitTick,
      });
    }
    for (const txn of this.mergeCoordinator.collectDue(snapshot.tick)) {
      this.commitMerge(txn.txnId, txn.aId, txn.bId, txn.level, snapshot.tick, events, directives);
    }

    // 3. 掉落阶段：按有效实体最高顶边推进
    let maxTop = 0;
    for (const e of this.entities.values()) {
      if (e.state !== "Settled") continue;
      const body = this.lastBodies.get(e.entityId);
      if (!body) continue;
      maxTop = Math.max(maxTop, body.yLu + catByLevel(this.cfg, e.level).radiusLu);
    }
    this.spawnPolicy.updatePhase(snapshot.tick, maxTop / this.cfg.world.dangerLineYLu);

    // 4. 危险判定：只统计 Settled 实体的顶边
    const over = new Set<number>();
    for (const e of this.entities.values()) {
      if (e.state !== "Settled") continue;
      const body = this.lastBodies.get(e.entityId);
      if (!body) continue;
      if (body.yLu + catByLevel(this.cfg, e.level).radiusLu > this.cfg.world.dangerLineYLu) {
        over.add(e.entityId);
      }
    }
    const dangerResult = this.dangerRules.update(snapshot.tick, over);
    if (dangerResult === "countdownStarted") {
      this._phase = "DangerCountdown";
      events.push({
        type: "DangerCountdownStarted",
        tick: snapshot.tick,
        deadlineTick: this.dangerRules.deadlineTick,
      });
    } else if (dangerResult === "cleared") {
      this._phase = "Playing";
      events.push({ type: "DangerCleared", tick: snapshot.tick });
    } else if (dangerResult === "failed") {
      this.onRunFailed(snapshot.tick, events);
    }

    return { events, directives };
  }

  private commitMerge(
    txnId: number,
    aId: number,
    bId: number,
    level: number,
    tick: number,
    events: DomainEvent[],
    directives: WorldDirective[],
  ): void {
    const a = this.entities.get(aId);
    const b = this.entities.get(bId);
    if (!a || !b || a.state !== "MergeReserved" || b.state !== "MergeReserved") return;
    const bodyA = this.lastBodies.get(aId);
    const bodyB = this.lastBodies.get(bId);
    const cx = bodyA && bodyB ? (bodyA.xLu + bodyB.xLu) / 2 : this.cfg.world.containerWidthLu / 2;
    const cy = bodyA && bodyB ? (bodyA.yLu + bodyB.yLu) / 2 : catByLevel(this.cfg, level).radiusLu;

    this.removeEntity(aId, directives);
    this.removeEntity(bId, directives);

    if (level >= MAX_LEVEL) {
      const gained = this.scoreRules.onTopLevelPairCleared(tick);
      this._score += gained;
      events.push({ type: "TopLevelPairCleared", tick, txnId, gainedScore: gained });
      return;
    }

    const newLevel = level + 1;
    const entity: CatEntity = {
      entityId: this.nextEntityId++,
      generation: 1,
      level: newLevel,
      state: "Settled",
      firstContactTick: tick,
      reservedByTxn: 0,
    };
    this.entities.set(entity.entityId, entity);
    let vx = bodyA && bodyB ? (bodyA.vxLuS + bodyB.vxLuS) / 2 : 0;
    let vy = bodyA && bodyB ? (bodyA.vyLuS + bodyB.vyLuS) / 2 : 0;
    const speed = Math.hypot(vx, vy);
    if (speed > INHERIT_SPEED_CAP_LU_S) {
      vx = (vx / speed) * INHERIT_SPEED_CAP_LU_S;
      vy = (vy / speed) * INHERIT_SPEED_CAP_LU_S;
    }
    directives.push({
      type: "SpawnBody",
      entityId: entity.entityId,
      level: newLevel,
      xLu: cx,
      yLu: cy,
      vxLuS: vx,
      vyLuS: vy,
    });
    const scored = this.scoreRules.onMergeCommitted(tick, newLevel);
    this._score += scored.gainedScore + scored.fiveComboBonus;
    events.push({
      type: "MergeCommitted",
      tick,
      txnId,
      newEntityId: entity.entityId,
      level: newLevel,
      xLu: cx,
      yLu: cy,
      baseScore: scored.baseScore,
      combo: scored.combo,
      multiplier: scored.multiplier,
      gainedScore: scored.gainedScore,
    });
    if (scored.fiveComboReward) {
      events.push({
        type: "FiveComboReached",
        tick,
        reward: scored.fiveComboReward,
        bonusScore: scored.fiveComboBonus,
      });
    }
    directives.push({ type: "ApplyShockwave", xLu: cx, yLu: cy, sourceLevel: newLevel });
  }

  private removeEntity(entityId: number, directives: WorldDirective[]): void {
    const e = this.entities.get(entityId);
    if (!e) return;
    e.state = "Despawn";
    this.entities.delete(entityId);
    directives.push({ type: "RemoveBody", entityId });
  }

  private onRunFailed(tick: number, events: DomainEvent[]): void {
    this._phase = "Frozen";
    // 冻结时取消全部未完成合成事务，被预占的猫回到结算集合（架构设计第 7 节）
    this.mergeCoordinator.cancelAll();
    for (const e of this.entities.values()) {
      if (e.state === "MergeReserved") {
        e.state = "Settled";
        e.reservedByTxn = 0;
      }
    }
    events.push({ type: "RunFailed", tick });
  }

  /** 复活：按顶边高度降序、ID 升序移除最高两只合法猫，全体清零速度，0.30s 后恢复。一局一次。 */
  revive(tick: number): StepResult {
    const events: DomainEvent[] = [];
    const directives: WorldDirective[] = [];
    if (this._phase !== "Frozen" || this.reviveUsed) return { events, directives };
    this.reviveUsed = true;
    const candidates = [...this.entities.values()]
      .filter((e) => e.state === "Settled")
      .map((e) => {
        const body = this.lastBodies.get(e.entityId);
        const top = body ? body.yLu + catByLevel(this.cfg, e.level).radiusLu : 0;
        return { e, top };
      })
      .sort((x, y) => y.top - x.top || x.e.entityId - y.e.entityId);
    const removed: number[] = [];
    for (const { e } of candidates.slice(0, 2)) {
      removed.push(e.entityId);
      this.removeEntity(e.entityId, directives);
    }
    for (const e of this.entities.values()) {
      directives.push({ type: "ZeroVelocity", entityId: e.entityId });
    }
    this.dangerRules.reset();
    this._phase = "Reviving";
    this.reviveResumeTick = tick + this.cfg.rules.reviveWaitTicks;
    events.push({ type: "CatsRemovedForRevive", tick, entityIds: removed });
    return { events, directives };
  }

  /** 放弃复活进入结算。 */
  settle(): void {
    if (this._phase === "Frozen") this._phase = "Settled";
  }
}
