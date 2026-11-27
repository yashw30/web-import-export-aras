declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.css" {
  const text: string;
  export default text;
}
declare module "virtual:worker-source" {
  const source: string;
  export default source;
}
interface Window {
  __webImportExportAras?: true;
}

declare const __BUILD__: { commit: string; dirty: boolean; time: string };
interface Window {
  /** Set by the GitHub loader: the commit whose compiled.js it fetched. */
  __wieaBuild?: { commit: string };
}
