import { describe, expect, it } from "vitest";
import { buildRequest, describeSelection, emptySelection, filterElements, groupByType, packagesNeedingContents, type PackageElement } from "./export-select.js";

const els: PackageElement[] = [
  { type: "Method", id: "M2", name: "sg_b" },
  { type: "ItemType", id: "I1", name: "sg_Part" },
  { type: "Method", id: "M1", name: "sg_a" },
];

describe("export selection", () => {
  it("groups by type, types and names in order", () => {
    expect(groupByType(els).map(([type, list]) => [type, list.map((e) => e.name)])).toEqual([
      ["ItemType", ["sg_Part"]],
      ["Method", ["sg_a", "sg_b"]],
    ]);
  });

  it("filters by name text and type", () => {
    expect(filterElements(els, "SG_A").map((e) => e.id)).toEqual(["M1"]);
    expect(filterElements(els, "", "Method").map((e) => e.id)).toEqual(["M2", "M1"]);
  });

  it("whole packages alone become a packages request, sorted", () => {
    const selection = emptySelection();
    selection.packages.add("b");
    selection.packages.add("a");
    expect(buildRequest(selection, new Map())).toEqual({ packages: ["a", "b"] });
  });

  it("loose items become an items request", () => {
    const selection = emptySelection();
    selection.items.set("Method:M1", els[2] as PackageElement);
    expect(buildRequest(selection, new Map())).toEqual({ items: [{ type: "Method", id: "M1" }] });
  });

  it("a whole package next to loose items is expanded to its items, with no repeats", () => {
    const selection = emptySelection();
    selection.packages.add("p");
    selection.items.set("Method:M1", els[2] as PackageElement);
    expect(packagesNeedingContents(selection)).toEqual(["p"]);
    const request = buildRequest(selection, new Map([["p", els]]));
    expect("items" in request && request.items.map((i) => i.id).sort()).toEqual(["I1", "M1", "M2"]);
  });

  it("refuses an empty selection and unloaded contents", () => {
    expect(() => buildRequest(emptySelection(), new Map())).toThrow(/Nothing is selected/);
    const selection = emptySelection();
    selection.packages.add("p");
    selection.items.set("Method:M1", els[2] as PackageElement);
    expect(() => buildRequest(selection, new Map())).toThrow(/not loaded/);
  });

  it("describes the selection", () => {
    const selection = emptySelection();
    selection.packages.add("p");
    selection.items.set("Method:M1", els[2] as PackageElement);
    expect(describeSelection(selection)).toBe("1 package and 1 item");
  });
});
