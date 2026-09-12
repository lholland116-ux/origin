export type MarkdownTextBlock = {
  type: "text";
  content: string;
};

export type FencedCodeBlock = {
  type: "code";
  content: string;
  language: string | null;
};

export type MarkdownContentBlock = MarkdownTextBlock | FencedCodeBlock;

function getLanguage(infoString: string): string | null {
  const language = infoString.trim().split(/\s+/)[0];
  return language || null;
}

/**
 * Splits standard Markdown fenced code blocks from ordinary Markdown.
 *
 * The parser intentionally only treats a backtick run at the beginning of a
 * line as a fence. This preserves inline backticks and permits a longer fence
 * to contain shorter backtick runs in the code itself. An unfinished fence is
 * returned as a code block through the end of the message, which is safe for
 * streaming assistant responses.
 */
export function parseFencedCodeBlocks(content: string): MarkdownContentBlock[] {
  if (!content) {
    return [{ type: "text", content: "" }];
  }

  const blocks: MarkdownContentBlock[] = [];
  const openingFencePattern = /^ {0,3}(`{3,})([^\r\n]*)(?:\r?\n|$)/gm;
  const closingFencePattern = /^ {0,3}(`{3,})[ \t]*(?:\r?\n|$)/gm;
  let cursor = 0;
  let openingMatch: RegExpExecArray | null;

  while ((openingMatch = openingFencePattern.exec(content)) !== null) {
    const openingStart = openingMatch.index;

    if (openingStart > cursor) {
      blocks.push({ type: "text", content: content.slice(cursor, openingStart) });
    }

    const openingFenceLength = openingMatch[1].length;
    const codeStart = openingStart + openingMatch[0].length;
    let closingMatch: RegExpExecArray | null = null;

    closingFencePattern.lastIndex = codeStart;

    let candidateClosingMatch: RegExpExecArray | null;
    while ((candidateClosingMatch = closingFencePattern.exec(content)) !== null) {
      if (candidateClosingMatch[1].length >= openingFenceLength) {
        closingMatch = candidateClosingMatch;
        break;
      }
    }

    const codeEnd = closingMatch?.index ?? content.length;
    const blockEnd = closingMatch
      ? closingMatch.index + closingMatch[0].length
      : content.length;

    blocks.push({
      type: "code",
      content: content.slice(codeStart, codeEnd),
      language: getLanguage(openingMatch[2]),
    });

    cursor = blockEnd;

    if (!closingMatch) {
      break;
    }

    // The closing line also matches the opening-fence pattern. Resume the
    // outer scan after the complete block so it cannot become an empty block.
    openingFencePattern.lastIndex = cursor;
  }

  if (cursor < content.length) {
    blocks.push({ type: "text", content: content.slice(cursor) });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", content }];
}
