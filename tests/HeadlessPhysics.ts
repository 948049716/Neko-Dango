import { catByLevel, GameConfig } from "../client/assets/scripts/domain/GameConfig";
import {
  BodySnapshot,
  ContactPair,
  CONTAINER_ID,
  WorldDirective,
  WorldSnapshot,
} from "../client/assets/scripts/domain/Types";

interface SimBody {
  entityId: number;
  level: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  e: number;
  touching: boolean;
}

const MAX_SPEED_LU_S = 1600;

/**
 * 无头灰盒物理替身，仅用于规则验证（正式物理为 Cocos 内 Bullet，见 docs/技术选型.md）。
 * 确定性二维圆物理：重力、容器底/壁、圆圆碰撞（冲量 + 位置修正 + 切向摩擦），
 * 按实体 ID 与 X 坐标的固定顺序求解，相同输入必得相同结果。
 */
export class HeadlessPhysics {
  private bodies = new Map<number, SimBody>();

  constructor(private readonly cfg: GameConfig) {}

  get bodyCount(): number {
    return this.bodies.size;
  }

  bodyOf(entityId: number): SimBody | undefined {
    return this.bodies.get(entityId);
  }

  applyDirectives(directives: readonly WorldDirective[]): void {
    for (const d of directives) {
      switch (d.type) {
        case "SpawnBody": {
          const cat = catByLevel(this.cfg, d.level);
          this.bodies.set(d.entityId, {
            entityId: d.entityId,
            level: d.level,
            x: d.xLu,
            y: d.yLu,
            vx: d.vxLuS,
            vy: d.vyLuS,
            r: cat.radiusLu,
            m: cat.mass,
            e: cat.restitution,
            touching: false,
          });
          break;
        }
        case "RemoveBody":
          this.bodies.delete(d.entityId);
          break;
        case "ZeroVelocity": {
          const b = this.bodies.get(d.entityId);
          if (b) {
            b.vx = 0;
            b.vy = 0;
          }
          break;
        }
        case "ApplyShockwave":
          this.applyShockwave(d.xLu, d.yLu, d.sourceLevel);
          break;
      }
    }
  }

  /** 合成冲击波：径向推力，向上分量衰减至 30%，危险线以上对象不接受向上冲量，单体增量封顶。 */
  private applyShockwave(x: number, y: number, sourceLevel: number): void {
    const { shockwaveUpwardKeepRatio, shockwaveMaxDeltaVelocityLuS } = this.cfg.rules;
    const sourceR = catByLevel(this.cfg, sourceLevel).radiusLu;
    const influence = sourceR * 2 + 160;
    for (const b of this.bodies.values()) {
      const dx = b.x - x;
      const dy = b.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > influence + b.r) continue;
      const falloff = Math.max(0, 1 - dist / (influence + b.r));
      let dvx = (dx / dist) * falloff * 220;
      let dvy = (dy / dist) * falloff * 220;
      if (dvy > 0) {
        const top = b.y + b.r;
        dvy = top > this.cfg.world.dangerLineYLu ? 0 : dvy * shockwaveUpwardKeepRatio;
      }
      const mag = Math.hypot(dvx, dvy);
      if (mag > shockwaveMaxDeltaVelocityLuS) {
        dvx = (dvx / mag) * shockwaveMaxDeltaVelocityLuS;
        dvy = (dvy / mag) * shockwaveMaxDeltaVelocityLuS;
      }
      b.vx += dvx;
      b.vy += dvy;
    }
  }

  /** 推进一个逻辑 tick（内部按配置子步进）。 */
  step(): void {
    const { gravityLuS2, substeps, restVelocityLuS } = this.cfg.headlessSim;
    const dt = 1 / this.cfg.tickRate / substeps;
    const width = this.cfg.world.containerWidthLu;
    for (let s = 0; s < substeps; s++) {
      const arr = [...this.bodies.values()].sort((a, b) => a.entityId - b.entityId);
      for (const b of arr) {
        b.touching = false;
        b.vy -= gravityLuS2 * dt;
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > MAX_SPEED_LU_S) {
          b.vx = (b.vx / speed) * MAX_SPEED_LU_S;
          b.vy = (b.vy / speed) * MAX_SPEED_LU_S;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        // 容器底
        if (b.y < b.r) {
          b.y = b.r;
          if (b.vy < 0) b.vy = Math.abs(b.vy) > 30 ? -b.vy * b.e : 0;
          b.vx *= 0.98;
          b.touching = true;
        }
        // 左右壁
        if (b.x < b.r) {
          b.x = b.r;
          if (b.vx < 0) b.vx = Math.abs(b.vx) > 30 ? -b.vx * b.e : 0;
          b.touching = true;
        } else if (b.x > width - b.r) {
          b.x = width - b.r;
          if (b.vx > 0) b.vx = Math.abs(b.vx) > 30 ? -b.vx * b.e : 0;
          b.touching = true;
        }
      }
      // 圆圆碰撞：按 X 排序扫掠剪枝
      const byX = [...arr].sort((a, b) => a.x - b.x || a.entityId - b.entityId);
      for (let i = 0; i < byX.length; i++) {
        const a = byX[i]!;
        for (let j = i + 1; j < byX.length; j++) {
          const b = byX[j]!;
          if (b.x - a.x > a.r + b.r) break;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDist = a.r + b.r;
          const distSq = dx * dx + dy * dy;
          if (distSq >= minDist * minDist || distSq === 0) continue;
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          const invA = 1 / a.m;
          const invB = 1 / b.m;
          const invSum = invA + invB;
          const corr = Math.max(0, overlap - 0.5) * 0.8;
          a.x -= nx * corr * (invA / invSum);
          a.y -= ny * corr * (invA / invSum);
          b.x += nx * corr * (invB / invSum);
          b.y += ny * corr * (invB / invSum);
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const e = Math.min(a.e, b.e);
            const jimp = (-(1 + e) * vn) / invSum;
            a.vx -= jimp * nx * invA;
            a.vy -= jimp * ny * invA;
            b.vx += jimp * nx * invB;
            b.vy += jimp * ny * invB;
            // 切向摩擦
            const tx = -ny;
            const ty = nx;
            const vt = rvx * tx + rvy * ty;
            const fimp = (vt * 0.08) / invSum;
            a.vx += fimp * tx * invA;
            a.vy += fimp * ty * invA;
            b.vx -= fimp * tx * invB;
            b.vy -= fimp * ty * invB;
          }
          a.touching = true;
          b.touching = true;
        }
      }
      // 静止阻尼：接触中且低速时快速衰减，帮助堆叠稳定
      for (const b of arr) {
        if (b.touching && Math.hypot(b.vx, b.vy) < restVelocityLuS) {
          b.vx *= 0.8;
          b.vy *= 0.8;
        }
      }
    }
  }

  /** 生成本 tick 的规则层快照：刚体列表与接触对（几何判定，含与容器底的接触）。 */
  snapshot(tick: number): WorldSnapshot {
    const arr = [...this.bodies.values()].sort((a, b) => a.entityId - b.entityId);
    const bodies: BodySnapshot[] = arr.map((b) => ({
      entityId: b.entityId,
      xLu: b.x,
      yLu: b.y,
      vxLuS: b.vx,
      vyLuS: b.vy,
    }));
    const contacts: ContactPair[] = [];
    for (const b of arr) {
      if (b.y - b.r <= 1.0) {
        contacts.push({ aId: b.entityId, bId: CONTAINER_ID, normalRelSpeedLuS: Math.abs(b.vy) });
      }
    }
    const byX = [...arr].sort((a, b) => a.x - b.x || a.entityId - b.entityId);
    for (let i = 0; i < byX.length; i++) {
      const a = byX[i]!;
      for (let j = i + 1; j < byX.length; j++) {
        const b = byX[j]!;
        if (b.x - a.x > a.r + b.r + 1) break;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist > a.r + b.r + 1 || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const rel = Math.abs((b.vx - a.vx) * nx + (b.vy - a.vy) * ny);
        contacts.push({ aId: a.entityId, bId: b.entityId, normalRelSpeedLuS: rel });
      }
    }
    return { tick, bodies, contacts };
  }
}
