// 把 main.ts 打包并内联进模板，产出单文件可直接打开的预览页。
// 用法：node web-preview/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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
