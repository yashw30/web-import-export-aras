/**
 * What to export: whole packages, or chosen items (by type and id). The library takes one of the two per run
 * (`exportPackages({ packages })` or `exportPackages({ items })`), so a mixed selection is turned into items.
 */

export interface PackageElement {
  type: string;
  id: string;
  name: string;
}

export interface RequestedItem {
  type: string;
  id: string;
}

export interface Selection {
  /** Packages ticked as a whole. */
  packages: Set<string>;
  /** Items ticked one by one (or by type), keyed `type:id`. */
  items: Map<string, PackageElement>;
}

export const emptySelection = (): Selection => ({ packages: new Set(), items: new Map() });

export const elementKey = (element: Pick<PackageElement, "type" | "id">): string => `${element.type}:${element.id}`;

/** The elements of a package grouped by item type, types in alphabetical order and elements by name. */
export function groupByType(elements: readonly PackageElement[]): Array<[string, PackageElement[]]> {
  const groups = new Map<string, PackageElement[]>();
  for (const element of elements) {
    const group = groups.get(element.type);
    if (group === undefined) groups.set(element.type, [element]);
    else group.push(element);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => [type, list.sort((a, b) => a.name.localeCompare(b.name))]);
}

/** Elements whose name contains the text (case-insensitive), optionally of one type only. */
export function filterElements(elements: readonly PackageElement[], text: string, type = ""): PackageElement[] {
  const needle = text.trim().toLowerCase();
  return elements.filter((element) => (type === "" || element.type === type) && (needle === "" || element.name.toLowerCase().includes(needle)));
}

/** True when the selection asks for anything at all. */
export const hasSelection = (selection: Selection): boolean => selection.packages.size > 0 || selection.items.size > 0;

/** The packages whose contents `buildRequest` needs, which is every whole package of a selection that also has loose items. */
export function packagesNeedingContents(selection: Selection): string[] {
  return selection.items.size > 0 ? [...selection.packages] : [];
}

export type ExportRequest = { packages: string[] } | { items: RequestedItem[] };

/**
 * The request for the library. Only whole packages: `{ packages }`. Any loose item: `{ items }`, with the contents of the whole
 * packages added (they must be given in `contents`, by package name).
 */
export function buildRequest(selection: Selection, contents: ReadonlyMap<string, readonly PackageElement[]>): ExportRequest {
  if (!hasSelection(selection)) throw new Error("Nothing is selected to export.");
  if (selection.items.size === 0) return { packages: [...selection.packages].sort((a, b) => a.localeCompare(b)) };
  const items = new Map<string, RequestedItem>();
  for (const name of selection.packages) {
    const elements = contents.get(name);
    if (elements === undefined) throw new Error(`The contents of package ${name} are not loaded.`);
    for (const element of elements) items.set(elementKey(element), { type: element.type, id: element.id });
  }
  for (const element of selection.items.values()) items.set(elementKey(element), { type: element.type, id: element.id });
  return { items: [...items.values()] };
}

/** A line saying what the selection holds, for the button and the confirmation. */
export function describeSelection(selection: Selection): string {
  const parts: string[] = [];
  if (selection.packages.size > 0) parts.push(`${selection.packages.size} package${selection.packages.size === 1 ? "" : "s"}`);
  if (selection.items.size > 0) parts.push(`${selection.items.size} item${selection.items.size === 1 ? "" : "s"}`);
  return parts.join(" and ");
}
