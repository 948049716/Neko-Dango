import { _decorator, Component, EventMouse, EventTouch, Node, UITransform, Vec2, Vec3 } from "cc";

const { ccclass } = _decorator;

/**
 * 输入视图（表现层）：挂在 Canvas 上，把触摸/鼠标位置换算成设计分辨率坐标
 * （原点在左上角，x ∈ [0, 设计宽]）上抛给 GameBootstrap；释放即投放。
 * 相机偏航（scene-spec 的 ±16°）属 M2 表现，本组件先只处理瞄准与投放。
 */
@ccclass("InputView")
export class InputView extends Component {
  /** 瞄准位置变化，参数为设计坐标 x。 */
  onAim: ((designX: number) => void) | null = null;
  /** 释放（投放）信号。 */
  onRelease: (() => void) | null = null;

  private uiTransform: UITransform | null = null;

  onLoad(): void {
    this.uiTransform = this.getComponent(UITransform);
    this.node.on(Node.EventType.TOUCH_START, this.handleTouchAim, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.handleTouchAim, this);
    this.node.on(Node.EventType.TOUCH_END, this.handleTouchRelease, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.handleTouchRelease, this);
    this.node.on(Node.EventType.MOUSE_MOVE, this.handleMouseAim, this);
    this.node.on(Node.EventType.MOUSE_UP, this.handleMouseRelease, this);
  }

  private emitAim(uiLocation: Vec2): void {
    if (!this.uiTransform) return;
    const local = this.uiTransform.convertToNodeSpaceAR(new Vec3(uiLocation.x, uiLocation.y, 0));
    const designX = local.x + this.uiTransform.contentSize.width / 2;
    this.onAim?.(designX);
  }

  private handleTouchAim(event: EventTouch): void {
    this.emitAim(event.getUILocation());
  }

  private handleMouseAim(event: EventMouse): void {
    this.emitAim(event.getUILocation());
  }

  private handleTouchRelease(event: EventTouch): void {
    this.emitAim(event.getUILocation());
    this.onRelease?.();
  }

  private handleMouseRelease(event: EventMouse): void {
    this.emitAim(event.getUILocation());
    this.onRelease?.();
  }
}
