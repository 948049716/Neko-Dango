import { GameSession } from "../client/assets/scripts/application/GameSession";
import { catByLevel, GameConfig } from "../client/assets/scripts/domain/GameConfig";
import { Rng } from "../client/assets/scripts/domain/Rng";
import { DomainEvent } from "../client/assets/scripts/domain/Types";
import { HeadlessPhysics } from "../tests/HeadlessPhysics";
import cfgJson from "../client/assets/configs/game-config.json";

const cfg = cfgJson as unknown as GameConfig;

// ---------- 画布与布局（设计画布 750×1334，1lu = 1 设计像素） ----------
const W = 750;
const H = 1334;
const X0 = 55; // 容器内侧左边缘
const CW = cfg.world.containerWidthLu; // 640
const BY = 1150; // 容器内侧底部
const DANGER_Y = BY - cfg.world.dangerLineYLu; // 490
const SPAWN_SCREEN_Y = BY - cfg.headlessSim.spawnYLu;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
ctx.scale(2, 2); // 画布后备分辨率 1500×2668，逻辑坐标 750×1334

const COLORS = {
  cream: "#FFF9EF",
  ink: "#5A4038",
  coral: "#E9857D",
  coralDark: "#D64541",
  honey: "#C98A46",
  gold: "#F4C75B",
  mint: "#6FA9A3",
};

// ---------- 猫咪配色（按四视图近似，正式美术以 3D 模型为准） ----------
const CAT_BODY: Record<number, string> = {
  1: "#F6C7D8",
  2: "#FBF8F2",
  3: "#F1DFC8",
  4: "#FCFAF5",
  5: "#B7BEC7",
  6: "#EFE0C8",
  7: "#403A3E",
  8: "#93A9BF",
  9: "#F0A04B",
  10: "#FAF5EC",
  11: "#F2B63D",
};

interface Visual {
  s: number; // 果冻缩放（Y 向），X 向按 1/sqrt(s) 补偿
  v: number;
}
const visuals = new Map<number, Visual>();

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: string;
}
interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
  size: number;
}
const particles: Particle[] = [];
const floaters: Floater[] = [];

// ---------- 对局状态 ----------
let session: GameSession;
let physics: HeadlessPhysics;
let tickNo = 0;
let aimGameX = CW / 2;
let deadlineTick = -1;
let reviveAvailable = false;
let maxLevel = 0;
let lastCombo = 0;
let lastComboTick = -999;
let auto = false;
const autoRng = new Rng(20261023);
const fxRng = new Rng(777);

function newRun(seed: number): void {
  session = new GameSession(cfg, { runId: "preview", epoch: 1, seed });
  physics = new HeadlessPhysics(cfg);
  tickNo = 0;
  deadlineTick = -1;
  reviveAvailable = false;
  maxLevel = 0;
  lastCombo = 0;
  visuals.clear();
  particles.length = 0;
  floaters.length = 0;
}
newRun(20261023);

function handleEvents(events: DomainEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "CatFirstContact": {
        const vis = visuals.get(e.entityId);
        if (vis) vis.v -= 5.2;
        break;
      }
      case "MergeCommitted": {
        maxLevel = Math.max(maxLevel, e.level);
        lastCombo = e.combo;
        lastComboTick = e.tick;
        const sx = X0 + e.xLu;
        const sy = BY - e.yLu;
        for (let i = 0; i < 12; i++) {
          const ang = fxRng.nextFloat() * Math.PI * 2;
          const spd = 60 + fxRng.nextFloat() * 190;
          particles.push({
            x: sx,
            y: sy,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 60,
            life: 0,
            maxLife: 0.55 + fxRng.nextFloat() * 0.3,
            r: 4 + fxRng.nextFloat() * 6,
            color: [COLORS.gold, COLORS.coral, "#FFD9E8", "#BFE3DE"][fxRng.nextInt(4)]!,
          });
        }
        floaters.push({
          x: sx,
          y: sy - 10,
          text: `+${e.gainedScore}`,
          life: 0,
          color: COLORS.ink,
          size: e.combo >= 3 ? 44 : 34,
        });
        if (e.combo >= 2) {
          floaters.push({
            x: sx,
            y: sy - 58,
            text: `${e.combo} 连击!`,
            life: 0,
            color: COLORS.coralDark,
            size: 30,
          });
        }
        break;
      }
      case "TopLevelPairCleared":
        floaters.push({
          x: W / 2,
          y: 420,
          text: `满窝团圆 +${e.gainedScore}`,
          life: 0,
          color: "#B97F16",
          size: 46,
        });
        break;
      case "FiveComboReached":
        floaters.push({
          x: W / 2,
          y: 360,
          text: e.reward === "RainbowBall" ? "5 连击！获得魔法彩虹球" : "5 连击！+200 分",
          life: 0,
          color: COLORS.coralDark,
          size: 32,
        });
        break;
      case "DangerCountdownStarted":
        deadlineTick = e.deadlineTick;
        break;
      case "DangerCleared":
        deadlineTick = -1;
        break;
      case "RunFailed":
        deadlineTick = -1;
        reviveAvailable = true;
        break;
      case "CatsRemovedForRevive":
        reviveAvailable = false;
        break;
      default:
        break;
    }
  }
}

function doDrop(gameX: number): void {
  const res = session.drop(gameX, tickNo);
  if (res.entityId > 0) {
    physics.applyDirectives(res.directives);
    handleEvents(res.events);
    if (!visuals.has(res.entityId)) visuals.set(res.entityId, { s: 1, v: 0 });
  }
}

function tickOnce(): void {
  tickNo += 1;
  if (auto && session.canDrop(tickNo)) {
    const alive = session.aliveEntities;
    if (alive.length > 0 && autoRng.nextFloat() < 0.7) {
      const target = alive[autoRng.nextInt(alive.length)]!;
      const b = physics.bodyOf(target.entityId);
      aimGameX = (b ? b.x : CW / 2) + (autoRng.nextFloat() * 90 - 45);
    } else {
      aimGameX = 40 + autoRng.nextFloat() * (CW - 80);
    }
    doDrop(aimGameX);
  }
  physics.step();
  const res = session.step(physics.snapshot(tickNo));
  physics.applyDirectives(res.directives);
  handleEvents(res.events);
  // 清理已消失实体的视觉状态
  for (const id of [...visuals.keys()]) {
    if (!physics.bodyOf(id)) visuals.delete(id);
  }
  for (const e of session.aliveEntities) {
    if (!visuals.has(e.entityId)) visuals.set(e.entityId, { s: 1, v: 0 });
  }
}

// ---------- 猫咪绘制（Canvas 2D 灰盒形象，Soft Mochi 圆团子） ----------
function drawCat(
  c: CanvasRenderingContext2D,
  level: number,
  cx: number,
  cy: number,
  r: number,
  squash: number,
  alpha: number,
): void {
  c.save();
  c.globalAlpha = alpha;
  c.translate(cx, cy);
  c.scale(1 / Math.sqrt(squash), squash);
  const body = CAT_BODY[level] ?? "#EEE";
  const lw = Math.max(1.6, r * 0.05);

  // Lv10 云朵鬃毛
  if (level === 10) {
    c.fillStyle = "#FFFFFF";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.beginPath();
      c.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.34, 0, Math.PI * 2);
      c.fill();
    }
  }
  // 耳朵
  c.fillStyle = level === 6 ? "#6B4F3A" : body;
  c.strokeStyle = "rgba(90,64,56,0.35)";
  c.lineWidth = lw;
  for (const dir of [-1, 1]) {
    c.beginPath();
    c.moveTo(dir * r * 0.52, -r * 0.62);
    c.quadraticCurveTo(dir * r * 0.62, -r * 1.12, dir * r * 0.94, -r * 0.98);
    c.quadraticCurveTo(dir * r * 0.98, -r * 0.6, dir * r * 0.8, -r * 0.42);
    c.closePath();
    c.fill();
  }
  // 身体
  const grad = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.05);
  grad.addColorStop(0, "#FFFFFF");
  grad.addColorStop(0.25, body);
  grad.addColorStop(1, body);
  c.fillStyle = level === 11 ? grad : body;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(90,64,56,0.22)";
  c.stroke();

  // 花纹与专属件
  if (level === 2 || level === 4) {
    c.fillStyle = level === 2 ? "#3A3532" : "#E8975A";
    c.beginPath();
    c.arc(-r * 0.45, -r * 0.5, r * 0.26, 0, Math.PI * 2);
    c.arc(r * 0.55, r * 0.28, r * 0.2, 0, Math.PI * 2);
    c.fill();
    if (level === 4) {
      c.fillStyle = "#4A4038";
      c.beginPath();
      c.arc(r * 0.5, -r * 0.55, r * 0.18, 0, Math.PI * 2);
      c.fill();
    }
  }
  if (level === 5) {
    c.strokeStyle = "#7E8894";
    c.lineWidth = lw * 1.2;
    for (const off of [-0.45, 0, 0.45]) {
      c.beginPath();
      c.arc(off * r, -r * 1.25, r * 0.62, Math.PI * 0.25, Math.PI * 0.75);
      c.stroke();
    }
  }
  if (level === 6) {
    c.fillStyle = "#6B4F3A";
    c.beginPath();
    c.ellipse(0, r * 0.28, r * 0.52, r * 0.42, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (level === 9) {
    c.fillStyle = "#FCEBD2";
    c.beginPath();
    c.ellipse(0, r * 0.38, r * 0.52, r * 0.42, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (level === 7) {
    c.strokeStyle = COLORS.coralDark;
    c.lineWidth = r * 0.13;
    c.beginPath();
    c.arc(0, r * 0.1, r * 0.86, Math.PI * 0.25, Math.PI * 0.75);
    c.stroke();
    c.fillStyle = COLORS.gold;
    c.beginPath();
    c.arc(0, r * 0.88, r * 0.13, 0, Math.PI * 2);
    c.fill();
  }
  // 脸（面部挂点只吃一半形变的概念在灰盒中以整体缩放近似）
  const eyeY = -r * 0.08;
  c.strokeStyle = level === 7 || level === 6 ? "#2E2622" : COLORS.ink;
  c.lineWidth = lw * 1.15;
  c.lineCap = "round";
  for (const dir of [-1, 1]) {
    c.beginPath();
    c.arc(dir * r * 0.33, eyeY + r * 0.06, r * 0.13, Math.PI * 1.08, Math.PI * 1.92);
    c.stroke();
  }
  c.beginPath(); // 嘴：ω 形
  c.arc(-r * 0.07, r * 0.16, r * 0.075, Math.PI * 0.15, Math.PI * 1.15);
  c.arc(r * 0.07, r * 0.16, r * 0.075, Math.PI * 0.85, Math.PI * 1.85);
  c.stroke();
  c.fillStyle = "rgba(244,143,135,0.55)";
  for (const dir of [-1, 1]) {
    c.beginPath();
    c.ellipse(dir * r * 0.55, r * 0.14, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (level === 1) {
    // 毛线球的蓝蝴蝶结
    c.fillStyle = "#7FB2E5";
    c.beginPath();
    c.moveTo(r * 0.55, -r * 0.88);
    c.lineTo(r * 0.92, -r * 1.05);
    c.lineTo(r * 0.9, -r * 0.66);
    c.closePath();
    c.moveTo(r * 0.55, -r * 0.88);
    c.lineTo(r * 0.24, -r * 1.08);
    c.lineTo(r * 0.26, -r * 0.64);
    c.closePath();
    c.fill();
  }
  if (level === 11) {
    // 皇冠
    c.fillStyle = COLORS.gold;
    c.strokeStyle = COLORS.honey;
    c.lineWidth = lw;
    c.beginPath();
    const cw = r * 0.62;
    const ch = r * 0.34;
    const baseY = -r * 1.02;
    c.moveTo(-cw / 2, baseY);
    c.lineTo(-cw / 2, baseY - ch * 0.55);
    c.lineTo(-cw / 4, baseY - ch * 0.2);
    c.lineTo(0, baseY - ch);
    c.lineTo(cw / 4, baseY - ch * 0.2);
    c.lineTo(cw / 2, baseY - ch * 0.55);
    c.lineTo(cw / 2, baseY);
    c.closePath();
    c.fill();
    c.stroke();
  }
  c.restore();
}

// ---------- 场景绘制 ----------
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const reviveBtn = { x: 215, y: 648, w: 320, h: 78 };
const restartBtn = { x: 215, y: 748, w: 320, h: 78 };
const autoBtn = { x: 28, y: 118, w: 132, h: 48 };

function render(dt: number): void {
  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#F8ECD8");
  bg.addColorStop(1, "#F1DFC2");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 猫窝（编织篮 + 透明窗 + 坐垫）
  ctx.fillStyle = COLORS.honey;
  roundRect(ctx, 38, 438, W - 76, 742, 40);
  ctx.fill();
  ctx.strokeStyle = "rgba(122,79,34,0.45)";
  ctx.lineWidth = 3;
  for (let y = 486; y < 1170; y += 44) {
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(W - 48, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,251,244,0.38)";
  roundRect(ctx, X0, 468, CW, BY - 468 + 2, 26);
  ctx.fill();
  ctx.fillStyle = "rgba(243,184,198,0.75)";
  ctx.beginPath();
  ctx.ellipse(W / 2, BY - 12, CW / 2 - 16, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  // 场上猫咪（按高度从低到高绘制）
  const bodies = [...physicsSnapshotBodies()].sort((a, b) => a.yLu - b.yLu);
  for (const b of bodies) {
    const e = session.entityById(b.entityId);
    if (!e) continue;
    const vis = visuals.get(b.entityId) ?? { s: 1, v: 0 };
    // 果冻弹簧
    vis.v += (-(vis.s - 1) * 170 - vis.v * 13) * dt;
    vis.s += vis.v * dt;
    const falling = e.state === "Falling";
    const stretch = falling ? 1 + Math.min(Math.abs(b.vyLuS) / 9000, 0.1) : 1;
    drawCat(ctx, e.level, X0 + b.xLu, BY - b.yLu, catByLevel(cfg, e.level).radiusLu, vis.s * stretch, 1);
  }

  // 警戒线
  const inDanger = deadlineTick >= 0;
  ctx.save();
  ctx.strokeStyle = inDanger ? COLORS.coralDark : COLORS.coral;
  ctx.lineWidth = inDanger ? 5 : 3.5;
  ctx.setLineDash(inDanger ? [] : [16, 12]);
  ctx.beginPath();
  ctx.moveTo(X0, DANGER_Y);
  ctx.lineTo(X0 + CW, DANGER_Y);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = inDanger ? COLORS.coralDark : COLORS.coral;
  ctx.font = "600 21px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(inDanger ? "溢出警报！" : "猫窝溢出警报线", X0 + CW - 6, DANGER_Y - 12);
  if (inDanger) {
    const secs = Math.max(0, Math.ceil((deadlineTick - tickNo) / 60));
    ctx.fillStyle = COLORS.coralDark;
    ctx.font = "800 92px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(secs), W / 2, 428);
  }

  // 粒子与飘字
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life += dt;
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += 620 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    ctx.globalAlpha = 1 - p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]!;
    f.life += dt;
    if (f.life > 1.1) {
      floaters.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = f.life < 0.8 ? 1 : 1 - (f.life - 0.8) / 0.3;
    ctx.fillStyle = f.color;
    ctx.font = `800 ${f.size}px 'PingFang SC','Microsoft YaHei',sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y - f.life * 56);
  }
  ctx.globalAlpha = 1;

  // 预览猫 + 猫爪 + 落点虚线（仅进行中显示）
  const phase = session.phase;
  if (phase === "Playing" || phase === "DangerCountdown") {
    const cur = session.preview.current;
    const r = catByLevel(cfg, cur.level).radiusLu;
    const gx = Math.min(Math.max(aimGameX, r), CW - r);
    const sx = X0 + gx;
    const alpha = phase === "Playing" ? 1 : 0.45;
    if (phase === "Playing") {
      ctx.save();
      ctx.strokeStyle = "rgba(90,64,56,0.4)";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 14]);
      ctx.beginPath();
      ctx.moveTo(sx, SPAWN_SCREEN_Y + r * 0.7);
      ctx.lineTo(sx, BY - 16);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "rgba(90,64,56,0.16)";
      ctx.beginPath();
      ctx.ellipse(sx, BY - 10, r * 0.95, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawCat(ctx, cur.level, sx, SPAWN_SCREEN_Y, r, 1, alpha);
    // 猫爪
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#FFF6E8";
    ctx.strokeStyle = "rgba(90,64,56,0.25)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(sx, SPAWN_SCREEN_Y - r - 14, 36, 27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#F4A9B8";
    for (const off of [-24, -8, 8, 24]) {
      ctx.beginPath();
      ctx.ellipse(sx + off, SPAWN_SCREEN_Y - r - 30, 7.5, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (cur.lucky) {
      ctx.fillStyle = "#B97F16";
      ctx.font = "700 22px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("幸运毛球!", sx, SPAWN_SCREEN_Y - r - 52);
    }
  }

  // ---------- HUD ----------
  // 设置齿轮（灰盒占位）
  ctx.fillStyle = COLORS.cream;
  ctx.beginPath();
  ctx.arc(64, 66, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,64,56,0.3)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(64, 66);
    ctx.rotate(a);
    ctx.fillRect(-4.5, -21, 9, 10);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(64, 66, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.cream;
  ctx.beginPath();
  ctx.arc(64, 66, 5, 0, Math.PI * 2);
  ctx.fill();

  // 分数牌
  ctx.fillStyle = COLORS.cream;
  roundRect(ctx, 218, 30, 314, 72, 36);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,64,56,0.2)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  ctx.font = "800 37px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`分数 ${session.score}`, 375, 79);
  if (lastCombo >= 2 && tickNo - lastComboTick <= cfg.rules.comboWindowTicks) {
    ctx.fillStyle = COLORS.coralDark;
    ctx.font = "700 24px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(`${lastCombo} 连击`, 375, 128);
  }

  // Next 气泡
  ctx.fillStyle = COLORS.cream;
  roundRect(ctx, 596, 22, 126, 106, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,64,56,0.2)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = COLORS.mint;
  ctx.font = "800 21px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Next", 659, 50);
  const next = session.preview.next;
  drawCat(ctx, next.level, 659, 88, Math.min(30, catByLevel(cfg, next.level).radiusLu * 0.5), 1, 1);

  // 自动演示开关
  ctx.fillStyle = auto ? COLORS.coral : COLORS.cream;
  roundRect(ctx, autoBtn.x, autoBtn.y, autoBtn.w, autoBtn.h, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,64,56,0.25)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = auto ? "#FFFFFF" : COLORS.ink;
  ctx.font = "700 23px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.fillText(auto ? "自动 开" : "自动 关", autoBtn.x + autoBtn.w / 2, autoBtn.y + 32);

  // ---------- 道具栏（灰盒占位，未接入规则） ----------
  const props = [
    { name: "逗猫棒", count: 2, color: "#E8B54D" },
    { name: "香酥鱼干", count: 1, color: "#C97B4A" },
    { name: "魔法彩虹球", count: 0, color: "#B9A8C9" },
    { name: "吹风机", count: 1, color: "#F2A0B5" },
  ];
  props.forEach((p, i) => {
    const x = 43 + i * 170;
    const y = 1196;
    ctx.fillStyle = COLORS.cream;
    roundRect(ctx, x, y, 158, 112, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(90,64,56,0.18)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = p.count === 0 ? 0.35 : 1;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x + 79, y + 42, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.font = "700 22px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name, x + 79, y + 92);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.count === 0 ? "#A79B92" : COLORS.coral;
    ctx.beginPath();
    ctx.arc(x + 132, y + 16, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 21px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(`×${p.count}`, x + 132, y + 24);
  });

  // ---------- 结算/复活遮罩 ----------
  if (phase === "Frozen" || phase === "Settled") {
    ctx.fillStyle = "rgba(64,42,32,0.45)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.cream;
    roundRect(ctx, 155, 430, 440, 430, 30);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 42px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(phase === "Frozen" ? "猫窝溢出啦！" : "本局结算", W / 2, 505);
    ctx.font = "800 56px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(`${session.score} 分`, W / 2, 580);
    ctx.font = "600 25px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "rgba(90,64,56,0.75)";
    const topCat = maxLevel > 0 ? catByLevel(cfg, maxLevel) : null;
    ctx.fillText(topCat ? `最高合成：Lv${maxLevel} ${topCat.name}` : "还没有合成记录", W / 2, 625);
    if (phase === "Frozen" && reviveAvailable) {
      ctx.fillStyle = COLORS.coral;
      roundRect(ctx, reviveBtn.x, reviveBtn.y, reviveBtn.w, reviveBtn.h, 39);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "800 31px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillText("复活一次（移走最高两只）", W / 2, reviveBtn.y + 50);
    }
    ctx.fillStyle = COLORS.cream;
    roundRect(ctx, restartBtn.x, restartBtn.y, restartBtn.w, restartBtn.h, 39);
    ctx.fill();
    ctx.strokeStyle = COLORS.coral;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = COLORS.coralDark;
    ctx.font = "800 31px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("再来一局", W / 2, restartBtn.y + 50);
  }
}

function physicsSnapshotBodies() {
  return physics.snapshot(tickNo).bodies;
}

// ---------- 输入 ----------
function toDesign(ev: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * W,
    y: ((ev.clientY - rect.top) / rect.height) * H,
  };
}

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

canvas.addEventListener("pointermove", (ev) => {
  const p = toDesign(ev);
  aimGameX = p.x - X0;
});
canvas.addEventListener("pointerdown", (ev) => {
  const p = toDesign(ev);
  if (inRect(p.x, p.y, autoBtn)) {
    auto = !auto;
    return;
  }
  aimGameX = p.x - X0;
});
canvas.addEventListener("pointerup", (ev) => {
  const p = toDesign(ev);
  const phase = session.phase;
  if (phase === "Frozen" || phase === "Settled") {
    if (phase === "Frozen" && reviveAvailable && inRect(p.x, p.y, reviveBtn)) {
      const res = session.revive(tickNo);
      physics.applyDirectives(res.directives);
      handleEvents(res.events);
      return;
    }
    if (inRect(p.x, p.y, restartBtn)) {
      newRun((Date.now() % 100000) + 7);
    }
    return;
  }
  if (inRect(p.x, p.y, autoBtn)) return;
  aimGameX = p.x - X0;
  if (session.canDrop(tickNo)) doDrop(aimGameX);
});

// ---------- 主循环（60Hz 固定步进） ----------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) {
    tickOnce();
    acc -= STEP;
  }
  render(dt);
}
requestAnimationFrame(frame);
