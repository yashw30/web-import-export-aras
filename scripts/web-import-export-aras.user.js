// ==UserScript==
// @name         Aras - Web Import Export (Main)
// @namespace    web-import-export-aras
// @version      1.1
// @description  Export and import Aras packages from the Aras page. Ctrl+Shift+P opens it. Loads the latest build from GitHub.
// @match        *://*/*
// @noframes
// @grant        none
// ==/UserScript==

// Installing this once is enough: the tool itself is fetched from the repo each time an Aras page opens.
// Only the top window of a page starts it (Aras's tabs, grids and forms are frames, and a second copy there would add a second button).
setTimeout(
	() =>
		window.top === window &&
		window.aras &&
		fetch("https://raw.githubusercontent.com/yashw30/web-import-export-aras/main/output/compiled.js", { cache: "no-cache" })
			.then((response) => response.text())
			// indirect eval keeps the code in the page, where the Aras client (`window.aras`) lives
			.then((source) => (0, eval)(source))
			.catch((error) => console.log(error)),
	1000,
);
