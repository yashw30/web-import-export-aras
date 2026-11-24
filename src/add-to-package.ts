import { type OpenItem, addItemToPackage, listPackages } from "./page-bridge.js";

/**
 * "Add this item to a package": a small form (a searchable package field, Add and Cancel) used both by the suggestion that appears
 * when a tab with an unpackaged item opens, and by the drawer's open-item box.
 */

export const ADD_CSS = `
.atp { display: grid; gap: 6px; }
.atp label { word-break: break-word; }
.atp input { width: 100%; box-sizing: border-box; font: inherit; padding: 5px 8px; border: 1px solid var(--border, #888); border-radius: 6px; background: transparent; color: inherit; }
.atp .atp-actions { display: flex; gap: 8px; }
.atp button { font: inherit; padding: 5px 12px; border: 1px solid var(--border, #888); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.atp button.primary { background: #1a5fb4; border-color: #1a5fb4; color: #fff; }
.atp button:disabled { opacity: 0.5; cursor: default; }
.atp .atp-msg { font-size: 12px; word-break: break-word; }
.atp .atp-msg.bad { color: #c01c28; }
`;

let counter = 0;

/** Renders the form into `container`. `done` gets the package the item was added to, or `undefined` when cancelled. */
export function addToPackageFlow(container: HTMLElement, item: OpenItem, done: (addedTo: string | undefined) => void): void {
  const listId = `atp-packages-${++counter}`;
  const wrap = document.createElement("div");
  wrap.className = "atp";

  const label = document.createElement("label");
  label.textContent = `Add ${item.type} "${item.name}" to package:`;
  const input = document.createElement("input");
  input.setAttribute("list", listId);
  input.placeholder = "Type to search packages";
  input.autocomplete = "off";
  const list = document.createElement("datalist");
  list.id = listId;

  const actions = document.createElement("div");
  actions.className = "atp-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add";
  add.disabled = true;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  actions.append(add, cancel);
  const message = document.createElement("div");
  message.className = "atp-msg";
  wrap.append(label, input, list, actions, message);
  container.replaceChildren(wrap);

  const answer = listPackages();
  const names = answer !== null && "names" in answer ? answer.names : [];
  if (answer === null || "error" in answer) {
    message.className = "atp-msg bad";
    message.textContent = `Could not read the packages${answer !== null && "error" in answer ? `: ${answer.error}` : "."}`;
  }
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    list.append(option);
  }
  try {
    const last = localStorage.getItem("web-import-export-aras:last-package");
    if (last !== null && names.includes(last)) input.value = last;
  } catch {
    // remembering the last package is a convenience only
  }
  const refresh = (): void => {
    add.disabled = !names.includes(input.value.trim());
  };
  refresh();
  input.addEventListener("input", refresh);
  input.focus();

  cancel.addEventListener("click", () => done(undefined));
  add.addEventListener("click", () => {
    const target = input.value.trim();
    add.disabled = true;
    cancel.disabled = true;
    input.disabled = true;
    message.className = "atp-msg";
    message.textContent = "Adding…";
    // let the browser paint "Adding…" before the (synchronous) client call
    setTimeout(() => {
      const result = addItemToPackage(target, item.type, item.configId, item.name);
      if (result === null || "error" in result) {
        message.className = "atp-msg bad";
        const text = result === null ? "No Aras client to ask." : result.error;
        message.textContent = text.length > 300 ? `${text.slice(0, 150)} … ${text.slice(-150)}` : text;
        cancel.disabled = false;
        input.disabled = false;
        refresh();
        return;
      }
      try {
        localStorage.setItem("web-import-export-aras:last-package", target);
      } catch {
        // not saved
      }
      message.textContent = result.already ? `Already in ${target}.` : `Added to ${target}.`;
      setTimeout(() => done(target), 1200);
    }, 30);
  });
}
