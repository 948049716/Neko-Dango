# 《猫咪团子》客户端工程（Cocos Creator 3.8）

## 当前状态：M0 规则与物理灰盒（进行中）

已落地的是**纯 TypeScript 规则层与应用编排层**，不依赖引擎，可在无头环境完整测试。
Cocos 编辑器工程文件（settings、场景、预制体）将在编辑器首次打开本目录时生成，
生成的 `.meta` 文件需随资源一并提交（见 docs/架构设计.md 第 3 节）。

## 目录

```text
client/
  assets/
    configs/game-config.json        全部数值配置（主策划 v2.2.0 第三章数值表与第二章规则）
    scripts/
      domain/                       纯规则：配置校验、种子随机、计分、掉落、危险、合成事务
      application/GameSession.ts  单局编排：实体注册、预览队列、投放节奏、局面状态机
      （infrastructure / platform / presentation 待 M1 接入引擎时建立）
tests/                              仓库根目录下的无头测试（不在 client 内）
```

## 规则口径

- 逻辑固定 60Hz tick；时长类规则一律以 tick 表达（50ms 合成接触 = 3 tick，合成提交 27 tick，
  双 Lv11 提交 36 tick，危险触发 36 tick、倒计时 180 tick、解除 18 tick）。
- 规则层只消费适配层喂入的刚体快照与接触对，不导入 `cc`、`wx` 或真实时钟。
- 正式物理为引擎 Bullet；`tests/HeadlessPhysics.ts` 只是规则验证用的确定性灰盒替身，
  其参数在配置的 `headlessSim` 段，仅供测试，不是出厂物理参数。
- 现有 GLB 为高模源资产（单只约 190 万三角面），按 docs/技术选型.md 结论只作导入源，
  不直接进游戏资源；低模 LOD1 制作属于 M2。

## 无头测试（仓库根目录执行）

```bash
npm install
npm test          # 配置校验 + 规则单元测试（79 项断言）
npm run test:sim  # 1000 局规则模拟不变量 + 同种子回放确定性
npm run typecheck # 严格类型检查
```

M0 通过条件（docs/技术选型.md 第 7 节）：1000 局规则模拟不重复消费、不生成 Lv12。
引擎场景内的接触与真机性能验证不在无头范围内，随 M1 垂直切片进行。

## 预制 Cocos 工程（M1 起点，2026-10-23）

`client/` 已预制为可直接导入的 Cocos Creator 3.8 工程：工程 `package.json`、`settings/`（设计分辨率 750×1334、宽度适配）、全部资源的 `.meta`、手工编排的 `assets/scenes/Game.scene`（102 个对象：主光源/主相机/Canvas+HUD/GameRoot，脚本绑定已预接线），以及引擎侧脚本：

- `assets/scripts/bootstrap/GameBootstrap.ts`：装配与固定步进主循环、事件接线、预览猫、复活/结算/重开。
- `assets/scripts/presentation/BulletPhysicsAdapter.ts`：Bullet 适配（球碰撞体、静态容器、接触对、冲击波、Z 轴锁定），接口与无头替身一致。
- `assets/scripts/presentation/HudView.ts` / `InputView.ts`：HUD 视图与输入（设计坐标换算）。
- 引擎侧类型检查：仓库根 `npm run typecheck:prefab`（对照官方 `@cocos/creator-types` 3.8.8）。
- 工程文件由 `tools/gen_cocos_project.py` 生成（可重复运行，已有 uuid 会被复用）；场景图一致性由该脚本自检。

### 在编辑器中打开（Windows / macOS）

1. 安装 Cocos Creator 3.8.x（LTS），用 Dashboard「导入」选择仓库的 `client/` 目录打开。
2. 打开 `assets/scenes/Game.scene`，在「构建发布」中把它设为启动场景。
3. **做猫预制体**：新建节点加内置球体网格（半径 0.5），存为 Prefab（如 `assets/prefabs/Cat.prefab`），拖到 GameRoot 上 GameBootstrap 的 `catPrefab` 字段。不做也能运行（代码会生成占位球体节点），但没有正式形象。
4. 首次打开核对清单（手工编排工程的已知不确定点，编辑器若自动修正属正常）：
   - 主相机 `Main Camera` 的投影应为 Perspective、FOV 30；UI 相机为 Orthographic。
   - GameRoot 的 GameBootstrap 六个绑定（configAsset/worldRoot/containerRoot/hud/input）应均有值，catPrefab 为空属预期。
   - `game-config.json` 若被重新导入（meta 版本自愈），uuid 不变即可，绑定不受影响。

### 已知未完成（按里程碑）

- M1 后续：猫预制体的正式视觉（M2 低模替换占位球体）、容器视觉（编织猫窝按 ENV 设定建模）、相机偏航（scene-spec ±16°）、果冻形变的事件钩子已在 GameBootstrap 中留位。
- 道具栏目前为静态文案（道具规则属 M3）；Next 显示为等级文字（图鉴式小猫预览属 M2 表现）。
