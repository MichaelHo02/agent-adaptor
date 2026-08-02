import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const outputDirectory = "plugins/agent-adaptor/dist";
await mkdir(outputDirectory, { recursive: true });

const panel = await build({
  entryPoints: ["src/session-panel.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  write: false,
});
const panelHtml = (await readFile("src/session-panel.html", "utf8")).replace(
  "/* APP_SCRIPT */",
  panel.outputFiles[0].text,
).replace(/[ \t]+$/gm, "");
await writeFile(`${outputDirectory}/session-panel.html`, panelHtml);

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  outfile: `${outputDirectory}/server.mjs`,
  plugins: [
    {
      name: "cursor-sdk-assets",
      setup(builder) {
        builder.onResolve({ filter: /^bun:sqlite$/ }, (args) => ({ path: args.path, external: true }));
        builder.onLoad({ filter: /(?:\.d\.ts|\.map|\.txt)$/ }, () => ({ contents: "export default '';", loader: "js" }));
      },
    },
  ],
});

const serverBundle = `${outputDirectory}/server.mjs`;
await writeFile(serverBundle, (await readFile(serverBundle, "utf8")).replace(/[ \t]+$/gm, ""));
