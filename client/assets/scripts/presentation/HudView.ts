import { _decorator, Button, Component, Label, Node } from "cc";

const { ccclass, property } = _decorator;

export interface ResultViewModel {
  title: string;
  score: number;
  detail: string;
  canRevive: boolean;
}

/**
 * HUD 视图（表现层）：只负责把 GameBootstrap 给的状态写到界面节点上，
 * 按钮点击通过回调上抛，不持有任何规则状态。节点绑定在场景中完成（见 Game 场景）。
 */
@ccclass("HudView")
export class HudView extends Component {
  @property(Label)
  scoreLabel: Label | null = null;

  @property(Label)
  comboLabel: Label | null = null;

  @property(Label)
  nextLabel: Label | null = null;

  @property(Label)
  dangerLabel: Label | null = null;

  @property(Node)
  overlay: Node | null = null;

  @property(Label)
  resultTitle: Label | null = null;

  @property(Label)
  resultScore: Label | null = null;

  @property(Label)
  resultDetail: Label | null = null;

  @property(Button)
  reviveButton: Button | null = null;

  @property(Button)
  settleButton: Button | null = null;

  @property(Button)
  restartButton: Button | null = null;

  onRevive: (() => void) | null = null;
  onSettle: (() => void) | null = null;
  onRestart: (() => void) | null = null;

  onLoad(): void {
    this.reviveButton?.node.on("click", () => this.onRevive?.());
    this.settleButton?.node.on("click", () => this.onSettle?.());
    this.restartButton?.node.on("click", () => this.onRestart?.());
    if (this.overlay) this.overlay.active = false;
  }

  setScore(score: number): void {
    if (this.scoreLabel) this.scoreLabel.string = `分数 ${score}`;
  }

  setCombo(combo: number): void {
    if (this.comboLabel) this.comboLabel.string = combo >= 2 ? `${combo} 连击` : "";
  }

  setNext(level: number, lucky: boolean): void {
    if (this.nextLabel) {
      this.nextLabel.string = lucky ? `Lv${level} · 幸运!` : `Lv${level}`;
    }
  }

  /** 危险倒计时秒数；null 表示无倒计时。 */
  setDangerSeconds(seconds: number | null): void {
    if (this.dangerLabel) {
      this.dangerLabel.string = seconds === null ? "" : `${seconds}`;
    }
  }

  showResult(vm: ResultViewModel): void {
    if (this.resultTitle) this.resultTitle.string = vm.title;
    if (this.resultScore) this.resultScore.string = `${vm.score} 分`;
    if (this.resultDetail) this.resultDetail.string = vm.detail;
    if (this.reviveButton) this.reviveButton.node.active = vm.canRevive;
    if (this.settleButton) this.settleButton.node.active = vm.canRevive;
    if (this.overlay) this.overlay.active = true;
  }

  hideResult(): void {
    if (this.overlay) this.overlay.active = false;
  }
}
