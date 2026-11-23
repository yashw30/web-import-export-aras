import source from "virtual:worker-source";

let url: string | undefined;

/** The engine's Web Worker, started from a Blob made of its bundled source (a userscript has no file to point a Worker at). */
export const workerUrl = (): string => {
  url ??= URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  return url;
};
