import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GameConfig } from "../client/assets/scripts/domain/GameConfig";

/** 读取与 Cocos 工程同一份配置 JSON（仓库根/client/assets/configs/game-config.json）。 */
export function loadConfig(): GameConfig {
  const path = join(__dirname, "..", "..", "client", "assets", "configs", "game-config.json");
  return JSON.parse(readFileSync(path, "utf-8")) as GameConfig;
}

let failures = 0;
let checks = 0;

export function check(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

export function eq<T>(actual: T, expected: T, message: string): void {
  check(
    Object.is(actual, expected),
    `${message}（期望 ${String(expected)}，实际 ${String(actual)}）`,
  );
}

export function section(name: string): void {
  console.log(`\n[${name}]`);
}

export function finish(suiteName: string): void {
  console.log(`\n${suiteName}：共 ${checks} 项断言，失败 ${failures} 项`);
  if (failures > 0) process.exit(1);
}
