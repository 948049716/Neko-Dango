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
