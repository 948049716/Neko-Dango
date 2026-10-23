import { GameConfig, MAX_LEVEL } from "./GameConfig";
import { ContactPair } from "./Types";

export interface MergeTxn {
  txnId: number;
  aId: number;
  bId: number;
  level: number;
  reservedTick: number;
  commitTick: number;
}

interface ContactTrack {
  sinceTick: number;
  lastTick: number;
}

function pairKey(aId: number, bId: number): string {
  return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
}

/**
 * 合成事务协调（主策划 2.1 第 3 条与架构设计第 7 节）。
 * 候选条件：同等级、双方均可结算、连续接触满 50ms（3 tick）、法向相对速度 < 80lu/s。
 * 候选按实体 ID 稳定排序后贪心预占互不相交的实体对，任一实体同时只属于一个未完成事务。
 * 普通合成在预占后 27 tick 提交，双 Lv11 在 36 tick 提交且不生成 Lv12。
 */
export class MergeCoordinator {
  private contacts = new Map<string, ContactTrack>();
  private txns = new Map<number, MergeTxn>();
  private nextTxnId = 1;

  constructor(private readonly cfg: GameConfig) {}

  get pendingCount(): number {
    return this.txns.size;
  }

  isReserved(entityId: number): boolean {
    for (const txn of this.txns.values()) {
      if (txn.aId === entityId || txn.bId === entityId) return true;
    }
    return false;
  }

  /** 每 tick 喂入接触对，维护连续接触计时；未在本 tick 出现的接触对视为中断并清零。 */
  updateContacts(tick: number, pairs: readonly ContactPair[]): void {
    const seen = new Set<string>();
    for (const pair of pairs) {
      if (pair.aId === pair.bId) continue;
      const key = pairKey(pair.aId, pair.bId);
      seen.add(key);
      const track = this.contacts.get(key);
      if (track && track.lastTick === tick - 1) {
        track.lastTick = tick;
      } else {
        this.contacts.set(key, { sinceTick: tick, lastTick: tick });
      }
    }
    for (const key of [...this.contacts.keys()]) {
      if (!seen.has(key)) this.contacts.delete(key);
    }
  }

  /**
   * 挑选本 tick 可预占的合成对。
   * isEligible 判断实体是否处于可结算且未被预占的状态，levelOf 返回实体等级。
   */
  findCandidates(
    tick: number,
    pairs: readonly ContactPair[],
    isEligible: (entityId: number) => boolean,
    levelOf: (entityId: number) => number,
  ): Array<{ aId: number; bId: number; level: number }> {
    const speedByKey = new Map<string, number>();
    for (const pair of pairs) {
      if (pair.aId === pair.bId) continue;
      speedByKey.set(pairKey(pair.aId, pair.bId), pair.normalRelSpeedLuS);
    }
    const sortedPairs = [...speedByKey.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const used = new Set<number>();
    const result: Array<{ aId: number; bId: number; level: number }> = [];
    for (const [key, speed] of sortedPairs) {
      const track = this.contacts.get(key);
      if (!track) continue;
      if (tick - track.sinceTick + 1 < this.cfg.rules.mergeContactTicks) continue;
      if (speed >= this.cfg.rules.mergeMaxNormalSpeedLuS) continue;
      const [aId, bId] = key.split(":").map(Number) as [number, number];
      if (used.has(aId) || used.has(bId)) continue;
      if (!isEligible(aId) || !isEligible(bId)) continue;
      const level = levelOf(aId);
      if (level !== levelOf(bId) || level > MAX_LEVEL) continue;
      used.add(aId);
      used.add(bId);
      result.push({ aId, bId, level });
    }
    return result;
  }

  /** 预占一对实体并登记事务，返回提交 tick。 */
  reserve(tick: number, aId: number, bId: number, level: number): MergeTxn {
    const commitTicks =
      level >= MAX_LEVEL ? this.cfg.rules.dualTopLevelCommitTicks : this.cfg.rules.mergeCommitTicks;
    const txn: MergeTxn = {
      txnId: this.nextTxnId++,
      aId,
      bId,
      level,
      reservedTick: tick,
      commitTick: tick + commitTicks,
    };
    this.txns.set(txn.txnId, txn);
    return txn;
  }

  /** 取出本 tick 到期的事务（提交后即从未完成集合移除）。 */
  collectDue(tick: number): MergeTxn[] {
    const due: MergeTxn[] = [];
    for (const txn of this.txns.values()) {
      if (tick >= txn.commitTick) due.push(txn);
    }
    due.sort((x, y) => x.txnId - y.txnId);
    for (const txn of due) this.txns.delete(txn.txnId);
    return due;
  }

  /** 局面冻结或重开时取消全部未完成事务。 */
  cancelAll(): void {
    this.txns.clear();
    this.contacts.clear();
  }
}
