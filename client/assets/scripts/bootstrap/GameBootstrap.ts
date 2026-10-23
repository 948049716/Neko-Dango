import { _decorator, Component, JsonAsset, Node, PhysicsSystem2D, SpriteFrame, sys, Vec2 } from "cc";
import { GameSession } from "../application/GameSession";
import { catByLevel, GameConfig, validateConfig } from "../domain/GameConfig";
import { DomainEvent } from "../domain/Types";
import { Physics2DAdapter } from "../presentation/Physics2DAdapter";
import { HudView } from "../presentation/HudView";
import { InputView } from "../presentation/InputView";

const { ccclass, property } = _decorator;

const TUTORIAL_FLAG_KEY = "neko-dango.tutorial-done";
/** 设计分辨率宽（与 settings/v2/packages/project.json 的 designResolution 一致），用于把输入设计坐标换算为 lu。 */
const DESIGN_WIDTH = 750;

/**
 * 游戏引导（装配层）：解析配置、创建 GameSession 与 2D 物理适配，
 * 以固定步进在 lateUpdate 中推进规则，并接线输入、HUD 与预览猫。
 * 局面冻结时停用物理世界，复活恢复（RunRevived）到达后再启用。
 * 2026-10-23 路线变更：物理由 Bullet 3D 改为 Physics2D（Box2D），规则层不变。
 */
@ccclass("GameBootstrap")
export class GameBootstrap extends Component {
  @property(JsonAsset)
  configAsset: JsonAsset | null = null;

  @property(Node)
  worldRoot: Node | null = null;

  @property(Node)
  containerRoot: Node | null = null;

  /** 11 阶猫精灵（下标 0 = Lv1），由场景生成器预绑定；缺失时适配层用彩色圆占位。 */
  @property([SpriteFrame])
  catSprites: SpriteFrame[] = [];

  @property(HudView)
  hud: HudView | null = null;

  @property(InputView)
  input: InputView | null = null;

  private cfg: GameConfig | null = null;
  private session: GameSession | null = null;
  private adapter: Physics2DAdapter | null = null;
  private previewNode: Node | null = null;

  private tickNo = 0;
  private accumulator = 0;
  private epoch = 0;
  private aimLuX = 0;
  private dangerDeadlineTick = -1;
  private lastCombo = 0;
  private lastComboTick = -9999;
  private maxLevelEver = 0;
  private reviveUsed = false;
  private previewLevelShown = 0;

  start(): void {
    if (!this.configAsset || !this.worldRoot || !this.containerRoot) {
      console.error("[GameBootstrap] 场景绑定缺失：需要 configAsset / worldRoot / containerRoot");
      this.enabled = false;
      return;
    }
    const cfg = this.configAsset.json as GameConfig;
    const problems = validateConfig(cfg);
    if (problems.length > 0) {
      console.error(`[GameBootstrap] 配置校验未通过：${problems.join("；")}`);
      this.enabled = false;
      return;
    }
    this.cfg = cfg;
    this.aimLuX = cfg.world.containerWidthLu / 2;

    const physics = PhysicsSystem2D.instance;
    physics.enable = true;
    // 世界单位 = 设计像素：重力沿用无头灰盒调参 2600 lu/s²（= 2600 px/s²），手感调优后可独立调整
    physics.gravity = new Vec2(0, -cfg.headlessSim.gravityLuS2);
    physics.fixedTimeStep = 1 / cfg.tickRate;
    physics.maxSubSteps = 3;

    this.adapter = new Physics2DAdapter(cfg, this.worldRoot, this.catSprites);
    this.adapter.initStatics(this.containerRoot);

    this.previewNode = this.adapter.createPreviewVisual();
    this.worldRoot.addChild(this.previewNode);
    this.previewNode.setSiblingIndex(1); // 与猫同层（BasketBack 之上、猫窝前景之下）

    if (this.input) {
      this.input.onAim = (designX) => {
        const margin = (DESIGN_WIDTH - cfg.world.containerWidthLu) / 2;
        this.aimLuX = designX - margin;
      };
      this.input.onRelease = () => this.tryDrop();
    }
    if (this.hud) {
      this.hud.onRevive = () => this.doRevive();
      this.hud.onSettle = () => this.doSettle();
      this.hud.onRestart = () => this.newRun();
    }
    this.newRun();
  }

  lateUpdate(dt: number): void {
    if (!this.cfg || !this.session || !this.adapter) return;
    const step = 1 / this.cfg.tickRate;
    this.accumulator += Math.min(dt, 0.1);
    let guard = 0;
    while (this.accumulator >= step && guard < 3) {
      this.accumulator -= step;
      guard += 1;
      this.tickNo += 1;
      const snapshot = this.adapter.snapshot(this.tickNo);
      const result = this.session.step(snapshot);
      this.adapter.applyDirectives(result.directives);
      this.handleEvents(result.events);
    }
    this.refreshHud();
    this.updatePreview();
  }

  private newRun(): void {
    if (!this.cfg || !this.adapter) return;
    this.adapter.clearAll();
    this.adapter.setWorldEnabled(true);
    this.epoch += 1;
    const tutorial = sys.localStorage.getItem(TUTORIAL_FLAG_KEY) !== "1";
    this.session = new GameSession(this.cfg, {
      runId: `run-${Date.now()}`,
      epoch: this.epoch,
      seed: Date.now() % 2147483647,
      tutorial,
    });
    this.tickNo = 0;
    this.accumulator = 0;
    this.dangerDeadlineTick = -1;
    this.lastCombo = 0;
    this.lastComboTick = -9999;
    this.maxLevelEver = 0;
    this.reviveUsed = false;
    this.previewLevelShown = 0;
    this.hud?.hideResult();
    this.hud?.setScore(0);
    this.hud?.setCombo(0);
    this.hud?.setDangerSeconds(null);
  }

  private tryDrop(): void {
    if (!this.session || !this.adapter) return;
    if (!this.session.canDrop(this.tickNo)) return;
    const result = this.session.drop(this.aimLuX, this.tickNo);
    if (result.entityId <= 0) return;
    this.adapter.applyDirectives(result.directives);
    this.handleEvents(result.events);
    sys.localStorage.setItem(TUTORIAL_FLAG_KEY, "1");
  }

  private doRevive(): void {
    if (!this.session || !this.adapter) return;
    const result = this.session.revive(this.session.currentTick);
    this.adapter.applyDirectives(result.directives);
    this.handleEvents(result.events);
  }

  private doSettle(): void {
    if (!this.session || !this.hud || !this.cfg) return;
    this.session.settle();
    this.hud.showResult({
      title: "本局结算",
      score: this.session.score,
      detail: this.maxLevelDetail(),
      canRevive: false,
    });
  }

  private maxLevelDetail(): string {
    if (!this.cfg || this.maxLevelEver <= 0) return "还没有合成记录";
    const cat = catByLevel(this.cfg, this.maxLevelEver);
    return `最高合成 Lv${this.maxLevelEver} ${cat.name}`;
  }

  private handleEvents(events: DomainEvent[]): void {
    const cfg = this.cfg;
    if (!cfg || !this.session || !this.adapter || !this.hud) return;
    for (const e of events) {
      switch (e.type) {
        case "MergeCommitted":
          this.lastCombo = e.combo;
          this.lastComboTick = e.tick;
          this.maxLevelEver = Math.max(this.maxLevelEver, e.level);
          break;
        case "DangerCountdownStarted":
          this.dangerDeadlineTick = e.deadlineTick;
          break;
        case "DangerCleared":
          this.dangerDeadlineTick = -1;
          break;
        case "RunFailed":
          this.adapter.setWorldEnabled(false);
          this.hud.showResult({
            title: "猫窝溢出啦！",
            score: this.session.score,
            detail: this.maxLevelDetail(),
            canRevive: !this.reviveUsed,
          });
          break;
        case "CatsRemovedForRevive":
          this.reviveUsed = true;
          this.hud.hideResult();
          break;
        case "RunRevived":
          this.adapter.setWorldEnabled(true);
          this.dangerDeadlineTick = -1;
          break;
        default:
          // CatFirstContact / MergeReserved 等事件的表现钩子（果冻、音效）后续接入
          break;
      }
    }
  }

  private refreshHud(): void {
    if (!this.cfg || !this.session || !this.hud) return;
    this.hud.setScore(this.session.score);
    const comboVisible =
      this.lastCombo >= 2 &&
      this.tickNo - this.lastComboTick <= this.cfg.rules.comboWindowTicks;
    this.hud.setCombo(comboVisible ? this.lastCombo : 0);
    const next = this.session.preview.next;
    this.hud.setNext(next.level, next.lucky);
    this.hud.setDangerSeconds(
      this.dangerDeadlineTick >= 0
        ? Math.max(0, Math.ceil((this.dangerDeadlineTick - this.tickNo) / this.cfg.tickRate))
        : null,
    );
  }

  private updatePreview(): void {
    if (!this.cfg || !this.session || !this.previewNode || !this.adapter) return;
    const active = this.session.phase === "Playing";
    this.previewNode.active = active;
    if (!active) return;
    const level = this.session.preview.current.level;
    if (level !== this.previewLevelShown) {
      this.previewLevelShown = level;
      this.adapter.setPreviewLevel(this.previewNode, level);
    }
    const clampedX = Math.min(Math.max(this.aimLuX, 0), this.cfg.world.containerWidthLu);
    this.previewNode.setPosition(
      clampedX - this.cfg.world.containerWidthLu / 2,
      this.cfg.headlessSim.spawnYLu,
      0,
    );
  }
}
