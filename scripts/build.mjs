import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  outfile: "plugins/agent-adaptor/dist/server.mjs",
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
