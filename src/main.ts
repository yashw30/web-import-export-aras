import { ADD_CSS } from "./add-to-package.js";
import { isSelectedTabLoaded, readOpenItem } from "./page-bridge.js";
import css from "./panel.css";
import html from "./panel.html";
import { type PanelApi, start } from "./panel.js";

/**
 * Entry of the userscript: runs in the top window of an Aras client, puts a drawer on the right (a shadow DOM, so Aras's styles
 * cannot touch it and the drawer's cannot touch Aras), and opens it with Ctrl+Shift+P from anywhere in the client.
 */

const HOST_ID = "__web_import_export_aras";

let host: HTMLElement | undefined;
let launcher: HTMLElement | undefined;
let panel: PanelApi | undefined;

/** Builds the drawer. `show: false` builds it hidden (to hold the export selection before anyone opens it). */
function mount(show: boolean): void {
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.display = show ? "block" : "none";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${css}${ADD_CSS}</style>${html}`;
  panel = start(shadow);
  shadow.getElementById("close")?.addEventListener("click", close);
  shadow.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") close();
  });
  // Keys typed in the drawer stay in the drawer: the page's own key handlers (Aras, other userscripts) see the drawer as one
  // element and could swallow Backspace or letters meant for its search box.
  for (const type of ["keydown", "keypress", "keyup"]) shadow.addEventListener(type, (event) => event.stopPropagation());
}

const isOpen = (): boolean => host !== undefined && host.style.display !== "none";

function open(): void {
  if (host === undefined) {
    mount(true); // starts connecting by itself
  } else {
    host.style.display = "block";
    panel?.refresh(); // read the tab and the open item again
  }
  if (launcher !== undefined) launcher.style.display = "none";
}

function close(): void {
  if (host !== undefined) host.style.display = "none";
  if (launcher !== undefined) launcher.style.display = "block";
}

/** Ctrl+Shift+P: closes the drawer when it is open, opens it when it is not. */
function toggle(): void {
  if (isOpen()) close();
  else open();
}

function addLauncher(): void {
  launcher = document.createElement("div");
  const shadow = launcher.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    button.launch { position: fixed; right: 0; top: 45%; z-index: 2147482999; width: 22px; height: 72px; padding: 0; border: 0; border-radius: 6px 0 0 6px;
      background: #1a5fb4; color: #fff; font: 600 11px system-ui, sans-serif; letter-spacing: 1px; writing-mode: vertical-rl; cursor: pointer; opacity: 0.55; }
    button.launch:hover { opacity: 1; }
  </style><button class="launch" type="button" title="Aras - Web Import Export (Ctrl+Shift+P)">IMPORT / EXPORT</button>`;
  shadow.querySelector("button.launch")?.addEventListener("click", open);
  document.body.append(launcher);
}

// ------------------------------------------------------------------------------------- the question for a newly selected tab

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let lastTab = "";
let checking = 0;

/**
 * A tab was selected. Only while the tool is open does it ask about that tab's item: once the tab has finished opening (its item is
 * there, its page and every frame in it are loaded, and that has held for a moment), the tool asks. With the tool closed nothing is
 * shown; opening the tool asks about the tab that is selected then.
 */
async function checkOpenTab(token: number): Promise<void> {
  if (!isOpen()) return;
  panel?.clearPrompt();
  let steady = 0;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await wait(300);
    if (token !== checking || !isOpen()) return;
    steady = readOpenItem() !== null && isSelectedTabLoaded() ? steady + 1 : 0;
    if (steady >= 3) break;
  }
  if (steady >= 3) panel?.promptOpenItem();
}

function watchTabs(): void {
  setInterval(() => {
    const selected = (window as unknown as { arasTabs?: { selectedTab?: unknown } }).arasTabs?.selectedTab;
    if (typeof selected !== "string" || selected === lastTab) return;
    lastTab = selected;
    checking += 1;
    void checkOpenTab(checking);
  }, 1000);
}

// Ctrl+Shift+P. Keys pressed inside Aras's frames do not reach the top window, so the listener goes on every same-origin frame.
const attached = new WeakSet<Document>();

function onKey(event: KeyboardEvent): void {
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyP") {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  }
}

function attach(doc: Document): void {
  if (attached.has(doc)) return;
  attached.add(doc);
  doc.addEventListener("keydown", onKey, true);
  const scan = (): void => {
    for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
      const bind = (): void => {
        try {
          const inner = (frame as HTMLIFrameElement).contentDocument;
          if (inner !== null) attach(inner);
        } catch {
          // a cross-origin frame
        }
      };
      bind();
      frame.addEventListener("load", bind);
    }
  };
  scan();
  new MutationObserver(scan).observe(doc, { childList: true, subtree: true });
}

/**
 * One drawer and one launcher for the whole Aras client. The userscript can start in every window and frame of it (a search grid,
 * a form or an item that opens in its own window), so only the main window of the client may mount anything.
 */
function isMainClientWindow(): boolean {
  try {
    if (window.top !== window) return false;
    const aras = (window as unknown as { aras?: { getMainWindow?: () => Window | undefined } }).aras;
    const main = aras?.getMainWindow?.();
    return main === undefined || main === null || main === window;
  } catch {
    return false;
  }
}

function boot(): void {
  if (!isMainClientWindow()) return;
  if (document.getElementById(HOST_ID) !== null || window.__webImportExportAras === true) return;
  window.__webImportExportAras = true;
  addLauncher();
  attach(document);
  watchTabs();
}

boot();
