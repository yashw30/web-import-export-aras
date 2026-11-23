import {
  type EngineWorker,
  type FsaDirectoryHandle,
  type RunSummary,
  type WorkerSession,
  MemoryVfs,
  commitToDirectory,
  createEngineWorker,
  createFetchTransport,
  describeFailure,
  planImport,
} from "import-export-libs-js/browser";
import { explainFailure, isErrorLevel } from "./errors.js";
import {
  type PackageElement,
  type Selection,
  buildRequest,
  describeSelection,
  elementKey,
  emptySelection,
  filterElements,
  groupByType,
  hasSelection,
  packagesNeedingContents,
} from "./export-select.js";
import {
  type PackageFiles,
  type ReadableDirectory,
  filesFromDirectory,
  filesFromZip,
  manifestsIn,
  matchManifestCase,
  stripTopFolder,
} from "./import-prep.js";
import { type OpenItem, type PageInfo, type TokenResult, findPackagesOf, listPackageContents, listPackages, probeAras, readOpenItem, readToken } from "./page-bridge.js";
import { workerUrl } from "./worker-url.js";

/**
 * The side panel. It finds the Aras tab you are on, reads the environment and the signed-in session from that tab, lists the
 * packages, and runs the library's export and import with that session: no URL, database or password to type. The library runs
 * here in the panel, in its Web Worker; its requests go out from the panel (the extension's host permission for the Aras origin lets
 * them through without CORS), and its bearer token is asked from the Aras tab each time it is needed.
 */

// ---------------------------------------------------------------------------------------------------------------- dom

/** The shadow root the panel lives in; set by `start`. */
let root!: ShadowRoot;

const $ = <T extends HTMLElement>(id: string): T => {
  const element = root.getElementById(id);
  if (element === null) throw new Error(`panel.html has no #${id}`);
  return element as T;
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== "") element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

// Export and Import each keep their own status, errors and log (the elements marked `data-r` inside each tab), so one never shows
// the other's. `area` is the tab a run started in.
type Area = "export" | "import";
let area: Area = "export";
const r = <T extends HTMLElement>(role: string, which: Area = area): T => {
  const element = root.querySelector<T>(`#tab-${which} [data-r="${role}"]`);
  if (element === null) throw new Error(`panel.html has no ${role} in ${which}`);
  return element;
};
const currentTab = (): Area => (root.querySelector<HTMLButtonElement>("[data-tab][aria-selected='true']")?.dataset.tab === "import" ? "import" : "export");
const logs: Record<Area, string[]> = { export: [], import: [] };
const errorCounts: Record<Area, number> = { export: 0, import: 0 };
// The log keeps only its last lines, so a very long run cannot fill the browser's memory.
const MAX_LOG = 1500;
const log = (text: string): void => {
  const lines = logs[area];
  lines.push(text);
  const box = r<HTMLPreElement>("log");
  if (lines.length > MAX_LOG + 200) {
    lines.splice(0, lines.length - MAX_LOG);
    box.textContent = `${lines.join("\n")}\n`;
  } else {
    box.textContent += `${text}\n`;
  }
  box.scrollTop = box.scrollHeight;
};
const setStatus = (text: string): void => {
  r("status").textContent = text;
  r("status").title = text;
};

/** A loading line with a spinner, so a wait never looks like a hang. */
function loadingLine(text: string): HTMLDivElement {
  const line = make("div", "loading");
  line.append(make("span", "spinner"), make("span", "", text));
  return line;
}

// -------------------------------------------------------------------------------------------------------- error cards


/** One failure as a card: the cause in a line, where it happened, and the full server text one click away. */
function addErrorCard(text: string): void {
  errorCounts[area] += 1;
  if (errorCounts[area] > 100) {
    // the log still has every one; the page does not need thousands of cards
    if (errorCounts[area] === 101) r("errors").append(make("div", "where", "More errors are in the log."));
    return;
  }
  const explained = explainFailure(text);
  const card = make("div", "card");
  card.append(make("div", "cause", explained.summary));
  if (explained.where !== "") card.append(make("div", "where", explained.where));
  if (explained.raw.trim() !== explained.summary) {
    const details = make("details");
    details.append(make("summary", "", "Full message from the server"));
    details.append(make("pre", "", explained.raw));
    card.append(details);
  }
  const tools = make("div", "tools");
  const copy = make("button", "", "Copy");
  copy.type = "button";
  copy.addEventListener("click", () => void navigator.clipboard.writeText(`${explained.summary}\n${explained.where}\n\n${explained.raw}`));
  tools.append(copy);
  card.append(tools);
  r("errors").append(card);
  card.scrollIntoView({ block: "nearest" });
}

function clearResults(which: Area = area): void {
  errorCounts[which] = 0;
  logs[which].length = 0;
  r("errors", which).replaceChildren();
  r("log", which).textContent = "";
  r("status", which).textContent = "";
  r("results", which).hidden = true;
  r<HTMLProgressElement>("progress", which).hidden = true;
}

function showSummary(summary: RunSummary): void {
  const line = make("div", summary.result === "success" ? "summary-ok" : "summary-bad");
  const errors = summary.messages.errors;
  const packages = summary.packages.length;
  line.textContent =
    summary.result === "success"
      ? `Done: ${packages} package${packages === 1 ? "" : "s"}, no errors.`
      : summary.result === "cancelled"
        ? "The run was cancelled."
        : `${summary.result}: ${errors} error${errors === 1 ? "" : "s"}${packages > 0 ? ` in ${packages} package${packages === 1 ? "" : "s"}` : ""}.`;
  r("errors").prepend(line);
}

// ---------------------------------------------------------------------------------------------------- remembered state


function openHandleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("aras-package-tools", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberHandle(key: string, handle: unknown): Promise<void> {
  try {
    const database = await openHandleStore();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // remembering a folder is a convenience only
  }
}

async function recallHandle<T>(key: string): Promise<T | undefined> {
  try {
    const database = await openHandleStore();
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction("handles").objectStore("handles").get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

type Permissioned = { requestPermission?(options: { mode: "read" | "readwrite" }): Promise<string> };

async function allowed(handle: unknown, mode: "read" | "readwrite"): Promise<boolean> {
  const request = (handle as Permissioned).requestPermission;
  return request === undefined ? true : (await request.call(handle, { mode })) === "granted";
}

// ------------------------------------------------------------------------------------------------------ the Aras tab

interface Environment {
  origin: string;
  /** The server address as the library takes it: `https://host/InnovatorServer`. */
  url: string;
  database: string;
  userName: string;
}

let environment: Environment | undefined;

/** The address the library wants, from the client's own server address or, failing that, the page address up to `/Client`. */
function serverUrlOf(info: PageInfo): string {
  const fromBase = info.serverBase
    .replace(/\/Server\/InnovatorServer\.aspx.*$/i, "")
    .replace(/\/Server\/?$/i, "")
    .replace(/\/+$/, "");
  if (fromBase !== "") return fromBase;
  const page = new URL(info.pageUrl);
  const cut = page.pathname.search(/\/Client(\/|$)/i);
  return page.origin + (cut >= 0 ? page.pathname.slice(0, cut) : "");
}

/** The script runs inside the Aras page, so the client is simply `window.aras`. */
async function findEnvironment(): Promise<Environment> {
  const info = probeAras();
  if (info === null) throw new Error("This page is not an Aras Innovator client (no `aras` object).");
  if (info.database === "") throw new Error("The Aras client did not report its database.");
  return { origin: location.origin, url: serverUrlOf(info), database: info.database, userName: info.userName };
}

async function tokenFromPage(): Promise<string> {
  const result: TokenResult | null = await readToken();
  if (result?.token !== undefined) return result.token;
  throw new Error(`Could not read the session token from the Aras client. ${result?.error ?? "No Aras client."}`);
}

function needEnvironment(): Environment {
  if (environment === undefined) throw new Error("Connect to the Aras tab first.");
  return environment;
}

// ------------------------------------------------------------------------------------------------------- the engine

interface Callbacks {
  signal: AbortSignal;
  onMessage: (message: { level: string; text: string }) => void;
  onProgress: (event: { phase: string; package: string | undefined; item?: { type: string; name: string }; index?: number; total?: number }) => void;
}

const callbacks = (signal: AbortSignal): Callbacks => ({
  signal,
  onMessage: (message) => {
    log(`[${message.level}] ${message.text}`);
    if (isErrorLevel(message.level)) addErrorCard(message.text);
  },
  onProgress: (event) => {
    const bar = r<HTMLProgressElement>("progress");
    if (event.phase === "package" && event.package !== undefined) setStatus(`${event.package}…`);
    if (event.phase === "item" && event.index !== undefined && event.total !== undefined) {
      bar.hidden = false;
      bar.max = event.total;
      bar.value = event.index;
      // one fixed line (clipped by the layout), so the log below does not move
      setStatus(`${event.package ?? ""} · ${event.index} of ${event.total}`);
    }
  },
});

/** One logged-in session on a new Worker, closed again when the work is done. */
async function withSession<T>(env: Environment, work: (worker: EngineWorker, session: WorkerSession) => Promise<T>): Promise<T> {
  const worker = createEngineWorker({ worker: workerUrl() });
  try {
    const session = await worker.connect({
      url: env.url,
      database: env.database,
      engine: "auto",
      tokenProvider: { getAccessToken: () => tokenFromPage() },
      // sent from this page, where the extension's host permission applies (no CORS)
      transport: createFetchTransport(),
    });
    log(`Connected to ${env.url} (${env.database}) as ${session.userName}; Aras ${session.serverVersionText}, engine ${session.engine}.`);
    return await work(worker, session);
  } finally {
    // Stops the Worker without sending the logoff: the session belongs to the Aras tab, and must stay signed in.
    await worker.dispose({ force: true });
  }
}

let currentAbort: AbortController | undefined;

const BUSY_BUTTONS = [
  "connect",
  "disconnect",
  "export-run",
  "export-reload",
  "pick-export-folder",
  "import-pick-mf",
  "import-run",
];

/**
 * The folder pickers exist only on a secure page (https, or localhost). An Aras served over plain http (an address like
 * http://192.168.0.55/...) has none, so there the export is a zip and the import reads a folder through a file input.
 */
const hasFolderPicker = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

function setBusy(busy: boolean): void {
  for (const id of BUSY_BUTTONS) $<HTMLButtonElement>(id).disabled = busy;
  if (!hasFolderPicker) $<HTMLButtonElement>("pick-export-folder").disabled = true;
  r("spin").hidden = !busy;
  for (const button of root.querySelectorAll<HTMLButtonElement>(".abort-btn")) button.disabled = !busy;
}

async function run(title: string, work: (signal: AbortSignal) => Promise<void>, options: { clear?: boolean } = {}): Promise<void> {
  area = currentTab();
  if (options.clear !== false) clearResults();
  // the connect at start stays quiet: its panel (status, log) only shows when there is something to say
  if (title !== "Connecting") r("results").hidden = false;
  currentAbort = new AbortController();
  setBusy(true);
  setStatus(`${title}…`);
  try {
    await work(currentAbort.signal);
    setStatus(`${title}: finished.`);
  } catch (error) {
    // an abort that stops a picker or a run is not a failure
    if (error instanceof DOMException && error.name === "AbortError") {
      setStatus(`${title}: cancelled.`);
    } else {
      const text = describeFailure(error);
      log(`ERROR: ${text}`);
      addErrorCard(text);
      setStatus(`${title}: failed.`);
    }
  } finally {
    setBusy(false);
    currentAbort = undefined;
    r<HTMLProgressElement>("progress").hidden = true;
  }
}

// ------------------------------------------------------------------------------------------------------- export tree

const selection: Selection = emptySelection();
const contents = new Map<string, PackageElement[]>();
const expandedPackages = new Set<string>();
const expandedTypes = new Set<string>();
const loading = new Set<string>();
let packageNames: string[] = [];
let exportDir: FsaDirectoryHandle | undefined;

/** The packages the filter lets through (by package name, or by an item the filter finds in a package already opened). */
function shownPackages(): string[] {
  const filter = $<HTMLInputElement>("export-filter").value;
  const needle = filter.trim().toLowerCase();
  return packageNames.filter((name) => {
    if (needle === "" || name.toLowerCase().includes(needle)) return true;
    const elements = contents.get(name);
    return elements !== undefined && filterElements(elements, filter).length > 0;
  });
}

function updateSummary(): void {
  const shown = shownPackages();
  const ticked = shown.filter((name) => selection.packages.has(name)).length;
  const all = $<HTMLInputElement>("select-all");
  all.checked = shown.length > 0 && ticked === shown.length;
  all.indeterminate = ticked > 0 && ticked < shown.length;
  all.disabled = shown.length === 0;
  $("export-summary").hidden = !hasSelection(selection);
  $("export-summary").textContent = hasSelection(selection) ? `Selected: ${describeSelection(selection)}.` : "";
  $<HTMLButtonElement>("export-run").textContent = hasSelection(selection) ? `Export ${describeSelection(selection)}` : "Export selected";
}

async function loadContents(name: string): Promise<PackageElement[]> {
  const known = contents.get(name);
  if (known !== undefined) return known;
  const env = needEnvironment();
  const answer = listPackageContents(name);
  if (answer === null) throw new Error(`No frame of the tab could read the contents of ${name}.`);
  if ("error" in answer) throw new Error(`Reading the contents of ${name} failed: ${answer.error}`);
  contents.set(name, answer.elements);
  return answer.elements;
}

function checkbox(checked: boolean, indeterminate: boolean, onChange: (checked: boolean) => void, label: string): HTMLInputElement {
  const box = make("input");
  box.type = "checkbox";
  box.checked = checked;
  box.indeterminate = indeterminate;
  box.setAttribute("aria-label", label);
  box.addEventListener("change", () => onChange(box.checked));
  return box;
}

function toggleButton(open: boolean, onClick: () => void): HTMLButtonElement {
  const button = make("button", "toggle", open ? "▾" : "▸");
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function renderTree(): void {
  const tree = $("export-tree");
  const filter = $<HTMLInputElement>("export-filter").value;
  const needle = filter.trim().toLowerCase();
  tree.replaceChildren();
  let shown = 0;

  for (const name of packageNames) {
    const elements = contents.get(name);
    const nameMatches = needle === "" || name.toLowerCase().includes(needle);
    const itemMatches = needle !== "" && elements !== undefined && filterElements(elements, filter).length > 0;
    if (!nameMatches && !itemMatches) continue;
    shown += 1;

    const row = make("div", "node");
    const open = expandedPackages.has(name) || (itemMatches && !nameMatches);
    row.append(
      toggleButton(open, () => {
        if (expandedPackages.has(name)) expandedPackages.delete(name);
        else {
          expandedPackages.add(name);
          if (!contents.has(name) && !loading.has(name)) {
            loading.add(name);
            void loadContents(name)
              .catch((error: unknown) => addErrorCard(error instanceof Error ? error.message : String(error)))
              .finally(() => {
                loading.delete(name);
                renderTree();
              });
          }
        }
        renderTree();
      }),
      checkbox(selection.packages.has(name), false, (on) => {
        if (on) selection.packages.add(name);
        else selection.packages.delete(name);
        updateSummary();
      }, `Export package ${name}`),
      make("span", "", name),
    );
    tree.append(row);
    if (!open) continue;

    if (elements === undefined) {
      tree.append(loading.has(name) ? loadingLine("Loading contents…") : make("div", "loading", "Contents not loaded."));
      continue;
    }
    for (const [type, list] of groupByType(filterElements(elements, filter))) {
      const typeKey = `${name}|${type}`;
      const selectedCount = list.filter((element) => selection.items.has(elementKey(element))).length;
      const typeRow = make("div", "node l1");
      const typeOpen = expandedTypes.has(typeKey) || (needle !== "" && !nameMatches);
      typeRow.append(
        toggleButton(typeOpen, () => {
          if (expandedTypes.has(typeKey)) expandedTypes.delete(typeKey);
          else expandedTypes.add(typeKey);
          renderTree();
        }),
        checkbox(selectedCount === list.length, selectedCount > 0 && selectedCount < list.length, (on) => {
          for (const element of list) {
            if (on) selection.items.set(elementKey(element), element);
            else selection.items.delete(elementKey(element));
          }
          updateSummary();
          renderTree();
        }, `All ${type} items of ${name}`),
        make("span", "", type),
        make("span", "count", `(${list.length})`),
      );
      tree.append(typeRow);
      if (!typeOpen) continue;
      const LIMIT = 200;
      if (list.length > LIMIT) tree.append(make("div", "loading", `Showing the first ${LIMIT} of ${list.length}; narrow it with the filter (the type's box still ticks all ${list.length}).`));
      for (const element of list.slice(0, LIMIT)) {
        const itemRow = make("div", "node l2");
        itemRow.append(
          checkbox(selection.items.has(elementKey(element)), false, (on) => {
            if (on) selection.items.set(elementKey(element), element);
            else selection.items.delete(elementKey(element));
            updateSummary();
            renderTree();
          }, `${type} ${element.name}`),
          make("span", "", element.name),
        );
        tree.append(itemRow);
      }
    }
  }
  if (shown === 0) tree.append(make("div", "loading", packageNames.length === 0 ? "No packages." : "No package or item matches the filter."));
  updateSummary();
}

// ------------------------------------------------------------------------------------------------------------ connect

async function readPackageList(env: Environment): Promise<void> {
  $("export-tree").replaceChildren(loadingLine("Loading packages…"));
  // let the browser paint the message before the (possibly long) read starts
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const answer = listPackages();
  if (answer === null) throw new Error("No frame of the tab could list the packages.");
  if ("error" in answer) throw new Error(`Listing the packages failed: ${answer.error}`);
  packageNames = answer.names;
  contents.clear();
  selection.packages.clear();
  selection.items.clear();
  expandedPackages.clear();
  expandedTypes.clear();
  renderTree();
  log(`${packageNames.length} packages on the server.`);
}

function showEnvironment(env: Environment): void {
  const link = $<HTMLAnchorElement>("env-url");
  link.textContent = env.url;
  link.href = env.url;
  $("env-db").textContent = env.database;
  $("env-user").textContent = env.userName === "" ? "" : `(${env.userName})`;
  $("env-box").hidden = false;
}

async function connect(): Promise<void> {
  const env = await findEnvironment();
  const same = environment !== undefined && environment.url === env.url && environment.database === env.database && packageNames.length > 0;
  environment = env;
  showEnvironment(env);
  log(`Found the Aras client: ${env.url}, database ${env.database}.`);
  $("work").hidden = false;
  $("connect").hidden = true;
  $("disconnect").hidden = false;
  if (!same) await readPackageList(env);
  try {
    await applyOpenItem(env);
  } catch (error) {
    log(`Open item: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** If an item is open in the Aras tab, preselect it in the export list and say which package holds it. */
async function applyOpenItem(_env: Environment): Promise<void> {
  const item: OpenItem | undefined = readOpenItem() ?? undefined;
  const box = $("context");
  if (item === undefined) {
    box.hidden = true;
    return;
  }
  box.replaceChildren(loadingLine(`Open item: ${item.type} ${item.name}…`));
  box.hidden = false;
  const found = findPackagesOf(item.id, item.type, item.name);
  if (found === null || "error" in found) {
    box.textContent = `Open item: ${item.type} "${item.name}". ${found === null ? "" : `Could not look up its package: ${found.error}`}`;
    return;
  }
  if (found.names.length === 0) {
    box.textContent = `Open item: ${item.type} "${item.name}" is not in any package.`;
    return;
  }
  const names = found.names;
  const text = make("div", "", `Open item: ${item.type} "${item.name}" · in ${names.join(", ")}. Select it for export?`);
  const tools = make("div", "tools");
  const yes = make("button", "primary", "Yes");
  const no = make("button", "", "No");
  yes.type = "button";
  no.type = "button";
  no.addEventListener("click", () => {
    box.hidden = true;
  });
  yes.addEventListener("click", () => {
    box.replaceChildren(loadingLine("Finding the item in its package…"));
    $("export-tree").replaceChildren(loadingLine("Finding the item in its package…"));
    void run(
      "Selecting the item",
      async () => {
        selection.packages.clear();
        selection.items.clear();
        for (const name of names) {
          const elements = await loadContents(name);
          const element =
            elements.find((candidate) => candidate.id.toUpperCase() === item.id.toUpperCase()) ??
            elements.find((candidate) => candidate.type === item.type && candidate.name === item.name);
          if (element === undefined) continue;
          selection.items.set(elementKey(element), element);
          expandedPackages.add(name);
          expandedTypes.add(`${name}|${element.type}`);
        }
        $<HTMLInputElement>("export-filter").value = "";
        root.querySelector<HTMLButtonElement>('[data-tab="export"]')?.click();
      },
      { clear: false },
    ).finally(() => {
      box.hidden = true;
      renderTree();
      $("export-tree").querySelector(".node.l2")?.scrollIntoView({ block: "center" });
    });
  });
  tools.append(yes, no);
  box.replaceChildren(text, tools);
}

function disconnect(): void {
  environment = undefined;
  packageNames = [];
  contents.clear();
  selection.packages.clear();
  selection.items.clear();
  expandedPackages.clear();
  expandedTypes.clear();
  importFiles = undefined;
  importManifest = "";
  loading.clear();
  currentAbort?.abort();
  clearResults("export");
  clearResults("import");
  for (const id of ["env-box", "work", "context", "disconnect", "import-box", "import-source", "import-mf"]) $(id).hidden = true;
  $("export-tree").replaceChildren();
  $("import-list").replaceChildren();
  $("connect").hidden = false;
}

// ------------------------------------------------------------------------------------------------------------ export

const stamp = (): string => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

async function chooseExportFolder(): Promise<FsaDirectoryHandle> {
  if (!hasFolderPicker) throw new Error("This page is not secure (plain http), so the browser offers no folder picker. Save as a zip instead.");
  const handle = await showDirectoryPicker({ mode: "readwrite", id: "aras-export", startIn: exportDir ?? "downloads" });
  exportDir = handle;
  $("export-folder-name").textContent = handle.name;
  await rememberHandle("export-folder", handle);
  return handle;
}

async function exportRun(signal: AbortSignal, everything: boolean): Promise<void> {
  const env = needEnvironment();
  // "A folder" is the one chosen before (the picker opens in Downloads the first time); or a zip download.
  const mode = $<HTMLInputElement>("out-zip").checked || !hasFolderPicker ? "zip" : "folder";
  const toFolder = mode === "folder";

  // The picker needs the click that started this run, so the folder is settled before anything slow.
  let target: FsaDirectoryHandle | undefined;
  if (toFolder) {
    target = exportDir;
    if (target === undefined || !(await allowed(target, "readwrite"))) target = await chooseExportFolder();
  }

  let request: { packages: string[] } | { items: Array<{ type: string; id: string }> } | { allPackages: true };
  if (everything) {
    request = { allPackages: true };
  } else {
    for (const name of packagesNeedingContents(selection)) await loadContents(name);
    request = buildRequest(selection, contents);
  }

  await withSession(env, async (worker, session) => {
    log(everything ? "Exporting all packages…" : `Exporting ${describeSelection(selection)}…`);
    const result = await worker.exportPackages(session, {
      ...request,
      exportReferencedItems: $<HTMLInputElement>("export-referenced").checked,
      ...(mode === "zip" ? { zip: true } : {}),
      ...callbacks(signal),
    });
    showSummary(result.summary);
    if (result.summary.aborted) {
      log("The export was cancelled; nothing was saved.");
      return;
    }
    if (target !== undefined) {
      const tree = new MemoryVfs();
      const mount: Record<string, Uint8Array> = {};
      for (const [path, bytes] of result.files) mount[`/${path}`] = bytes;
      tree.mount(mount);
      const destination = await target.getDirectoryHandle(`export-${env.database}-${stamp()}`, { create: true });
      const written = await commitToDirectory(tree, destination, { signal });
      log(`Wrote ${written.files} files into ${target.name}/${destination.name}.`);
    } else if (result.zip !== undefined) {
      downloadBytes(`export-${env.database}-${stamp()}.zip`, result.zip, "application/zip");
      log(`Exported ${result.files.size} files; saved as a zip download.`);
    } else {
      log("The export produced no files.");
    }
  });
}

function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const link = make("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ------------------------------------------------------------------------------------------------------------ import

let importFiles: PackageFiles | undefined;
let importManifest = "";

async function loadPackage(files: PackageFiles, label: string): Promise<void> {
  const manifests = manifestsIn(files);
  if (manifests.length === 0) throw new Error(`${label} has no .mf manifest file in it.`);
  const select = $<HTMLSelectElement>("import-mf");
  select.replaceChildren(...manifests.map((path) => new Option(path, path)));
  select.hidden = manifests.length === 1;
  importFiles = files;
  const source = $("import-source");
  source.textContent = `Source: ${label}`;
  source.hidden = false;
  if (manifests.length > 1) log(`${manifests.length} manifests found; pick the one to use.`);
  planSelectedManifest(label);
}

function planSelectedManifest(label: string): void {
  const files = importFiles;
  if (files === undefined) return;
  const manifest = $<HTMLSelectElement>("import-mf").value;
  const manifestFolder = manifest.includes("/") ? manifest.slice(0, manifest.lastIndexOf("/")) : "";
  const text = new TextDecoder().decode(files[manifest]);
  const fixed = matchManifestCase(files, text, manifestFolder);
  for (const change of fixed.renamed) log(`[note] folder case differed from the manifest and was matched: ${change}`);
  importFiles = fixed.files;
  importManifest = `/${manifest}`;
  const tree = new MemoryVfs(Object.fromEntries(Object.entries(fixed.files).map(([path, bytes]) => [`/${path}`, bytes.slice()])));
  const plan = planImport({ source: tree, manifestPath: importManifest });
  const list = $("import-list");
  list.replaceChildren();
  for (const name of plan.order) {
    const entry = plan.packages.find((candidate) => candidate.name === name);
    const row = make("label");
    const box = make("input");
    box.type = "checkbox";
    box.value = name;
    box.checked = true;
    row.append(box, ` ${name}`);
    if (entry !== undefined) row.append(make("span", "count", `  ${entry.folder}`));
    list.append(row);
  }
  for (const warning of plan.warnings) log(`[warning] ${warning}`);
  log(`${label}: manifest ${manifest}, ${plan.order.length} packages, in import order.`);
  $("import-box").hidden = false;
}

/** The main way in: the `.mf` file, then its folder (the picker opens beside the manifest, so it is one confirm). */
async function pickManifest(): Promise<void> {
  const lastFolder = await recallHandle<FsaDirectoryHandle>("import-folder");
  const [file] = await showOpenFilePicker({
    id: "aras-manifest",
    types: [{ description: "Aras package manifest", accept: { "text/xml": [".mf"] } }],
    ...(lastFolder === undefined ? {} : { startIn: lastFolder }),
  });
  if (file === undefined) return;
  // A browser cannot see the folder beside a picked file. But a folder the person allowed before can be asked where the file lies in it
  // (`resolve`), so a .mf inside a remembered folder needs no second pick.
  type Rooted = FsaDirectoryHandle & {
    resolve(possibleDescendant: unknown): Promise<string[] | null>;
    requestPermission(descriptor: { mode: "read" }): Promise<string>;
  };
  let directory: FsaDirectoryHandle | undefined;
  const root = await recallHandle<Rooted>("import-root");
  if (root !== undefined) {
    try {
      if ((await root.requestPermission({ mode: "read" })) === "granted") {
        const path = await root.resolve(file);
        if (path !== null && path.length >= 1) {
          let current: FsaDirectoryHandle = root;
          for (const part of path.slice(0, -1)) current = await current.getDirectoryHandle(part);
          directory = current;
        }
      }
    } catch {
      // fall through to asking
    }
  }
  if (directory === undefined) {
    setStatus(`Allow the folder that holds ${file.name}, or a parent of it: later manifests inside it open with one click.`);
    const picked = await showDirectoryPicker({ mode: "read", id: "aras-package-folder", startIn: file });
    await rememberHandle("import-root", picked);
    const rooted = picked as Rooted;
    const path = await rooted.resolve(file).catch(() => null);
    if (path === null) throw new Error(`${file.name} is not inside the folder "${picked.name}". Choose the folder that contains the .mf file, or a parent of it.`);
    let walk: FsaDirectoryHandle = picked;
    for (const part of path.slice(0, -1)) walk = await walk.getDirectoryHandle(part);
    directory = walk;
  }
  const dir: FsaDirectoryHandle = directory;
  await rememberHandle("import-folder", dir);
  setStatus("Reading the package…");
  const files = await filesFromDirectory(dir as unknown as ReadableDirectory, (path) => {
    if (path.endsWith(".mf")) log(`found ${path}`);
  });
  await loadPackage(files, `${dir.name}/${file.name}`);
  // the manifest the person picked is the one to use, even when the folder holds others
  const select = $<HTMLSelectElement>("import-mf");
  if (select.querySelector(`option[value="${CSS.escape(file.name)}"]`) !== null && select.value !== file.name) {
    select.value = file.name;
    planSelectedManifest(`${dir.name}/${file.name}`);
  }
}

async function readZip(): Promise<void> {
  const file = $<HTMLInputElement>("import-file").files?.[0];
  if (file === undefined) return;
  await loadPackage(stripTopFolder(filesFromZip(new Uint8Array(await file.arrayBuffer()))), file.name);
}

async function readFolderInput(): Promise<void> {
  const list = [...($<HTMLInputElement>("import-folder").files ?? [])];
  if (list.length === 0) return;
  const files: PackageFiles = {};
  for (const file of list) files[file.webkitRelativePath === "" ? file.name : file.webkitRelativePath] = new Uint8Array(await file.arrayBuffer());
  await loadPackage(stripTopFolder(files), list[0]?.webkitRelativePath.split("/")[0] ?? "folder");
}

async function importSelected(signal: AbortSignal): Promise<void> {
  const env = needEnvironment();
  if (importFiles === undefined) throw new Error("Choose a manifest (.mf), a package zip or a folder first.");
  const packages = [...$("import-list").querySelectorAll<HTMLInputElement>("input:checked")].map((box) => box.value);
  if (packages.length === 0) throw new Error("Tick at least one package to import.");

  const files = importFiles;
  const merge = $<HTMLInputElement>("import-merge").checked;
  await withSession(env, async (worker, session) => {
    log(`Importing ${packages.join(", ")}${merge ? " (merge mode)" : ""}…`);
    // the buffers are handed to the Worker, so each run gets its own copies
    const copy = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, bytes.slice()]));
    const result = await worker.importPackages(session, {
      source: { files: copy },
      manifestPath: importManifest,
      packages,
      ...(merge ? { merge: true } : {}),
      ...callbacks(signal),
    });
    showSummary(result.summary);
  });
}

// ------------------------------------------------------------------------------------------------------------- wiring

/** Mounts the panel's behaviour on its shadow root. Returns `refresh`, for the shortcut pressed while the panel is open. */
export function start(shadow: ShadowRoot): { refresh(): void } {
  root = shadow;
  if (!hasFolderPicker) {
    $<HTMLInputElement>("out-zip").checked = true;
    $<HTMLInputElement>("out-folder").disabled = true;
    $<HTMLButtonElement>("pick-export-folder").disabled = true;
    $("export-folder-name").textContent = "needs https; saving a zip";
    $("import-pick-mf").textContent = "Select package folder…";
  }
  void recallHandle<FsaDirectoryHandle>("export-folder").then((handle) => {
    if (handle !== undefined) {
      exportDir = handle;
      $("export-folder-name").textContent = handle.name;
    }
  });
  // ------------------------------------------------------------------------------------------------------------- wiring

  
  $("connect").addEventListener("click", () => void run("Connecting", () => connect()));
  $("disconnect").addEventListener("click", disconnect);
  // Opened by the shortcut: connect at once.
  let startupNote = "";
  void run(
    "Connecting",
    async () => {
      try {
        await connect();
      } catch (error) {
        // not an Aras tab (or no client yet): say so quietly, no error card
        startupNote = error instanceof Error ? error.message : String(error);
      }
    },
    { clear: false },
  ).then(() => {
    if (environment !== undefined) return;
    r("results").hidden = false;
    setStatus(startupNote);
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>(".abort-btn")) {
    button.addEventListener("click", () => {
      currentAbort?.abort();
      setStatus("Aborting…");
    });
  }
  for (const which of ["export", "import"] as const) {
    r(`log-download`, which).addEventListener("click", () =>
      downloadBytes(`aras-package-tools-${which}-${stamp()}.log`, new TextEncoder().encode(logs[which].join("\n")), "text/plain"),
    );
  }

  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  $("export-filter").addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(renderTree, 150);
  });
  $("export-none").addEventListener("click", () => {
    selection.packages.clear();
    selection.items.clear();
    renderTree();
  });
  $("export-reload").addEventListener("click", () => void run("Reloading packages", () => readPackageList(needEnvironment()), { clear: false }));
  $("pick-export-folder").addEventListener("click", () => void run("Choosing folder", async () => void (await chooseExportFolder()), { clear: false }));
  $("export-run").addEventListener("click", () => void run("Export", (signal) => exportRun(signal, false)));
  $<HTMLInputElement>("select-all").addEventListener("change", (event) => {
    const on = (event.target as HTMLInputElement).checked;
    for (const name of shownPackages()) {
      if (on) selection.packages.add(name);
      else selection.packages.delete(name);
    }
    renderTree();
  });

  $("import-pick-mf").addEventListener("click", () => {
    // no file picker for a manifest without https: choose the package folder instead (its .mf is found inside)
    if (!hasFolderPicker) $("import-folder").click();
    else void run("Reading the package", pickManifest);
  });
  $("import-pick-zip").addEventListener("click", (event) => {
    event.preventDefault();
    $("import-file").click();
  });
  $("import-pick-folder").addEventListener("click", (event) => {
    event.preventDefault();
    $("import-folder").click();
  });
  $("import-file").addEventListener("change", () => void run("Reading the package", readZip));
  $("import-folder").addEventListener("change", () => void run("Reading the package", readFolderInput));
  $("import-mf").addEventListener("change", () => void run("Reading the manifest", async () => planSelectedManifest("package"), { clear: false }));
  $("import-run").addEventListener("click", () => void run("Import", importSelected));

  for (const tab of root.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    tab.addEventListener("click", () => {
      for (const other of root.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
        other.setAttribute("aria-selected", String(other === tab));
        $(`tab-${other.dataset.tab}`).hidden = other !== tab;
      }
    });
  }
  
  return {
    refresh() {
      if (currentAbort !== undefined) return;
      void run(
        "Connecting",
        async () => {
          try {
            await connect();
          } catch {
            // not an Aras client: nothing to refresh
          }
        },
        { clear: false },
      );
    },
  };
}
