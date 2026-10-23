# 《猫咪团子》客户端工程（Cocos Creator 3.8）

## 当前状态：M0 规则核心完成 + 2D 垂直切片起点（2026-10-23 路线变更）

**路线变更（2026-10-23，用户拍板）**：游戏由 Bullet 3D 改为 **Physics2D（Box2D）2D 路线**。
原因：玩法本身是平面内的（猫只在 X/Y 平面运动、绕 Z 轴旋转），设计图为软糯插画风，
2D 精灵即可贴合设计图，且容器可直接绘制、合成接触判定更可靠。规则层、GameSession、
配置与测试**全部不变**，只换物理适配与场景。GLB 高模与四视图改为设定参考，不再做低模生产。
变更记录见 `docs/2D路线变更.md`。

## 目录

```text
client/
  assets/
    configs/game-config.json        全部数值配置（主策划 v2.2.0 第三章数值表与第二章规则）
    textures/cats/cat01..11.png     11 阶猫正面精灵（由四视图设定表提取，tools/gen_2d_assets.py）
    textures/basket-back/front.png  藤编猫窝后景/前景（按 UI_01 设计图绘制，同上脚本）
    scripts/
      domain/                       纯规则：配置校验、种子随机、计分、掉落、危险、合成事务
      application/GameSession.ts    单局编排：实体注册、预览队列、投放节奏、局面状态机
      presentation/Physics2DAdapter.ts  Box2D 适配：圆形碰撞、静态容器、几何接触、冲击波
      presentation/HudView.ts / InputView.ts
      bootstrap/GameBootstrap.ts    装配与固定步进主循环
tests/                              仓库根目录下的无头测试（不在 client 内）
```

## 规则口径

- 逻辑固定 60Hz tick；时长类规则一律以 tick 表达（50ms 合成接触 = 3 tick，合成提交 27 tick，
  双 Lv11 提交 36 tick，危险触发 36 tick、倒计时 180 tick、解除 18 tick）。
- 规则层只消费适配层喂入的刚体快照与接触对，不导入 `cc`、`wx` 或真实时钟。
- 正式物理为 Cocos Physics2D（Box2D）；`tests/HeadlessPhysics.ts` 是规则验证用的确定性
  灰盒替身，其参数在配置的 `headlessSim` 段，仅供测试参考，不是出厂物理参数。
- 合成触发口径（与主策划一致，不是撞上即合）：同级猫**稳定接触**——连续接触 ≥3 tick、
  法向相对速度 <80 lu/s——后预占，再过 27 tick 正式合成。高速撞击会被弹开，不触发。

## 无头测试（仓库根目录执行）

```bash
npm install
npm test          # 配置校验 + 规则单元测试（79 项断言）
npm run test:sim  # 1000 局规则模拟不变量 + 同种子回放确定性（按用户指示暂缓中）
npm run typecheck # 规则层严格类型检查
npm run typecheck:prefab  # 引擎侧脚本对照官方 @cocos/creator-types 3.8.8 检查
```

## 预制 Cocos 工程（2D 版，2026-10-23）

`client/` 是可直接导入的 Cocos Creator 3.8 工程：工程 `package.json`、`settings/`（设计分辨率
750×1334、宽度适配）、全部资源的 `.meta`（含图片的 sprite-frame 子资产）、手工编排的
`assets/scenes/Game.scene`（109 个对象：纯 Canvas/2D 结构——背景、藤编猫窝前后景、危险线、
HUD、结算 Overlay、GameRoot），脚本绑定已预接线（含 11 阶猫精灵数组）。工程由
`tools/gen_cocos_project.py` 生成（可重复运行，已有 uuid 会被复用），场景一致性由该脚本自检
（含 2D 专项：无 3D 组件、单正交相机、精灵绑定齐全）。

2D 适配要点（`Physics2DAdapter`）：

- 坐标 1lu = 1 设计像素；WorldRoot 原点在容器底部内侧中心（场景中位于 Canvas (0,-483)）。
- 猫节点代码创建：Sprite + CircleCollider2D（半径 = 配置 radiusLu）+ RigidBody2D
  （密度按 PTM 32 换算使质量 = 配置 mass）；精灵按宽度等比缩放贴合碰撞直径。
- 容器为三块不可见静态碰撞体（底/左/右），视觉由猫窝精灵承担。
- **接触对由快照时几何计算**（圆距/贴边），不依赖物理事件回调——这是 3D 版在编辑器内
  合成不触发的根治点。
- 渲染层序：WorldRoot 子节点 [BasketBack, 猫…, DangerLine, BasketFront]，猫生成时固定
  插到 1 号位，呈现在猫窝前景之下、后景之上。

### 在编辑器中打开（Windows / macOS）

1. 安装 Cocos Creator 3.8.x（LTS），先 `git pull` 拿到 2D 版提交，再用 Dashboard「导入」
   选择仓库的 `client/` 目录打开（此前打开过 3D 版工程的，先关掉编辑器再重新导入/打开，
   让它重新导入 textures 与新场景）。
2. 打开 `assets/scenes/Game.scene`，在「构建发布」中把它设为启动场景。
3. 不需要做任何预制体：猫、容器都由代码生成，精灵已绑定。直接点运行即可游玩：
   移动鼠标/手指瞄准，松手投放；前三只为新手序列 Lv1、Lv1、Lv2，两只 Lv1 落稳贴住约
   半秒后应合成为 Lv2。
4. 首次打开核对清单（手工编排工程的已知不确定点，编辑器若自动修正属正常）：
   - 场景中应只有 Canvas 自带的正交相机，没有 Main Camera / Main Light（那是旧 3D 版）。
   - GameRoot 的 GameBootstrap 绑定：configAsset / worldRoot / containerRoot（后两者都指向
     WorldRoot）/ hud / input 应均有值，`catSprites` 数组应有 11 张（Lv1→Lv11）。
   - `game-config.json` 与各 PNG 若被重新导入（meta 版本自愈），uuid 不变即可，绑定不受影响。

### 已知未完成（按里程碑）

- M1 后续：果冻形变（事件钩子已在 GameBootstrap 留位）、合成粒子/飘分、瞄准虚线与顶部猫爪。
- 主菜单/图鉴/相册/装扮/设置等外围界面目前只有设计图（`art/ui-designs/`），属 M3。
- 道具栏目前为静态文案（道具规则属 M3）；Next 显示为等级文字（换成小猫图属表现优化）。
- 猫窝前景横向编纹有轻微重复亮带（纹理平铺接缝），美术精修时处理。
