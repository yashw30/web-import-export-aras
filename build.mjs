// Bundles the panel and the engine's Worker into one userscript: dist/web-import-export-aras.user.js
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// The engine's Worker source, embedded as a string and started from a Blob at run time.
const workerSource = {
  name: "worker-source",
  setup(build) {
    build.onResolve({ filter: /^virtual:worker-source$/ }, () => ({ path: "worker-source", namespace: "worker-source" }));
    build.onLoad({ filter: /.*/, namespace: "worker-source" }, () => {
      let text = readFileSync("node_modules/import-export-libs-js/dist/browser-worker.js", "utf8").replace(/\/\/# sourceMappingURL=.*$/m, "");
      try {
        text = esbuild.transformSync(text, { minify: true, legalComments: "none", target: "es2020" }).code;
      } catch {
        // an unminified Worker works the same, only larger
      }
      return { contents: `export default ${JSON.stringify(text)};`, loader: "js" };
    });
  },
};

const result = await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".html": "text", ".css": "text" },
  plugins: [workerSource],
});
const payload = result.outputFiles[0].text;

const header = `// ==UserScript==
// @name         Aras - Web Import Export
// @namespace    web-import-export-aras
// @version      ${pkg.version}
// @description  Export and import Aras packages from the Aras page you are signed in to. Ctrl+Shift+P opens it.
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==
`;

// The payload is large, so it sits in a string and is only evaluated (in the page, where \`aras\` lives) on an Aras client.
const loader = `
(() => {
  const looksLikeAras = new RegExp("/(Client|InnovatorServer)(/|$)", "i").test(location.pathname);
  const isAras = () => !!window.aras && typeof window.aras.getDatabase === "function";
  let tries = 0;
  const attempt = () => {
    if (isAras()) {
      const PAYLOAD = ${JSON.stringify(payload)};
      (0, eval)(PAYLOAD);
      return;
    }
    if (++tries < (looksLikeAras ? 60 : 2)) setTimeout(attempt, looksLikeAras ? 500 : 1500);
  };
  attempt();
})();
`;

// output/compiled.js is the payload alone, committed to the repo: the small loader in scripts/ fetches it from GitHub, so updating
// the tool is a push and nobody reinstalls anything.
mkdirSync("output", { recursive: true });
writeFileSync("output/compiled.js", payload);
console.log(`built output/compiled.js  (${(Buffer.byteLength(payload) / 1024 / 1024).toFixed(2)} MB)`);

mkdirSync("dist", { recursive: true });
const file = "dist/web-import-export-aras.user.js";
writeFileSync(file, header + loader);
console.log(`built ${file}  (${(Buffer.byteLength(header + loader) / 1024 / 1024).toFixed(2)} MB)`);
