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

function mount(): void {
  host = document.createElement("div");
  host.id = HOST_ID;
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${css}</style>${html}`;
  panel = start(shadow);
  shadow.getElementById("close")?.addEventListener("click", close);
  shadow.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") close();
  });
}

function open(): void {
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
    button { position: fixed; right: 0; top: 45%; z-index: 2147482999; width: 22px; height: 72px; padding: 0; border: 0; border-radius: 6px 0 0 6px;
      background: #1a5fb4; color: #fff; font: 600 11px system-ui, sans-serif; letter-spacing: 1px; writing-mode: vertical-rl; cursor: pointer; opacity: 0.55; }
    button:hover { opacity: 1; }
  </style><button type="button" title="Web-ImportExport Aras (Ctrl+Shift+P)">IMPORT / EXPORT</button>`;
  shadow.querySelector("button")?.addEventListener("click", open);
  document.body.append(launcher);
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

function boot(): void {
  if (window.__webImportExportAras === true) return;
  window.__webImportExportAras = true;
  addLauncher();
  attach(document);
}

boot();
