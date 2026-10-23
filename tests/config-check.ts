import { GameConfig, validateConfig } from "../client/assets/scripts/domain/GameConfig";
import { check, eq, finish, loadConfig, section } from "./TestKit";

section("随仓配置合法性");
const cfg = loadConfig();
const problems = validateConfig(cfg);
eq(problems.length, 0, `随仓配置应无问题：${problems.join("；")}`);
eq(cfg.cats.length, 11, "猫咪等级为 11 级");
eq(cfg.cats[10]!.radiusLu, 180, "Lv11 半径为 180lu（主策划 3.1 验算结论）");
eq(cfg.world.dangerLineYLu, 660, "危险线为 660lu");

section("校验器能拦住坏配置");
const badWeights = JSON.parse(JSON.stringify(cfg)) as GameConfig;
badWeights.spawn.phases[0]!.weightsPercent = [40, 35, 20, 4];
check(validateConfig(badWeights).some((p) => p.includes("权重")), "权重和不为 100 应被检出");

const badRadius = JSON.parse(JSON.stringify(cfg)) as GameConfig;
badRadius.cats[10]!.radiusLu = 205;
check(
  validateConfig(badRadius).some((p) => p.includes("双 Lv11")),
  "Lv11 半径 205lu 的双猫堆叠超线应被检出（主策划 3.1 反例）",
);

const missingLevel = JSON.parse(JSON.stringify(cfg)) as GameConfig;
missingLevel.cats = missingLevel.cats.slice(0, 10);
check(validateConfig(missingLevel).length > 0, "缺等级应被检出");

finish("配置校验");
