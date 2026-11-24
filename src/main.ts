import { ADD_CSS, addToPackageFlow } from "./add-to-package.js";
import { type OpenItem, findPackagesOf, isPackagedType, readOpenItem } from "./page-bridge.js";
import css from "./panel.css";
import html from "./panel.html";
import { start } from "./panel.js";

/**
 * Entry of the userscript: runs in the top window of an Aras client, puts a drawer on the right (a shadow DOM, so Aras's styles
 * cannot touch it and the drawer's cannot touch Aras), and opens it with Ctrl+Shift+P from anywhere in the client.
 */

const HOST_ID = "__web_import_export_aras";

let host: HTMLElement | undefined;
let launcher: HTMLElement | undefined;
let panel: { refresh(): void } | undefined;
let toast: HTMLElement | undefined;

function mount(): void {
  host = document.createElement("div");
  host.id = HOST_ID;
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

function open(): void {
  hideToast(); // the shortcut takes over from the suggestion
  if (host === undefined) {
    mount(); // starts connecting by itself
  } else {
    host.style.display = "block";
    panel?.refresh(); // pressed again: read the tab and the open item again
  }
  if (launcher !== undefined) launcher.style.display = "none";
}

function close(): void {
  if (host !== undefined) host.style.display = "none";
  if (launcher !== undefined) launcher.style.display = "block";
}

function addLauncher(): void {
  launcher = document.createElement("div");
  const shadow = launcher.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    button.launch { position: fixed; right: 0; top: 45%; z-index: 2147482999; width: 22px; height: 72px; padding: 0; border: 0; border-radius: 6px 0 0 6px;
      background: #1a5fb4; color: #fff; font: 600 11px system-ui, sans-serif; letter-spacing: 1px; writing-mode: vertical-rl; cursor: pointer; opacity: 0.55; }
    button.launch:hover { opacity: 1; }
    ${ADD_CSS}
    .toast { position: fixed; right: 34px; bottom: 24px; z-index: 2147482999; width: min(340px, calc(100vw - 48px)); box-sizing: border-box; padding: 10px 12px;
      font: 13px/1.4 system-ui, sans-serif; color-scheme: light dark; background: Canvas; color: CanvasText; border: 1px solid #1a5fb4; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3); }
    .toast[hidden] { display: none; }
    .toast .row { display: flex; gap: 8px; margin-top: 8px; }
    .toast .row button { font: inherit; padding: 5px 12px; border: 1px solid #888; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
    .toast .row button.primary { background: #1a5fb4; border-color: #1a5fb4; color: #fff; }
    .toast .head { display: flex; gap: 8px; align-items: flex-start; }
    .toast .head .msg { flex: 1; word-break: break-word; }
    .toast .head .x { flex: none; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; opacity: 0.7; }
  </style><div class="toast" hidden></div><button class="launch" type="button" title="Aras - Web Import Export (Ctrl+Shift+P)">IMPORT / EXPORT</button>`;
  shadow.querySelector("button.launch")?.addEventListener("click", open);
  toast = shadow.querySelector<HTMLElement>(".toast") ?? undefined;
  // keys typed in the suggestion stay there (the page's own key handlers could swallow them)
  for (const type of ["keydown", "keypress", "keyup"]) shadow.addEventListener(type, (event) => event.stopPropagation());
  document.body.append(launcher);
}

// ------------------------------------------------------------------------------------------- suggestion for a newly opened tab

/** Items whose suggestion was closed or answered: they are not offered again in this page. */
const answered = new Set<string>();

function hideToast(): void {
  if (toast !== undefined) toast.hidden = true;
}

function showSuggestion(item: OpenItem): void {
  if (toast === undefined) return;
  const box = toast;
  const close = (): void => {
    answered.add(item.id);
    box.hidden = true;
  };
  const head = document.createElement("div");
  head.className = "head";
  const message = document.createElement("div");
  message.className = "msg";
  message.textContent = `${item.type} "${item.name}" is not in any package. Add it to one?`;
  const x = document.createElement("button");
  x.className = "x";
  x.type = "button";
  x.title = "Close";
  x.textContent = "✕";
  x.addEventListener("click", close);
  head.append(message, x);
  const row = document.createElement("div");
  row.className = "row";
  const add = document.createElement("button");
  add.className = "primary";
  add.type = "button";
  add.textContent = "Add to package…";
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "Not now";
  no.addEventListener("click", close);
  add.addEventListener("click", () => {
    const holder = document.createElement("div");
    box.replaceChildren(holder);
    addToPackageFlow(holder, item, () => close());
  });
  row.append(add, no);
  box.replaceChildren(head, row);
  box.hidden = false;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let lastTab = "";
let checking = 0;

/** A tab was selected: if it holds a saved item of a packaged type that no package has, suggest adding it. */
async function checkOpenTab(token: number): Promise<void> {
  hideToast();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(900); // a tab's item loads a moment after the tab opens
    if (token !== checking) return;
    const item = readOpenItem();
    if (item === null) continue;
    if (item.isNew || answered.has(item.id)) return;
    if (host !== undefined && host.style.display !== "none") return; // the drawer is open: it has its own question
    const packages = findPackagesOf(item.id, item.type, item.name, item.configId);
    if (packages === null || "error" in packages || packages.names.length > 0) return;
    if (isPackagedType(item.type) !== true) return;
    if (token === checking) showSuggestion(item);
    return;
  }
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
    open();
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
