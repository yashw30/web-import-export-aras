/**
 * Turns the engine's long failure text into one readable cause. A failed item arrives as `Import package 'x' failed with message:`,
 * then `Server error`, then `Request:` (the AML that was sent) and `Responce:` (the engine's spelling) with the server's SOAP fault.
 * The cause is in the fault and everything else is noise, so this finds it and keeps the full text for a "details" view.
 */

export interface Explained {
  /** The cause, as one line. */
  summary: string;
  /** Where it happened: the package, then the item type and name of the item that was being sent. Empty when unknown. */
  where: string;
  /** The package, when the text names one. */
  packageName: string;
  /** The whole original text. */
  raw: string;
}

const ENTITIES: Readonly<Record<string, string>> = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };

const unescapeXml = (text: string): string => text.replace(/&(quot|apos|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The text of a fault element, with its CDATA wrapper taken off. */
function faultText(response: string): string | undefined {
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/i.exec(response)?.[1];
  const legacy = /<af:legacy_detail>([\s\S]*?)<\/af:legacy_detail>/i.exec(response)?.[1];
  const exception = /<af:exception\b[^>]*\bmessage="([^"]*)"/i.exec(response)?.[1];
  for (const candidate of [fault, legacy, exception]) {
    if (candidate === undefined) continue;
    const text = oneLine(unescapeXml(candidate.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")));
    if (text !== "") return text;
  }
  return undefined;
}

/** The item the request was about: `Type "name" (action)`, from the first `Item` of the request. */
function requestItem(request: string): string {
  const open = /<Item\b([^>]*)>/i.exec(request)?.[1];
  if (open === undefined) return "";
  const attribute = (name: string): string | undefined => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(open)?.[1];
  const type = attribute("type");
  const action = attribute("action");
  const name = /<name>([^<]*)<\/name>/i.exec(request)?.[1] ?? attribute("keyed_name");
  if (type === undefined) return "";
  return `${type}${name === undefined || name === "" ? "" : ` "${unescapeXml(name)}"`}${action === undefined ? "" : ` (${action})`}`;
}

export function explainFailure(text: string): Explained {
  const raw = text;
  const packageName = /(?:Import|Export) package '([^']+)'/i.exec(text)?.[1] ?? "";
  // The engine writes `Request:` / `Responce:`; newer builds write `Request (formatted):` / `Response (formatted):`.
  const requestAt = text.search(/\bRequest(?:\s*\(formatted\))?\s*:/i);
  const responseAt = text.search(/\bRespon[cs]e(?:\s*\(formatted\))?\s*:/i);

  let request = "";
  let response = "";
  if (requestAt >= 0) {
    request = responseAt > requestAt ? text.slice(requestAt, responseAt) : text.slice(requestAt);
  }
  if (responseAt >= 0) response = text.slice(responseAt);

  // The fault may sit outside a labelled response (or the labels may be missing), so look in the whole text last.
  let summary = faultText(response) ?? faultText(text);
  if (summary === undefined) {
    // No fault to read: the first line that is not a heading is the best there is.
    const lines = text
      .split(/\r?\n/)
      .map(oneLine)
      .filter((line) => line !== "" && !/^\*+\s*errormessage\s*\*+$/i.test(line) && !/^server error$/i.test(line) && !/failed with message:?$/i.test(line));
    summary = lines[0] ?? oneLine(text);
  }

  const item = request === "" ? "" : requestItem(request);
  const where = [packageName === "" ? "" : `package ${packageName}`, item].filter((part) => part !== "").join(" · ");
  return { summary, where, packageName, raw };
}

/** A line of the engine's message stream is an error: the panel shows these as cards. */
export const isErrorLevel = (level: string): boolean => level.toLowerCase() === "error";
