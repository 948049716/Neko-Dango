import {
  BoxCollider,
  Collider,
  ERigidBodyType,
  ICollisionEvent,
  instantiate,
  MeshRenderer,
  Node,
  PhysicsMaterial,
  PhysicsSystem,
  Prefab,
  primitives,
  RigidBody,
  SphereCollider,
  utils,
  Vec3,
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
  body: RigidBody;
  collider: SphereCollider;
}

type ContainerPart = "floor" | "wall";

/** 坐标换算：100lu = 1 引擎单位。lu 原点在容器底部内侧左下角，引擎原点取容器底部中心，玩法平面 Z=0。 */
const LU_PER_EU = 100;

/**
 * Bullet 物理适配（表现层）。把规则层的 WorldDirective 落到 Cocos 物理世界，
 * 并把刚体状态与接触对喂回 WorldSnapshot，接口与无头测试替身（tests/HeadlessPhysics）一致。
 *
 * 约定：
 * - 猫预制体为纯视觉节点：内置球体网格（半径 0.5）即可；碰撞体与刚体由本类在代码中挂载，
 *   球碰撞体局部半径固定 0.5，靠节点缩放（2 × 半径 eu）得到各等级的实际半径。
 * - 静态容器（底 + 左右壁）同样由代码创建，注册为 CONTAINER_ID 伪实体参与首次接触判定。
 * - 轴向锁定走刚体 linearFactor/angularFactor（平移仅 X/Y、旋转仅 Z，见 art/scene-spec.json），
 *   快照前另有 Z 向投影守卫兜底（处理合成生成等瞬移带来的漂移）。
 */
export class BulletPhysicsAdapter {
  private readonly bodies = new Map<number, CatBodyRecord>();
  private readonly colliderOwner = new Map<Collider, number>();
  private readonly containerPart = new Map<Collider, ContainerPart>();
  private readonly touchingPairs = new Set<string>();
  private readonly pairContainerPart = new Map<string, ContainerPart>();
  private readonly materials = new Map<number, PhysicsMaterial>();
  private containerMaterial: PhysicsMaterial | null = null;

  constructor(
    private readonly cfg: GameConfig,
    private readonly worldRoot: Node,
    private readonly catPrefab: Prefab | null,
  ) {}

  private luToEuX(xLu: number): number {
    return (xLu - this.cfg.world.containerWidthLu / 2) / LU_PER_EU;
  }

  private euToLuX(xEu: number): number {
    return xEu * LU_PER_EU + this.cfg.world.containerWidthLu / 2;
  }

  private materialFor(level: number): PhysicsMaterial {
    let m = this.materials.get(level);
    if (!m) {
      m = new PhysicsMaterial();
      m.friction = 0.35;
      m.restitution = catByLevel(this.cfg, level).restitution;
      this.materials.set(level, m);
    }
    return m;
  }

  private materialForContainer(): PhysicsMaterial {
    if (!this.containerMaterial) {
      this.containerMaterial = new PhysicsMaterial();
      this.containerMaterial.friction = 0.4;
      this.containerMaterial.restitution = 0;
    }
    return this.containerMaterial;
  }

  /** 创建静态容器刚体（底与左右壁），应在首局开始前调用一次。 */
  initStatics(containerRoot: Node): void {
    const widthEu = this.cfg.world.containerWidthLu / LU_PER_EU;
    const mk = (name: string, size: Vec3, pos: Vec3, part: ContainerPart): void => {
      const node = new Node(name);
      node.setPosition(pos);
      const col = node.addComponent(BoxCollider);
      col.size = size;
      col.material = this.materialForContainer();
      const body = node.addComponent(RigidBody);
      body.type = ERigidBodyType.STATIC;
      containerRoot.addChild(node);
      this.colliderOwner.set(col, CONTAINER_ID);
      this.containerPart.set(col, part);
      this.registerCollisionEvents(col);
    };
    mk("Floor", new Vec3(widthEu + 2, 0.5, 2), new Vec3(0, -0.25, 0), "floor");
    mk("WallLeft", new Vec3(0.5, 14, 2), new Vec3(-widthEu / 2 - 0.25, 6.75, 0), "wall");
    mk("WallRight", new Vec3(0.5, 14, 2), new Vec3(widthEu / 2 + 0.25, 6.75, 0), "wall");
  }

  private registerCollisionEvents(collider: Collider): void {
    collider.on("onCollisionEnter", this.onContact, this);
    collider.on("onCollisionStay", this.onContact, this);
    collider.on("onCollisionExit", this.onContactExit, this);
  }

  private pairKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  private resolvePair(event: ICollisionEvent): { aId: number; bId: number; key: string } | null {
    const aId = this.colliderOwner.get(event.selfCollider);
    const bId = this.colliderOwner.get(event.otherCollider);
    if (aId === undefined || bId === undefined || aId === bId) return null;
    return { aId, bId, key: this.pairKey(aId, bId) };
  }

  private onContact(event: ICollisionEvent): void {
    const pair = this.resolvePair(event);
    if (!pair) return;
    this.touchingPairs.add(pair.key);
    if (pair.aId === CONTAINER_ID || pair.bId === CONTAINER_ID) {
      const containerCollider =
        pair.aId === CONTAINER_ID ? event.selfCollider : event.otherCollider;
      const part = this.containerPart.get(containerCollider);
      if (part) this.pairContainerPart.set(pair.key, part);
    }
  }

  private onContactExit(event: ICollisionEvent): void {
    const pair = this.resolvePair(event);
    if (!pair) return;
    this.touchingPairs.delete(pair.key);
    this.pairContainerPart.delete(pair.key);
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
            rec.body.setLinearVelocity(new Vec3(0, 0, 0));
            rec.body.setAngularVelocity(new Vec3(0, 0, 0));
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

  private makeFallbackCatNode(entityId: number): Node {
    // 无预制体时的占位节点：内置球体网格 + 由 spawnBody 挂载的物理组件，逻辑可跑通，形象待编辑器补预制体
    const node = new Node(`Cat_${entityId}`);
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = utils.createMesh(primitives.sphere(0.5));
    return node;
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
    const radiusEu = cat.radiusLu / LU_PER_EU;
    const node = this.catPrefab ? instantiate(this.catPrefab) : this.makeFallbackCatNode(entityId);
    node.name = `Cat_${entityId}`;
    node.setScale(new Vec3(radiusEu * 2, radiusEu * 2, radiusEu * 2));
    node.setPosition(this.luToEuX(xLu), yLu / LU_PER_EU, 0);
    const collider = node.getComponent(SphereCollider) ?? node.addComponent(SphereCollider);
    collider.radius = 0.5;
    collider.material = this.materialFor(level);
    const body = node.getComponent(RigidBody) ?? node.addComponent(RigidBody);
    body.type = ERigidBodyType.DYNAMIC;
    body.mass = cat.mass;
    body.allowSleep = true;
    body.useGravity = true;
    body.linearFactor = new Vec3(1, 1, 0);
    body.angularFactor = new Vec3(0, 0, 1);
    this.worldRoot.addChild(node);
    body.setLinearVelocity(new Vec3(vxLuS / LU_PER_EU, vyLuS / LU_PER_EU, 0));
    body.setAngularVelocity(new Vec3(0, 0, 0));
    this.colliderOwner.set(collider, entityId);
    this.registerCollisionEvents(collider);
    this.bodies.set(entityId, { entityId, level, node, body, collider });
  }

  private removeBody(entityId: number): void {
    const rec = this.bodies.get(entityId);
    if (!rec) return;
    this.bodies.delete(entityId);
    this.colliderOwner.delete(rec.collider);
    for (const key of [...this.touchingPairs]) {
      const [a, b] = key.split(":").map(Number) as [number, number];
      if (a === entityId || b === entityId) {
        this.touchingPairs.delete(key);
        this.pairContainerPart.delete(key);
      }
    }
    rec.node.destroy();
  }

  /** 合成冲击波：与无头替身同一口径（径向、向上分量 30%、危险线以上不向上、单体增量封顶）。 */
  private applyShockwave(xLu: number, yLu: number, sourceLevel: number): void {
    const { shockwaveUpwardKeepRatio, shockwaveMaxDeltaVelocityLuS } = this.cfg.rules;
    const sourceR = catByLevel(this.cfg, sourceLevel).radiusLu;
    const influence = sourceR * 2 + 160;
    const vel = new Vec3();
    for (const rec of this.bodies.values()) {
      const p = rec.node.worldPosition;
      const bx = this.euToLuX(p.x);
      const by = p.y * LU_PER_EU;
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
      rec.body.getLinearVelocity(vel);
      rec.body.setLinearVelocity(
        new Vec3(vel.x + dvx / LU_PER_EU, vel.y + dvy / LU_PER_EU, vel.z),
      );
      rec.body.wakeUp();
    }
  }

  /** 冻结/解冻整个物理世界（局面冻结与复活恢复由 GameBootstrap 按阶段调用）。 */
  setWorldEnabled(enabled: boolean): void {
    PhysicsSystem.instance.enable = enabled;
  }

  /** 清空全部猫刚体（重开一局）。静态容器保留。 */
  clearAll(): void {
    for (const rec of [...this.bodies.values()]) {
      this.colliderOwner.delete(rec.collider);
      rec.node.destroy();
    }
    this.bodies.clear();
    this.touchingPairs.clear();
    this.pairContainerPart.clear();
  }

  /** 创建纯视觉的预览猫节点（无物理组件），由 GameBootstrap 摆放与缩放。 */
  createPreviewVisual(): Node {
    const node = this.catPrefab ? instantiate(this.catPrefab) : this.makeFallbackCatNode(0);
    node.name = "PreviewCat";
    const collider = node.getComponent(SphereCollider);
    if (collider) collider.enabled = false;
    const body = node.getComponent(RigidBody);
    if (body) body.enabled = false;
    return node;
  }

  nodeOf(entityId: number): Node | null {
    return this.bodies.get(entityId)?.node ?? null;
  }

  snapshot(tick: number): WorldSnapshot {
    const bodies: BodySnapshot[] = [];
    const velById = new Map<number, { vx: number; vy: number }>();
    const vel = new Vec3();
    for (const rec of this.bodies.values()) {
      const p = rec.node.worldPosition;
      const px = p.x;
      const py = p.y;
      const pz = p.z;
      rec.body.getLinearVelocity(vel);
      if (Math.abs(pz) > 0.02) {
        rec.node.setWorldPosition(px, py, 0);
        rec.body.setLinearVelocity(new Vec3(vel.x, vel.y, 0));
      }
      const vxLu = vel.x * LU_PER_EU;
      const vyLu = vel.y * LU_PER_EU;
      velById.set(rec.entityId, { vx: vxLu, vy: vyLu });
      bodies.push({
        entityId: rec.entityId,
        xLu: this.euToLuX(px),
        yLu: py * LU_PER_EU,
        vxLuS: vxLu,
        vyLuS: vyLu,
      });
    }
    bodies.sort((a, b) => a.entityId - b.entityId);
    const posById = new Map(bodies.map((b) => [b.entityId, b]));
    const contacts: ContactPair[] = [];
    for (const key of this.touchingPairs) {
      const [aId, bId] = key.split(":").map(Number) as [number, number];
      let rel = 0;
      if (aId === CONTAINER_ID || bId === CONTAINER_ID) {
        const catId = aId === CONTAINER_ID ? bId : aId;
        const v = velById.get(catId);
        if (!v) continue;
        rel = this.pairContainerPart.get(key) === "wall" ? Math.abs(v.vx) : Math.abs(v.vy);
      } else {
        const pa = posById.get(aId);
        const pb = posById.get(bId);
        const va = velById.get(aId);
        const vb = velById.get(bId);
        if (!pa || !pb || !va || !vb) continue;
        const dx = pb.xLu - pa.xLu;
        const dy = pb.yLu - pa.yLu;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          rel = Math.abs(((vb.vx - va.vx) * dx) / dist + ((vb.vy - va.vy) * dy) / dist);
        }
      }
      contacts.push({ aId, bId, normalRelSpeedLuS: rel });
    }
    return { tick, bodies, contacts };
  }
}
