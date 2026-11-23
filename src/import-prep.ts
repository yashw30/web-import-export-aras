import { unzipSync } from "fflate";

/**
 * Getting a package ready for the engine, whatever it came from (a manifest and its folder, a zip, a dropped folder): one map of
 * files by path, with no leading slash and the single top folder taken off. Pure functions, so they are tested without a browser.
 */

export type PackageFiles = Record<string, Uint8Array>;

/** Takes off the one folder that every path starts with (a zip of a folder has it), as the library does for a zip. */
export function stripTopFolder(files: PackageFiles): PackageFiles {
  const paths = Object.keys(files);
  const first = paths[0]?.split("/")[0];
  if (first === undefined || !paths.every((path) => path.startsWith(`${first}/`))) return files;
  return Object.fromEntries(paths.map((path) => [path.slice(first.length + 1), files[path] as Uint8Array]));
}

/** The files of a zip, with folder entries left out. */
export function filesFromZip(bytes: Uint8Array): PackageFiles {
  const files: PackageFiles = {};
  for (const [path, content] of Object.entries(unzipSync(bytes))) if (!path.endsWith("/")) files[path] = content;
  return files;
}

/** The manifests (`.mf`) in a package, the one nearest the root first. */
export function manifestsIn(files: PackageFiles): string[] {
  return Object.keys(files)
    .filter((path) => path.toLowerCase().endsWith(".mf"))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

/** The `path` of every `package` of a manifest, as written. */
export function packagePaths(manifestText: string): string[] {
  return [...manifestText.matchAll(/<package\b[^>]*?\bpath\s*=\s*"([^"]*)"/gi)].map((match) => match[1] as string);
}

/**
 * The engine runs on Windows, where `structureCompare` and `StructureCompare` are one folder; the library's tree tells them apart.
 * A manifest and a package that disagree only in letter case import fine with the real tool, so the folders are renamed here to the
 * manifest's spelling (the files inside are untouched).
 */
export function matchManifestCase(files: PackageFiles, manifestText: string, manifestFolder = ""): { files: PackageFiles; renamed: string[] } {
  const renamed: string[] = [];
  let current = files;
  for (const written of packagePaths(manifestText)) {
    const relative = written.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (relative === "") continue;
    const wanted = manifestFolder === "" ? relative : `${manifestFolder}/${relative}`;
    const lower = `${wanted.toLowerCase()}/`;
    const sample = Object.keys(current).find((path) => path.toLowerCase().startsWith(lower));
    if (sample === undefined) continue;
    const actual = sample.slice(0, wanted.length);
    if (actual === wanted) continue;
    const next: PackageFiles = {};
    for (const [path, bytes] of Object.entries(current)) {
      next[path.toLowerCase().startsWith(lower) ? `${wanted}/${path.slice(wanted.length + 1)}` : path] = bytes;
    }
    current = next;
    renamed.push(`${actual} -> ${wanted}`);
  }
  return { files: current, renamed };
}

/** The part of a directory handle that reading a folder needs (the real handle has more). */
export interface ReadableDirectory {
  readonly name: string;
  values(): AsyncIterable<ReadableEntry>;
}
export type ReadableEntry =
  | { readonly kind: "file"; readonly name: string; getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> }
  | ({ readonly kind: "directory"; readonly name: string } & ReadableDirectory);

/** Reads every file under a folder into a map by path from that folder. */
export async function filesFromDirectory(root: ReadableDirectory, onFile?: (path: string) => void): Promise<PackageFiles> {
  const files: PackageFiles = {};
  const walk = async (directory: ReadableDirectory, prefix: string): Promise<void> => {
    for await (const entry of directory.values()) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.kind === "directory") {
        await walk(entry, path);
      } else {
        files[path] = new Uint8Array(await (await entry.getFile()).arrayBuffer());
        onFile?.(path);
      }
    }
  };
  await walk(root, "");
  return files;
}
