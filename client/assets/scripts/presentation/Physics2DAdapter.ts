import {
  BoxCollider2D,
  CircleCollider2D,
  Color,
  ERigidBody2DType,
  Graphics,
  Node,
  PhysicsSystem2D,
  RigidBody2D,
  Size,
  Sprite,
  SpriteFrame,
  UITransform,
  Vec2,
} from "cc";
import { catByLevel, GameConfig } from "../domain/GameConfig";
import {
  BodySnapshot,
  ContactPair,
  CONTAINER_ID,
  WorldDirective,
  WorldSnapshot,
} from "../domain/Types";

interface CatBodyRecord {
  entityId: number;
  level: number;
  node: Node;
  body: RigidBody2D;
}

/** 2D 物理的像素↔物理单位换算（引擎固定值，见 PhysicsSystem2D 文档）：32px = 1m。 */
const PTM_RATIO = 32;
/** 几何接触判定的容差（px）：两圆间距小于该值视为接触，吸收数值抖动与轻微穿透。 */
const CONTACT_EPS_PX = 2.5;
/** 无精灵时的占位配色（按等级轮换，仅素材缺失时可见）。 */
const FALLBACK_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [233, 133, 125],
  [111, 169, 163],
  [244, 199, 91],
  [160, 190, 220],
  [200, 160, 215],
];

/**
 * 2D 物理适配（表现层，2026-10-23 路线变更：由 Bullet 3D 改为 Box2D 2D）。
 * 把规则层的 WorldDirective 落到 Cocos Physics2D 世界，并把刚体状态喂回 WorldSnapshot，
 * 接口与无头测试替身（tests/HeadlessPhysics）一致，规则层与 GameSession 不感知物理实现。
 *
 * 约定：
 * - 坐标：1lu = 1 设计像素；WorldRoot 原点在容器底部内侧中心，x∈[-320,320] 为容器内腔，
 *   快照 xLu 以容器左内壁为 0、yLu 以容器内底为 0（与规则层一致）。
 * - 猫节点由代码创建：Sprite（按等级取 catSprites）+ CircleCollider2D + RigidBody2D，
 *   碰撞半径严格等于配置 radiusLu，精灵等比缩放贴合直径（果冻拉伸等表现在后续里程碑叠加）。
 * - 容器为三块静态碰撞体（底/左/右），视觉由场景中的藤编猫窝精灵承担，碰撞体本身不可见。
 * - 接触对不依赖物理事件回调，改由快照时按几何距离计算（猫-猫圆距、猫-容器贴边），
 *   每 tick 稳定可复现；这正是 3D 版在编辑器内合并不触发的根治点（事件链不可靠）。
 */
export class Physics2DAdapter {
  private readonly bodies = new Map<number, CatBodyRecord>();

  constructor(
    private readonly cfg: GameConfig,
    private readonly worldRoot: Node,
    private readonly catSprites: readonly (SpriteFrame | null)[],
  ) {}

  private frameFor(level: number): SpriteFrame | null {
    return this.catSprites[level - 1] ?? null;
  }

  /** 给节点装上与等级匹配的猫精灵并缩放至碰撞直径（精灵原始宽高可能非正方，按宽度对齐直径）。 */
  private dressCat(node: Node, level: number): void {
    const diameter = catByLevel(this.cfg, level).radiusLu * 2;
    const frame = this.frameFor(level);
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    if (frame) {
      const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite);
      sprite.spriteFrame = frame;
      const rect = frame.rect;
      transform.setContentSize(rect.width, rect.height);
      const scale = diameter / rect.width;
      node.setScale(scale, scale, 1);
    } else {
      // 素材缺失占位：Graphics 圆（颜色按等级轮换），保证玩法可辨识
      transform.setContentSize(diameter, diameter);
      const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
      const [r, gg, b] = FALLBACK_COLORS[(level - 1) % FALLBACK_COLORS.length]!;
      g.clear();
      g.fillColor = new Color(r, gg, b, 255);
      g.circle(0, 0, diameter / 2);
      g.fill();
      node.setScale(1, 1, 1);
    }
  }

  /** 创建静态容器刚体（底与左右壁），应在首局开始前调用一次。 */
  initStatics(containerRoot: Node): void {
    const halfW = this.cfg.world.containerWidthLu / 2;
    const wallH = 1500;
    const mk = (name: string, size: Size, pos: Vec2): void => {
      const node = new Node(name);
      node.setPosition(pos.x, pos.y, 0);
      const transform = node.addComponent(UITransform);
      transform.setContentSize(size.width, size.height);
      const collider = node.addComponent(BoxCollider2D);
      collider.size = size;
      collider.friction = 0.4;
      collider.restitution = 0;
      const body = node.addComponent(RigidBody2D);
      body.type = ERigidBody2DType.Static;
      containerRoot.addChild(node);
    };
    mk("Floor", new Size(this.cfg.world.containerWidthLu + 120, 60), new Vec2(0, -30));
    mk("WallLeft", new Size(60, wallH), new Vec2(-halfW - 30, wallH / 2));
    mk("WallRight", new Size(60, wallH), new Vec2(halfW + 30, wallH / 2));
  }

  applyDirectives(directives: readonly WorldDirective[]): void {
    for (const d of directives) {
      switch (d.type) {
        case "SpawnBody":
          this.spawnBody(d.entityId, d.level, d.xLu, d.yLu, d.vxLuS, d.vyLuS);
          break;
        case "RemoveBody":
          this.removeBody(d.entityId);
          break;
        case "ZeroVelocity": {
          const rec = this.bodies.get(d.entityId);
          if (rec) {
            rec.body.linearVelocity = new Vec2(0, 0);
            rec.body.angularVelocity = 0;
            rec.body.wakeUp();
          }
          break;
        }
        case "ApplyShockwave":
          this.applyShockwave(d.xLu, d.yLu, d.sourceLevel);
          break;
      }
    }
  }

  private spawnBody(
    entityId: number,
    level: number,
    xLu: number,
    yLu: number,
    vxLuS: number,
    vyLuS: number,
  ): void {
    const cat = catByLevel(this.cfg, level);
    const node = new Node(`Cat_${entityId}`);
    node.setPosition(xLu - this.cfg.world.containerWidthLu / 2, yLu, 0);
    this.dressCat(node, level);
    const collider = node.addComponent(CircleCollider2D);
    collider.radius = cat.radiusLu;
    collider.friction = 0.35;
    collider.restitution = cat.restitution;
    // 密度按 PTM 换算，使刚体质量等于配置 mass：mass = density × π × (r/32)²
    const radiusM = cat.radiusLu / PTM_RATIO;
    collider.density = cat.mass / (Math.PI * radiusM * radiusM);
    const body = node.addComponent(RigidBody2D);
    body.type = ERigidBody2DType.Dynamic;
    body.allowSleep = true;
    body.gravityScale = 1;
    this.worldRoot.addChild(node);
    // 渲染层序：WorldRoot 子节点约定 [BasketBack, 猫…, DangerLine, BasketFront]，猫固定插到 1 号位
    node.setSiblingIndex(1);
    body.linearVelocity = new Vec2(vxLuS, vyLuS);
    body.angularVelocity = 0;
    body.wakeUp();
    this.bodies.set(entityId, { entityId, level, node, body });
  }

  private removeBody(entityId: number): void {
    const rec = this.bodies.get(entityId);
    if (!rec) return;
    this.bodies.delete(entityId);
    rec.node.destroy();
  }

  /** 合成冲击波：与无头替身同一口径（径向、向上分量 30%、危险线以上不向上、单体增量封顶）。 */
  private applyShockwave(xLu: number, yLu: number, sourceLevel: number): void {
    const { shockwaveUpwardKeepRatio, shockwaveMaxDeltaVelocityLuS } = this.cfg.rules;
    const sourceR = catByLevel(this.cfg, sourceLevel).radiusLu;
    const influence = sourceR * 2 + 160;
    for (const rec of this.bodies.values()) {
      const p = rec.node.position;
      const bx = p.x + this.cfg.world.containerWidthLu / 2;
      const by = p.y;
      const r = catByLevel(this.cfg, rec.level).radiusLu;
      const dx = bx - xLu;
      const dy = by - yLu;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > influence + r) continue;
      const falloff = Math.max(0, 1 - dist / (influence + r));
      let dvx = (dx / dist) * falloff * 220;
      let dvy = (dy / dist) * falloff * 220;
      if (dvy > 0) {
        dvy = by + r > this.cfg.world.dangerLineYLu ? 0 : dvy * shockwaveUpwardKeepRatio;
      }
      const mag = Math.hypot(dvx, dvy);
      if (mag > shockwaveMaxDeltaVelocityLuS) {
        dvx = (dvx / mag) * shockwaveMaxDeltaVelocityLuS;
        dvy = (dvy / mag) * shockwaveMaxDeltaVelocityLuS;
      }
      const v = rec.body.linearVelocity;
      rec.body.linearVelocity = new Vec2(v.x + dvx, v.y + dvy);
      rec.body.wakeUp();
    }
  }

  /** 冻结/解冻整个物理世界（局面冻结与复活恢复由 GameBootstrap 按阶段调用）。 */
  setWorldEnabled(enabled: boolean): void {
    PhysicsSystem2D.instance.enable = enabled;
  }

  /** 清空全部猫刚体（重开一局）。静态容器保留。 */
  clearAll(): void {
    for (const rec of [...this.bodies.values()]) {
      rec.node.destroy();
    }
    this.bodies.clear();
  }

  /** 创建纯视觉的预览猫节点（无物理组件），由 GameBootstrap 摆放；等级变化时用 setPreviewLevel 换装。 */
  createPreviewVisual(): Node {
    const node = new Node("PreviewCat");
    node.addComponent(UITransform);
    return node;
  }

  setPreviewLevel(node: Node, level: number): void {
    this.dressCat(node, level);
  }

  nodeOf(entityId: number): Node | null {
    return this.bodies.get(entityId)?.node ?? null;
  }

  snapshot(tick: number): WorldSnapshot {
    const bodies: BodySnapshot[] = [];
    for (const rec of this.bodies.values()) {
      const p = rec.node.position;
      const v = rec.body.linearVelocity;
      bodies.push({
        entityId: rec.entityId,
        xLu: p.x + this.cfg.world.containerWidthLu / 2,
        yLu: p.y,
        vxLuS: v.x,
        vyLuS: v.y,
      });
    }
    bodies.sort((a, b) => a.entityId - b.entityId);
    const contacts: ContactPair[] = [];

    // 猫-容器：底边或侧边贴合即接触（法向相对速度取贴合方向的速度分量）
    for (const b of bodies) {
      const r = catByLevel(this.cfg, this.bodies.get(b.entityId)!.level).radiusLu;
      let rel: number | null = null;
      if (b.yLu - r <= CONTACT_EPS_PX) rel = Math.abs(b.vyLuS);
      if (b.xLu - r <= CONTACT_EPS_PX || b.xLu + r >= this.cfg.world.containerWidthLu - CONTACT_EPS_PX) {
        rel = Math.max(rel ?? 0, Math.abs(b.vxLuS));
      }
      if (rel !== null) contacts.push({ aId: CONTAINER_ID, bId: b.entityId, normalRelSpeedLuS: rel });
    }

    // 猫-猫：圆心距 ≤ 半径和 + 容差
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const ra = catByLevel(this.cfg, this.bodies.get(a.entityId)!.level).radiusLu;
        const rb = catByLevel(this.cfg, this.bodies.get(b.entityId)!.level).radiusLu;
        const dx = b.xLu - a.xLu;
        const dy = b.yLu - a.yLu;
        const dist = Math.hypot(dx, dy);
        if (dist > ra + rb + CONTACT_EPS_PX || dist === 0) continue;
        const rel = Math.abs(((b.vxLuS - a.vxLuS) * dx) / dist + ((b.vyLuS - a.vyLuS) * dy) / dist);
        contacts.push({ aId: a.entityId, bId: b.entityId, normalRelSpeedLuS: rel });
      }
    }
    return { tick, bodies, contacts };
  }
}
