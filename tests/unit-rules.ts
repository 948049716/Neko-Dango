import { GameSession } from "../client/assets/scripts/application/GameSession";
import { catByLevel, GameConfig } from "../client/assets/scripts/domain/GameConfig";
import { MergeCoordinator } from "../client/assets/scripts/domain/MergeRules";
import { Rng } from "../client/assets/scripts/domain/Rng";
import { ScoreRules } from "../client/assets/scripts/domain/ScoreRules";
import { SpawnPolicy } from "../client/assets/scripts/domain/SpawnPolicy";
import {
  BodySnapshot,
  CONTAINER_ID,
  ContactPair,
  DomainEvent,
  WorldSnapshot,
} from "../client/assets/scripts/domain/Types";
import { check, eq, finish, loadConfig, section } from "./TestKit";

const cfg = loadConfig();

function body(entityId: number, xLu: number, yLu: number): BodySnapshot {
  return { entityId, xLu, yLu, vxLuS: 0, vyLuS: 0 };
}

function snap(tick: number, bodies: BodySnapshot[], contacts: ContactPair[] = []): WorldSnapshot {
  return { tick, bodies, contacts };
}

function floorContact(entityId: number): ContactPair {
  return { aId: entityId, bId: CONTAINER_ID, normalRelSpeedLuS: 40 };
}

function radiusOf(session: GameSession, entityId: number): number {
  const e = session.entityById(entityId)!;
  return catByLevel(cfg, e.level).radiusLu;
}

/** 投放一只猫并在下一 tick 用地面接触把它送入结算集合，返回实体 ID 与当前 tick。 */
function dropAndSettle(
  session: GameSession,
  xLu: number,
  tick: number,
): { entityId: number; tick: number } {
  const dropped = session.drop(xLu, tick);
  check(dropped.entityId > 0, `tick ${tick} 投放应成功`);
  const r = radiusOf(session, dropped.entityId);
  session.step(snap(tick + 1, [body(dropped.entityId, xLu, r)], [floorContact(dropped.entityId)]));
  eq(session.entityById(dropped.entityId)!.state, "Settled", "首次接触后进入结算集合");
  return { entityId: dropped.entityId, tick: tick + 1 };
}

function eventsOfType<T extends DomainEvent["type"]>(
  events: DomainEvent[],
  type: T,
): Array<Extract<DomainEvent, { type: T }>> {
  return events.filter((e) => e.type === type) as Array<Extract<DomainEvent, { type: T }>>;
}

// ---------------------------------------------------------------- 投放节奏
section("投放节奏（0.35s 展示间隔 + 首次碰撞或 0.90s 超时 + 生成锁）");
{
  const s = new GameSession(cfg, { runId: "pace", epoch: 1, seed: 7 });
  const first = s.drop(320, 0);
  check(first.entityId > 0, "首只猫可立即投放");
  eq(s.canDrop(10), false, "0.35s 内不可再次投放");
  eq(s.canDrop(21), false, "上一只未碰撞且未满 0.90s 时不可投放");
  const r = radiusOf(s, first.entityId);
  s.step(snap(22, [body(first.entityId, 320, r)], [floorContact(first.entityId)]));
  eq(s.canDrop(22), true, "上一只首次碰撞后可投放");
  const second = s.drop(200, 22);
  check(second.entityId > 0, "第二只投放成功");
  eq(s.canDrop(30), false, "展示间隔内不可投放");
}

// ---------------------------------------------------------------- 教程序列
section("新手局固定序列 Lv01、Lv01、Lv02");
{
  const s = new GameSession(cfg, { runId: "tut", epoch: 0, seed: 1, tutorial: true });
  eq(s.preview.current.level, 1, "教程首只为 Lv01");
  eq(s.preview.next.level, 1, "教程第二只为 Lv01");
  s.drop(320, 0);
  eq(s.preview.current.level, 1, "投放后当前只为 Lv01");
  eq(s.preview.next.level, 2, "投放后 Next 为 Lv02");
}

// ---------------------------------------------------------------- 合成条件与提交
section("合成：连续接触 50ms + 法向速度 < 80 + 27 tick 后提交");
{
  const s = new GameSession(cfg, { runId: "merge", epoch: 0, seed: 1, tutorial: true });
  const a = dropAndSettle(s, 100, 0);
  const b = dropAndSettle(s, 152, 22);
  const rA = radiusOf(s, a.entityId);
  const rB = radiusOf(s, b.entityId);
  const pair: ContactPair = { aId: a.entityId, bId: b.entityId, normalRelSpeedLuS: 10 };
  const bodies = () => [body(a.entityId, 100, rA), body(b.entityId, 152, rB)];

  let reservedAt = -1;
  for (let t = 24; t <= 26; t++) {
    const res = s.step(snap(t, bodies(), [pair]));
    if (eventsOfType(res.events, "MergeReserved").length > 0) reservedAt = t;
    if (t < 26) eq(eventsOfType(res.events, "MergeReserved").length, 0, `接触第 ${t - 23} tick 不应预占`);
  }
  eq(reservedAt, 26, "连续接触满 3 tick 时预占");
  eq(s.canDrop(30), false, "合成事务未完成时生成锁禁止投放");

  let committed: DomainEvent[] = [];
  for (let t = 27; t <= 53; t++) {
    const res = s.step(snap(t, bodies(), [pair]));
    committed = committed.concat(res.events);
  }
  const merges = eventsOfType(committed, "MergeCommitted");
  eq(merges.length, 1, "27 tick 后提交一次合成");
  eq(merges[0]!.level, 2, "两只 Lv01 合成 Lv02");
  eq(merges[0]!.gainedScore, 2, "Lv02 基础分 +2");
  eq(s.score, 2, "会话分数为 2");
  eq(s.aliveEntities.length, 1, "合成后场上剩 1 只");
}

section("合成速度门槛：高速擦碰不合成");
{
  const s = new GameSession(cfg, { runId: "speed", epoch: 0, seed: 1, tutorial: true });
  const a = dropAndSettle(s, 100, 0);
  const b = dropAndSettle(s, 152, 22);
  const fast: ContactPair = { aId: a.entityId, bId: b.entityId, normalRelSpeedLuS: 100 };
  let reserved = 0;
  for (let t = 24; t <= 40; t++) {
    const res = s.step(
      snap(t, [body(a.entityId, 100, radiusOf(s, a.entityId)), body(b.entityId, 152, radiusOf(s, b.entityId))], [fast]),
    );
    reserved += eventsOfType(res.events, "MergeReserved").length;
  }
  eq(reserved, 0, "法向相对速度 100lu/s 的接触不触发合成");
}

section("合成接触中断清零");
{
  const s = new GameSession(cfg, { runId: "gap", epoch: 0, seed: 1, tutorial: true });
  const a = dropAndSettle(s, 100, 0);
  const b = dropAndSettle(s, 152, 22);
  const pair: ContactPair = { aId: a.entityId, bId: b.entityId, normalRelSpeedLuS: 10 };
  const bodies = () => [
    body(a.entityId, 100, radiusOf(s, a.entityId)),
    body(b.entityId, 152, radiusOf(s, b.entityId)),
  ];
  s.step(snap(24, bodies(), [pair]));
  s.step(snap(25, bodies(), [pair]));
  s.step(snap(26, bodies(), [])); // 接触中断
  s.step(snap(27, bodies(), [pair]));
  const res28 = s.step(snap(28, bodies(), [pair]));
  eq(eventsOfType(res28.events, "MergeReserved").length, 0, "中断后重新累计，中断前的时间不算");
  const res29 = s.step(snap(29, bodies(), [pair]));
  eq(eventsOfType(res29.events, "MergeReserved").length, 1, "重新连续满 3 tick 后预占");
}

// ---------------------------------------------------------------- Combo 计分
section("Combo：1.2s 内连锁合成倍率与计分");
{
  const rules = new ScoreRules(cfg);
  const m1 = rules.onMergeCommitted(100, 2);
  eq(m1.gainedScore, 2, "首合成 Lv02 得 2 分");
  const m2 = rules.onMergeCommitted(150, 3);
  eq(m2.combo, 2, "50 tick 内第二次合成记 2 连击");
  eq(m2.gainedScore, 5, "Lv03 基础 4 × 1.15 四舍五入为 5");
  const m3 = rules.onMergeCommitted(400, 3);
  eq(m3.combo, 1, "超过 1.2s 窗口后连击重置");
  const clear = rules.onTopLevelPairCleared(500);
  eq(clear, 4096, "双 Lv11 清场固定 4096 分");

  const chain = new ScoreRules(cfg);
  let rewardAt5: string | null = null;
  for (let i = 0; i < 5; i++) {
    const m = chain.onMergeCommitted(i * 10, 2);
    if (m.fiveComboReward) rewardAt5 = m.fiveComboReward;
  }
  eq(rewardAt5, "RainbowBall", "本局首次 5 连击奖励彩虹球");
  let bonusAtSecond5 = 0;
  for (let i = 0; i < 5; i++) {
    const m = chain.onMergeCommitted(1000 + i * 10, 2);
    if (m.fiveComboReward === "BonusScore") bonusAtSecond5 = m.fiveComboBonus;
  }
  eq(bonusAtSecond5, 200, "同局后续 5 连击改为 +200 分");
}

// ---------------------------------------------------------------- 双 Lv11 事务时序
section("双 Lv11：36 tick 提交且不生成新猫");
{
  const coord = new MergeCoordinator(cfg);
  const pair: ContactPair = { aId: 1, bId: 2, normalRelSpeedLuS: 5 };
  coord.updateContacts(0, [pair]);
  coord.updateContacts(1, [pair]);
  coord.updateContacts(2, [pair]);
  const cands = coord.findCandidates(2, [pair], () => true, () => 11);
  eq(cands.length, 1, "Lv11 对满足合成条件");
  const txn = coord.reserve(2, 1, 2, 11);
  eq(txn.commitTick, 38, "双 Lv11 在 36 tick 后提交");
  eq(coord.collectDue(37).length, 0, "37 tick 时未到期");
  eq(coord.collectDue(38).length, 1, "38 tick 时到期");
}

// ---------------------------------------------------------------- 掉落策略
class FirstPositiveRng extends Rng {
  override pickWeighted(weights: readonly number[]): number {
    return weights.findIndex((w) => w > 0);
  }
}

section("掉落策略：同级三连上限、幸运毛球保底、阶段回差");
{
  const policy = new SpawnPolicy(cfg);
  const rng = new FirstPositiveRng(1);
  const emptyField = new Set<number>();
  const seq: number[] = [];
  for (let i = 0; i < 8; i++) seq.push(policy.draw(rng, emptyField).level);
  check(
    JSON.stringify(seq) === JSON.stringify([1, 1, 1, 2, 1, 1, 1, 2]),
    `同级最多连出 3 次后强制换级（实际序列 ${seq.join(",")}）`,
  );
  const pity = policy.draw(rng, new Set([3]));
  eq(pity.level, 3, "连续 8 次无可配对后，幸运毛球替换为场上已有等级");
  eq(pity.lucky, true, "幸运毛球带幸运标记");

  const phasePolicy = new SpawnPolicy(cfg);
  for (let t = 0; t < 30; t++) phasePolicy.updatePhase(t, 0.7);
  eq(phasePolicy.currentPhaseIndex, 0, "跨阈值未满 0.50s 不切换阶段");
  phasePolicy.updatePhase(30, 0.7);
  eq(phasePolicy.currentPhaseIndex, 1, "持续 0.50s 后切换到中盘阶段");
  const hysteresis = new SpawnPolicy(cfg);
  for (let t = 0; t < 100; t++) hysteresis.updatePhase(t, 0.42);
  eq(hysteresis.currentPhaseIndex, 0, "回差带内（0.42 < 0.43）不抖动切换");
}

// ---------------------------------------------------------------- 危险线与复活
section("危险线：0.60s 越线触发 3s 倒计时，超时冻结，复活移除最高两只");
{
  const s = new GameSession(cfg, { runId: "danger", epoch: 1, seed: 3 });
  const a = dropAndSettle(s, 100, 0);
  const b = dropAndSettle(s, 300, 22);
  const c = dropAndSettle(s, 500, 44);
  const topOf = (id: number, top: number) => {
    const r = radiusOf(s, id);
    return body(id, 100, top - r);
  };
  const allBodies = (aTop: number) => [topOf(a.entityId, aTop), topOf(b.entityId, 100), topOf(c.entityId, 300)];

  let startedAt = -1;
  for (let t = 46; t <= 82; t++) {
    const res = s.step(snap(t, allBodies(726)));
    if (eventsOfType(res.events, "DangerCountdownStarted").length > 0) startedAt = t;
  }
  eq(startedAt, 82, "连续越线 36 tick（0.60s）后触发倒计时");
  eq(s.phase, "DangerCountdown", "进入倒计时阶段");
  eq(s.canDrop(90), false, "倒计时期间暂停投放");

  let failedAt = -1;
  for (let t = 83; t <= 262; t++) {
    const res = s.step(snap(t, allBodies(726)));
    if (eventsOfType(res.events, "RunFailed").length > 0) failedAt = t;
  }
  eq(failedAt, 262, "倒计时 180 tick（3s）走完后失败冻结");
  eq(s.phase, "Frozen", "失败后冻结");

  const revive = s.revive(263);
  const removed = eventsOfType(revive.events, "CatsRemovedForRevive")[0]!.entityIds;
  check(
    JSON.stringify(removed) === JSON.stringify([a.entityId, c.entityId]),
    `复活按顶边高度降序移除最高两只（实际 ${removed.join(",")}）`,
  );
  eq(s.phase, "Reviving", "复活后进入恢复等待");
  const resumed = s.step(snap(281, [topOf(b.entityId, 100)]));
  eq(eventsOfType(resumed.events, "RunRevived").length, 1, "0.30s 后恢复对局");
  eq(s.phase, "Playing", "恢复后回到进行中");
  eq(s.aliveEntities.length, 1, "复活后场上剩 1 只");
}

section("危险解除：全部回到线下持续 0.30s");
{
  const s = new GameSession(cfg, { runId: "clear", epoch: 1, seed: 3 });
  const a = dropAndSettle(s, 100, 0);
  const r = radiusOf(s, a.entityId);
  for (let t = 2; t <= 38; t++) s.step(snap(t, [body(a.entityId, 100, 700)]));
  eq(s.phase, "DangerCountdown", "已进入倒计时");
  let clearedAt = -1;
  for (let t = 39; t <= 60; t++) {
    const res = s.step(snap(t, [body(a.entityId, 100, r)]));
    if (eventsOfType(res.events, "DangerCleared").length > 0) clearedAt = t;
  }
  eq(clearedAt, 57, "全部安全持续 18 tick（0.30s）后解除倒计时");
  eq(s.phase, "Playing", "解除后回到进行中");
}

finish("规则单元测试");
