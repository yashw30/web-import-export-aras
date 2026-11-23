// The File System Access pickers (Chromium). Declared here because the DOM typings of this TypeScript version lack them.
type PickerStartIn = FsaPickerHandle | "documents" | "downloads" | "desktop";
interface FsaPickerHandle {
  readonly kind: "file" | "directory";
  readonly name: string;
}
interface FsaPickerFile extends FsaPickerHandle {
  readonly kind: "file";
  getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; name: string }>;
}
declare function showOpenFilePicker(options?: {
  multiple?: boolean;
  startIn?: PickerStartIn;
  id?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  excludeAcceptAllOption?: boolean;
}): Promise<FsaPickerFile[]>;
declare function showDirectoryPicker(options?: {
  mode?: "read" | "readwrite";
  startIn?: PickerStartIn;
  id?: string;
}): Promise<import("../../src/browser.js").FsaDirectoryHandle>;
