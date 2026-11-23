/**
 * The functions the panel runs inside the Aras tab (`chrome.scripting.executeScript`, `world: "MAIN"`), where the Aras client's own
 * `aras` object lives. Each one is sent to the page as source text, so it must be self-contained: no imports, and no reference to
 * anything outside its own body.
 *
 * Which `aras.*` call gives the token differs between builds and could not be checked against a live server while this was
 * written. `readToken` tries the known ones in turn and says which one answered (or what the page has), so a failure is
 * diagnosable from the panel's log.
 */

// biome-ignore lint/suspicious/noExplicitAny: the page's `aras` object has no declarations.
type Aras = Record<string, any>;

export interface PageInfo {
  /** `aras.getServerBaseURL()` as the page reports it, or empty. */
  serverBase: string;
  /** The page's own address. */
  pageUrl: string;
  database: string;
  userName: string;
}

export interface TokenResult {
  token?: string;
  /** Which call gave it. */
  via?: string;
  /** Why none did, and what the page offers. */
  error?: string;
}

/** The environment of the Aras client in this frame, or `null` when this frame is not one. Never returns the token. */
export function probeAras(): PageInfo | null {
  const aras = (() => {
    for (const candidate of [window]) {
      try {
        const found = (candidate as unknown as { aras?: Aras } | null)?.aras;
        if (found !== undefined && typeof found.getDatabase === "function") return found;
      } catch {
        // a cross-origin top window cannot be read
      }
    }
    return undefined;
  })();
  if (aras === undefined || typeof aras.getDatabase !== "function") return null;
  const text = (call: () => unknown): string => {
    try {
      const value = call();
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };
  return {
    serverBase: text(() => aras.getServerBaseURL()) || text(() => aras.getServerURL()),
    pageUrl: window.location.href,
    database: text(() => aras.getDatabase()),
    userName: text(() => aras.getLoginName()),
  };
}

/** The Aras client's current access token, as the page itself would send it. */
export async function readToken(): Promise<TokenResult | null> {
  const aras = (() => {
    for (const candidate of [window]) {
      try {
        const found = (candidate as unknown as { aras?: Aras } | null)?.aras;
        if (found !== undefined && typeof found.getDatabase === "function") return found;
      } catch {
        // a cross-origin top window cannot be read
      }
    }
    return undefined;
  })();
  if (aras === undefined || typeof aras.getDatabase !== "function") return null;

  const bare = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value === "") return undefined;
    return value.replace(/^Bearer\s+/i, "");
  };
  const candidates: Array<[string, () => unknown]> = [
    ["aras.OAuthClient.getAuthorizationHeader()", () => aras.OAuthClient.getAuthorizationHeader()?.Authorization],
    ["aras.OAuthClient.getToken()", () => aras.OAuthClient.getToken()],
    [
      "aras.getHttpHeadersForSoapMessage()",
      () => {
        const headers: unknown = aras.getHttpHeadersForSoapMessage();
        if (Array.isArray(headers)) {
          const pair = headers.find((entry: unknown) => Array.isArray(entry) && String(entry[0]).toLowerCase() === "authorization");
          return pair === undefined ? undefined : (pair as unknown[])[1];
        }
        if (headers !== null && typeof headers === "object") {
          const key = Object.keys(headers).find((name) => name.toLowerCase() === "authorization");
          return key === undefined ? undefined : (headers as Record<string, unknown>)[key];
        }
        return undefined;
      },
    ],
  ];
  const failures: string[] = [];
  for (const [via, call] of candidates) {
    try {
      const token = bare(await call());
      if (token !== undefined) return { token, via };
      failures.push(`${via}: no token returned`);
    } catch (error) {
      failures.push(`${via}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const oauth = aras.OAuthClient;
  const offered = oauth !== null && typeof oauth === "object" ? Object.keys(oauth).join(", ") : "(no aras.OAuthClient)";
  return { error: `${failures.join("; ")}. aras.OAuthClient offers: ${offered}` };
}

/** The names of the packages on this server, read through the client's own IOM (so with the signed-in user's rights). */
export function listPackages(): { names: string[] } | { error: string } | null {
  const aras = (() => {
    for (const candidate of [window]) {
      try {
        const found = (candidate as unknown as { aras?: Aras } | null)?.aras;
        if (found !== undefined && typeof found.getDatabase === "function") return found;
      } catch {
        // a cross-origin top window cannot be read
      }
    }
    return undefined;
  })();
  if (aras === undefined || typeof aras.newIOMInnovator !== "function") return null;
  try {
    const innovator = aras.newIOMInnovator();
    const query = innovator.newItem("PackageDefinition", "get");
    query.setAttribute("select", "name");
    query.setProperty("name", "%");
    query.setPropertyCondition("name", "like");
    query.setAttribute("orderBy", "name");
    const result = query.apply();
    if (result.isError()) {
      // "No items of type PackageDefinition found" is an empty list, not a failure
      const code = typeof result.getErrorCode === "function" ? String(result.getErrorCode()) : "";
      return code === "0" ? { names: [] } : { error: String(result.getErrorString()) };
    }
    const names: string[] = [];
    const count = Number(result.getItemCount());
    for (let index = 0; index < count; index += 1) names.push(String(result.getItemByIndex(index).getProperty("name")));
    return { names };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface ContentsResult {
  elements: Array<{ type: string; id: string; name: string }>;
}

/** The items a package holds (`PackageDefinition > PackageGroup > PackageElement`), read through the client's own IOM. */
export function listPackageContents(packageName: string): ContentsResult | { error: string } | null {
  const aras = (() => {
    for (const candidate of [window]) {
      try {
        const found = (candidate as unknown as { aras?: Aras } | null)?.aras;
        if (found !== undefined && typeof found.getDatabase === "function") return found;
      } catch {
        // a cross-origin top window cannot be read
      }
    }
    return undefined;
  })();
  if (aras === undefined || typeof aras.newIOMInnovator !== "function") return null;
  try {
    const innovator = aras.newIOMInnovator();
    const definition = innovator.newItem("PackageDefinition", "get");
    definition.setAttribute("select", "name");
    definition.setProperty("name", packageName);
    const group = innovator.newItem("PackageGroup", "get");
    group.setAttribute("select", "name");
    const element = innovator.newItem("PackageElement", "get");
    element.setAttribute("select", "element_type,element_id,name");
    group.addRelationship(element);
    definition.addRelationship(group);
    const result = definition.apply();
    if (result.isError()) {
      const code = typeof result.getErrorCode === "function" ? String(result.getErrorCode()) : "";
      return code === "0" ? { elements: [] } : { error: String(result.getErrorString()) };
    }
    const elements: Array<{ type: string; id: string; name: string }> = [];
    const groups = result.getRelationships("PackageGroup");
    const groupCount = Number(groups.getItemCount());
    for (let g = 0; g < groupCount; g += 1) {
      const members = groups.getItemByIndex(g).getRelationships("PackageElement");
      const count = Number(members.getItemCount());
      for (let m = 0; m < count; m += 1) {
        const member = members.getItemByIndex(m);
        elements.push({ type: String(member.getProperty("element_type")), id: String(member.getProperty("element_id")), name: String(member.getProperty("name") ?? "") });
      }
    }
    return { elements };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface OpenItem {
  type: string;
  id: string;
  name: string;
  /** Whether this frame is on screen (an Aras tab that is not the current one holds its item in a hidden frame). */
  visible: boolean;
  /** How deep the frame is; the deepest visible one is the item being worked on. */
  depth: number;
}

/**
 * The item open in the Aras tab that is on screen. Aras 14 keeps every open tab as an iframe of the main window (`aras tabs`), each
 * with its own `thisItem`; the one whose frame is displayed is the one being worked on. `null` when that tab shows no item
 * (a search grid, for instance).
 */
export function readOpenItem(): OpenItem | null {
  // biome-ignore lint/suspicious/noExplicitAny: the page's window has no declarations.
  const page: any = window;
  const tabIds: unknown = page.arasTabs?.tabs;
  if (!Array.isArray(tabIds)) return null;
  // The frames of all open tabs sit on top of each other, so being on screen proves nothing: the selected tab is the one that counts.
  const selected: unknown = page.arasTabs?.selectedTab;
  const candidates: unknown[] = typeof selected === "string" && selected !== "" ? [selected] : tabIds;
  for (const tabId of candidates) {
    try {
      const frame = document.getElementById(String(tabId)) as HTMLIFrameElement | null;
      if (frame === null || frame.getClientRects().length === 0 || getComputedStyle(frame).visibility === "hidden") continue;
      // biome-ignore lint/suspicious/noExplicitAny: the tab's window has no declarations.
      const item: any = (frame.contentWindow as any)?.thisItem;
      const id = item?.getID?.();
      const type = item?.getType?.();
      if (typeof id !== "string" || id === "" || typeof type !== "string" || type === "") continue;
      const name = String(item.getProperty?.("keyed_name") || item.getProperty?.("name") || "");
      return { type, id, name, visible: true, depth: 1 };
    } catch {
      // another tab
    }
  }
  return null;
}

/** The packages that hold this item: by its id (`PackageElement.element_id`), else by type and name; read through the client's own IOM. */
export function findPackagesOf(itemId: string, itemType: string, itemName: string): { names: string[] } | { error: string } | null {
  const aras = (() => {
    for (const candidate of [window]) {
      try {
        const found = (candidate as unknown as { aras?: Aras } | null)?.aras;
        if (found !== undefined && typeof found.getDatabase === "function") return found;
      } catch {
        // a cross-origin top window cannot be read
      }
    }
    return undefined;
  })();
  if (aras === undefined || typeof aras.newIOMInnovator !== "function") return null;
  try {
    const innovator = aras.newIOMInnovator();
    const lookup = (filter: Record<string, string>): string[] => {
      const definition = innovator.newItem("PackageDefinition", "get");
      definition.setAttribute("select", "name");
      const group = innovator.newItem("PackageGroup", "get");
      group.setAttribute("select", "name");
      const element = innovator.newItem("PackageElement", "get");
      element.setAttribute("select", "element_id");
      for (const [key, value] of Object.entries(filter)) element.setProperty(key, value);
      group.addRelationship(element);
      definition.addRelationship(group);
      const result = definition.apply();
      if (result.isError()) {
        const code = typeof result.getErrorCode === "function" ? String(result.getErrorCode()) : "";
        if (code === "0") return [];
        throw new Error(String(result.getErrorString()));
      }
      const names: string[] = [];
      const count = Number(result.getItemCount());
      for (let index = 0; index < count; index += 1) names.push(String(result.getItemByIndex(index).getProperty("name")));
      return names;
    };
    let names = lookup({ element_id: itemId });
    // a versioned item (a Method, a Form) may be listed under another generation's id: fall back to its type and name
    if (names.length === 0 && itemName !== "") names = lookup({ element_type: itemType, name: itemName });
    return { names };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export interface FoundElement {
  package: string;
  type: string;
  id: string;
  name: string;
}

/** Packaged items whose name contains `text` (one query for every package), read through the client's own IOM. */
export function findElementsByName(text: string, limit: number): { found: FoundElement[] } | { error: string } | null {
  const aras = (() => {
    for (const candidate of [window]) {
      try {
        const found = (candidate as unknown as { aras?: Aras } | null)?.aras;
        if (found !== undefined && typeof found.getDatabase === "function") return found;
      } catch {
        // not readable
      }
    }
    return undefined;
  })();
  if (aras === undefined || typeof aras.newIOMInnovator !== "function") return null;
  try {
    const innovator = aras.newIOMInnovator();
    const query = innovator.newItem("PackageElement", "get");
    query.setAttribute("select", "element_type,element_id,name,source_id(source_id(name))");
    query.setAttribute("maxRecords", String(limit));
    query.setProperty("name", `%${text}%`);
    query.setPropertyCondition("name", "like");
    const result = query.apply();
    if (result.isError()) {
      const code = typeof result.getErrorCode === "function" ? String(result.getErrorCode()) : "";
      return code === "0" ? { found: [] } : { error: String(result.getErrorString()) };
    }
    const found: Array<{ package: string; type: string; id: string; name: string }> = [];
    const count = Number(result.getItemCount());
    for (let index = 0; index < count; index += 1) {
      const element = result.getItemByIndex(index);
      let packageName = "";
      try {
        packageName = String(element.getPropertyItem("source_id")?.getPropertyItem("source_id")?.getProperty("name") ?? "");
      } catch {
        // the package name stays empty
      }
      if (packageName === "") continue;
      found.push({ package: packageName, type: String(element.getProperty("element_type")), id: String(element.getProperty("element_id")), name: String(element.getProperty("name") ?? "") });
    }
    return { found };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
