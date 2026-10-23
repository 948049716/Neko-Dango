/** 可复现的种子随机源（mulberry32）。规则层禁止使用 Math.random，所有随机都经此注入。 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 返回 [0, 1) 的浮点数，并推进状态。 */
  nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [0, maxExclusive) 的整数。 */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /** 按权重抽取下标，权重为正数数组。 */
  pickWeighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.nextFloat() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  /** 当前内部状态，用于存档与回放校验。 */
  snapshotState(): number {
    return this.state;
  }

  restoreState(state: number): void {
    this.state = state >>> 0;
  }
}
