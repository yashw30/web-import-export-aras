// ==UserScript==
// @name         Aras - Web Import Export (Main)
// @namespace    web-import-export-aras
// @version      1.2
// @description  Export and import Aras packages from the Aras page. Ctrl+Shift+P opens it. Loads the latest build from GitHub.
// @match        *://*/*
// @noframes
// @grant        none
// ==/UserScript==

// Installing this once is enough: the tool itself is fetched from the repo each time an Aras page opens.
// Only the top window of a page starts it (Aras's tabs, grids and forms are frames, and a second copy there would add a second button).
// It asks GitHub for the newest commit and fetches the tool as it is at that commit, so the version shown at the bottom of the tool is
// exactly the code that is running (and the cache cannot serve an older copy). If GitHub's API cannot be reached it falls back to `main`.
const REPO = "yashw30/web-import-export-aras";
setTimeout(() => {
	if (window.top !== window || !window.aras) return;
	fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: "application/vnd.github.sha" } })
		.then((response) => (response.ok ? response.text() : ""))
		.catch(() => "")
		.then((sha) => {
			const commit = /^[0-9a-f]{40}$/.test(sha.trim()) ? sha.trim() : "";
			window.__wieaBuild = { commit: commit ? commit.slice(0, 7) : "main (unpinned)" };
			return fetch(`https://raw.githubusercontent.com/${REPO}/${commit || "main"}/output/compiled.js`, { cache: "no-cache" });
		})
		.then((response) => response.text())
		// indirect eval keeps the code in the page, where the Aras client (`window.aras`) lives
		.then((source) => (0, eval)(source))
		.catch((error) => console.log(error));
}, 1000);
