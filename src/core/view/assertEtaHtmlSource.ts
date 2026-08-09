const HTML_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "blockquote",
  "body",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "map",
  "mark",
  "menu",
  "meter",
  "nav",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "search",
  "section",
  "select",
  "slot",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

const TAG_PATTERN = "([a-z][a-z0-9]*)";
const CLASS_OR_ID_PATTERN = "[.#][\\w-]+";
const CLASS_ID_SHORTHAND = new RegExp(`^${TAG_PATTERN}(?:${CLASS_OR_ID_PATTERN})+`);
const ATTRIBUTE_SHORTHAND = new RegExp(`^${TAG_PATTERN}(?:${CLASS_OR_ID_PATTERN})*\\s+[\\w:-]+=`);
const TAG_SHORTHAND = new RegExp(`^${TAG_PATTERN}(?:>|\\s+\\S|$)`);

function htmlTagName(match: RegExpMatchArray | null): string | undefined {
  const tag = match?.[1];
  return tag && HTML_TAGS.has(tag) ? tag : undefined;
}

function describePugLikeLine(line: string): string | undefined {
  if (/^\|(?:\s|$)/.test(line)) {
    return "piped text";
  }

  if (htmlTagName(line.match(CLASS_ID_SHORTHAND))) {
    return "class/id shorthand";
  }

  if (htmlTagName(line.match(ATTRIBUTE_SHORTHAND))) {
    return "attribute shorthand";
  }

  if (htmlTagName(line.match(TAG_SHORTHAND))) {
    return "tag shorthand";
  }

  return undefined;
}

function updateSkipBlock(
  lower: string,
  skipBlock: "script" | "style" | "comment" | null,
): "script" | "style" | "comment" | null {
  if (skipBlock) {
    if (skipBlock === "comment" && lower.includes("-->")) {
      return null;
    }

    if (skipBlock !== "comment" && lower.includes(`</${skipBlock}`)) {
      return null;
    }

    return skipBlock;
  }

  if (lower.startsWith("<!--") && !lower.includes("-->")) {
    return "comment";
  }

  if (lower.startsWith("<script") && !lower.includes("</script")) {
    return "script";
  }

  if (lower.startsWith("<style") && !lower.includes("</style")) {
    return "style";
  }

  return null;
}

/**
 * Throws when an .eta source still uses Pug shorthand instead of HTML + Eta tags.
 */
function assertEtaHtmlSource(templateName: string, source: string): void {
  let skipBlock: "script" | "style" | "comment" | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    const nextSkipBlock = updateSkipBlock(lower, skipBlock);

    if (skipBlock || nextSkipBlock) {
      skipBlock = nextSkipBlock;
      continue;
    }

    if (trimmed.startsWith("<") || trimmed.startsWith("<%")) {
      continue;
    }

    const kind = describePugLikeLine(trimmed);

    if (kind) {
      throw new Error(
        `Eta view "${templateName}" contains Pug-like markup (${kind}: ${trimmed}). Eta views must be HTML + <% %> tags, not Pug.`,
      );
    }
  }
}

export { assertEtaHtmlSource };
