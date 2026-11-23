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
