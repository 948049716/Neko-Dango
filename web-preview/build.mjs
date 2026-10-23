// 把 main.ts 与精灵素材打包并内联进模板，产出单文件可直接打开的预览页。
// 用法：node web-preview/build.mjs（先运行 tools_extract_sprites.py 生成 assets/）
import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "assets");

// 生成 assets-data.ts：精灵名 -> data URI
const sprites = {};
if (existsSync(assetsDir)) {
  for (const f of readdirSync(assetsDir).filter((x) => x.endsWith(".webp")).sort()) {
    const b64 = readFileSync(join(assetsDir, f)).toString("base64");
    sprites[f.replace(/\.webp$/, "")] = `data:image/webp;base64,${b64}`;
  }
}
writeFileSync(
  join(here, "assets-data.ts"),
  `// 由 build.mjs 生成，请勿手改\nexport const SPRITES: Record<string, string> = ${JSON.stringify(sprites)};\n`,
);
console.log(`精灵素材 ${Object.keys(sprites).length} 个已内联`);

const result = await build({
  entryPoints: [join(here, "main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "info",
});

const bundle = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
const template = readFileSync(join(here, "index.template.html"), "utf-8");
const html = template.replace("<!--BUNDLE-->", () => bundle);
const out = join(here, "neko-dango-preview.html");
writeFileSync(out, html);
console.log(`已生成 ${out}（${(html.length / 1024).toFixed(0)} KiB）`);
