import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { filesFromDirectory, filesFromZip, manifestsIn, matchManifestCase, packagePaths, stripTopFolder } from "./import-prep.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const MANIFEST = `<imports>
  <package name="a" path="CUSTOM_Package\\StructureCompare\\Import" />
  <package name="b" path="OOTB_Package\\"><dependson name="c" /></package>
</imports>`;

describe("import-prep", () => {
  it("reads the package paths of a manifest as written", () => {
    expect(packagePaths(MANIFEST)).toEqual(["CUSTOM_Package\\StructureCompare\\Import", "OOTB_Package\\"]);
  });

  it("renames folders that differ from the manifest only in case", () => {
    const files = { "imports.mf": bytes(MANIFEST), "CUSTOM_Package/structureCompare/Import/Method/m.xml": bytes("x"), "OOTB_Package/a.xml": bytes("y") };
    const { files: fixed, renamed } = matchManifestCase(files, MANIFEST);
    expect(renamed).toEqual(["CUSTOM_Package/structureCompare/Import -> CUSTOM_Package/StructureCompare/Import"]);
    expect(Object.keys(fixed).sort()).toEqual(["CUSTOM_Package/StructureCompare/Import/Method/m.xml", "OOTB_Package/a.xml", "imports.mf"]);
  });

  it("leaves a package alone when the case already matches", () => {
    const files = { "OOTB_Package/a.xml": bytes("y") };
    expect(matchManifestCase(files, MANIFEST).renamed).toEqual([]);
  });

  it("resolves package paths against the manifest's own folder", () => {
    const files = { "pkg/sub/CUSTOM_Package/structureCompare/Import/m.xml": bytes("x") };
    const { files: fixed } = matchManifestCase(files, MANIFEST, "pkg/sub");
    expect(Object.keys(fixed)).toEqual(["pkg/sub/CUSTOM_Package/StructureCompare/Import/m.xml"]);
  });

  it("takes off the single top folder of a zip", () => {
    const files = filesFromZip(zipSync({ "03_Schema/imports.mf": bytes("m"), "03_Schema/A/x.xml": bytes("x") }));
    expect(Object.keys(stripTopFolder(files)).sort()).toEqual(["A/x.xml", "imports.mf"]);
  });

  it("keeps paths when there is more than one top folder", () => {
    const files = { "a/x": bytes("1"), "b/y": bytes("2") };
    expect(stripTopFolder(files)).toBe(files);
  });

  it("finds manifests, the one nearest the root first", () => {
    const files = { "deep/er/other.mf": bytes(""), "imports.MF": bytes(""), "x.xml": bytes("") };
    expect(manifestsIn(files)).toEqual(["imports.MF", "deep/er/other.mf"]);
  });

  it("reads a folder into a map by path", async () => {
    const file = (name: string, text: string) => ({ kind: "file" as const, name, getFile: async () => ({ arrayBuffer: async () => bytes(text).buffer as ArrayBuffer }) });
    const folder = (name: string, entries: unknown[]) => ({ kind: "directory" as const, name, values: async function* () { yield* entries as never[]; } });
    const root = folder("root", [file("imports.mf", "m"), folder("A", [file("x.xml", "x")])]);
    const files = await filesFromDirectory(root);
    expect(Object.keys(files).sort()).toEqual(["A/x.xml", "imports.mf"]);
    expect(new TextDecoder().decode(files["A/x.xml"])).toBe("x");
  });
});
