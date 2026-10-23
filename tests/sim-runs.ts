import { GameSession } from "../client/assets/scripts/application/GameSession";
import { Rng } from "../client/assets/scripts/domain/Rng";
import { DomainEvent } from "../client/assets/scripts/domain/Types";
import { HeadlessPhysics } from "./HeadlessPhysics";
import { check, eq, finish, loadConfig, section } from "./TestKit";

const cfg = loadConfig();
const MAX_TICKS = 60 * 150;
const MAX_DROPS = 260;

interface RunDigest {
  score: number;
  drops: number;
  merges: number;
  maxLevel: number;
  alive: number;
  failed: boolean;
  revived: boolean;
  eventHash: number;
}

/**
 * 以随机玩家策略完整模拟一局，逐 tick 校验账本不变量：
 * 实体守恒（投放 + 合成生成 - 合成消费 - 清场 - 复活移除 = 存活）、
 * 分数与事件流水一致、物理体数量与规则层一致、预占不重叠、等级不超过 Lv11。
 */
function runScenario(seed: number): RunDigest {
  const session = new GameSession(cfg, { runId: `sim-${seed}`, epoch: 1, seed });
  const physics = new HeadlessPhysics(cfg);
  const player = new Rng((seed ^ 0x85eb) >>> 0);

  let drops = 0;
  let merges = 0;
  let maxLevel = 0;
  let spawned = 0;
  let consumed = 0;
  let reviveRemoved = 0;
  let scoreLedger = 0;
  let failed = false;
  let revived = false;
  let thinkUntil = 0;
  let eventHash = 0;
  const reservedByTxn = new Map<number, [number, number]>();
  const reservedIds = new Set<number>();

  const mixHash = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      eventHash = (Math.imul(eventHash, 31) + text.charCodeAt(i)) >>> 0;
    }
  };

  const processEvents = (events: DomainEvent[]): void => {
    for (const e of events) {
      mixHash(e.type);
      switch (e.type) {
        case "MergeReserved":
          check(!reservedIds.has(e.aId) && !reservedIds.has(e.bId), `种子 ${seed}：实体被重复预占`);
          reservedIds.add(e.aId);
          reservedIds.add(e.bId);
          reservedByTxn.set(e.txnId, [e.aId, e.bId]);
          break;
        case "MergeCommitted": {
          merges += 1;
          consumed += 2;
          spawned += 1;
          scoreLedger += e.gainedScore;
          maxLevel = Math.max(maxLevel, e.level);
          check(e.level <= 11, `种子 ${seed}：生成了 Lv${e.level}，超过 Lv11`);
          const pair = reservedByTxn.get(e.txnId);
          if (pair) {
            reservedIds.delete(pair[0]);
            reservedIds.delete(pair[1]);
            reservedByTxn.delete(e.txnId);
          }
          break;
        }
        case "TopLevelPairCleared": {
          consumed += 2;
          scoreLedger += e.gainedScore;
          const pair = reservedByTxn.get(e.txnId);
          if (pair) {
            reservedIds.delete(pair[0]);
            reservedIds.delete(pair[1]);
            reservedByTxn.delete(e.txnId);
          }
          break;
        }
        case "FiveComboReached":
          scoreLedger += e.bonusScore;
          break;
        case "CatsRemovedForRevive":
          reviveRemoved += e.entityIds.length;
          break;
        case "RunFailed":
          failed = true;
          // 规则层在冻结时会取消全部未完成合成事务（架构设计第 7 节），脚本记账同步清空
          reservedIds.clear();
          reservedByTxn.clear();
          break;
        default:
          break;
      }
    }
  };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    if (tick >= thinkUntil && drops < MAX_DROPS && session.canDrop(tick)) {
      const alive = session.aliveEntities;
      let x: number;
      if (alive.length > 0 && player.nextFloat() < 0.65) {
        const target = alive[player.nextInt(alive.length)]!;
        const targetBody = physics.bodyOf(target.entityId);
        x = (targetBody ? targetBody.x : 320) + (player.nextFloat() * 80 - 40);
      } else {
        x = 40 + player.nextFloat() * 560;
      }
      const dropped = session.drop(x, tick);
      if (dropped.entityId > 0) {
        drops += 1;
        spawned += 1;
        maxLevel = Math.max(maxLevel, session.entityById(dropped.entityId)!.level);
        physics.applyDirectives(dropped.directives);
        processEvents(dropped.events);
        thinkUntil = tick + Math.floor(player.nextFloat() * 12);
      }
    }

    physics.step();
    const result = session.step(physics.snapshot(tick));
    physics.applyDirectives(result.directives);
    processEvents(result.events);

    check(
      physics.bodyCount === session.aliveEntities.length,
      `种子 ${seed} tick ${tick}：物理体 ${physics.bodyCount} 与规则层存活 ${session.aliveEntities.length} 不一致`,
    );
    check(
      spawned - consumed - reviveRemoved === session.aliveEntities.length,
      `种子 ${seed} tick ${tick}：实体守恒被破坏`,
    );
    check(session.score === scoreLedger, `种子 ${seed} tick ${tick}：分数与事件流水不一致`);

    if (session.phase === "Frozen") {
      if (!revived && player.nextFloat() < 0.5) {
        revived = true;
        const revive = session.revive(tick);
        physics.applyDirectives(revive.directives);
        processEvents(revive.events);
      } else {
        session.settle();
        break;
      }
    }
    if (session.phase === "Settled") break;
  }

  return {
    score: session.score,
    drops,
    merges,
    maxLevel,
    alive: session.aliveEntities.length,
    failed,
    revived,
    eventHash,
  };
}

section("确定性：同种子同输入回放一致");
{
  const first = runScenario(4242);
  const second = runScenario(4242);
  eq(
    JSON.stringify(first),
    JSON.stringify(second),
    "相同种子两局的分数、合成数与事件哈希应完全一致",
  );
  console.log(`  种子 4242：分数 ${first.score}，投放 ${first.drops}，合成 ${first.merges}，最高 Lv${first.maxLevel}`);
}

section("1000 局规则模拟不变量（技术选型 M0 门槛）");
{
  const runs = Number(process.env.SIM_RUNS ?? 1000);
  let totalMerges = 0;
  let failedRuns = 0;
  let globalMaxLevel = 0;
  let totalDrops = 0;
  const startedAt = Date.now();
  for (let i = 0; i < runs; i++) {
    const digest = runScenario(100000 + i);
    totalMerges += digest.merges;
    totalDrops += digest.drops;
    if (digest.failed) failedRuns += 1;
    globalMaxLevel = Math.max(globalMaxLevel, digest.maxLevel);
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `  ${runs} 局模拟完成（${seconds}s）：总投放 ${totalDrops}，总合成 ${totalMerges}，失败局 ${failedRuns}，全局最高 Lv${globalMaxLevel}`,
  );
  check(totalMerges > runs, "平均每局应发生多次合成");
  check(globalMaxLevel >= 6, "模拟应能推进到中高阶猫咪");
}

finish("模拟测试");
