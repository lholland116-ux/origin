import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessageContent } from "@/components/chat/ChatMessageContent";
import { parseFencedCodeBlocks } from "@/lib/chat/parse-fenced-code";

describe("parseFencedCodeBlocks", () => {
  it("keeps plain text as ordinary Markdown content", () => {
    expect(parseFencedCodeBlocks("Just a plain response.")).toEqual([
      { type: "text", content: "Just a plain response." },
    ]);
  });

  it("extracts a JSON fenced block and preserves its whitespace", () => {
    expect(
      parseFencedCodeBlocks('Here is the payload:\n```json\n{\n  "ok": true\n}\n```')
    ).toEqual([
      { type: "text", content: "Here is the payload:\n" },
      { type: "code", language: "json", content: '{\n  "ok": true\n}\n' },
    ]);
  });

  it("extracts a Python fenced block", () => {
    expect(parseFencedCodeBlocks("```python\ndef greet():\n    return 'hello'\n```"))
      .toEqual([
        { type: "code", language: "python", content: "def greet():\n    return 'hello'\n" },
      ]);
  });

  it("gives each fenced block its own code block", () => {
    expect(
      parseFencedCodeBlocks("Before\n```js\nconst a = 1;\n```\nBetween\n```sql\nselect 1;\n```\nAfter")
    ).toEqual([
      { type: "text", content: "Before\n" },
      { type: "code", language: "js", content: "const a = 1;\n" },
      { type: "text", content: "Between\n" },
      { type: "code", language: "sql", content: "select 1;\n" },
      { type: "text", content: "After" },
    ]);
  });

  it("supports an unlabeled fenced block", () => {
    expect(parseFencedCodeBlocks("```\nplain code\n```"))
      .toEqual([{ type: "code", language: null, content: "plain code\n" }]);
  });

  it("preserves arbitrary language identifiers", () => {
    expect(parseFencedCodeBlocks("```custom-language\nvalue\n```"))
      .toEqual([{ type: "code", language: "custom-language", content: "value\n" }]);
  });

  it("treats an incomplete streaming fence as a safe code block", () => {
    expect(parseFencedCodeBlocks("Answer so far:\n```typescript\nconst ready = true;"))
      .toEqual([
        { type: "text", content: "Answer so far:\n" },
        { type: "code", language: "typescript", content: "const ready = true;" },
      ]);
  });

  it("allows shorter backtick runs inside a longer fenced block", () => {
    expect(
      parseFencedCodeBlocks("````markdown\nUse `inline` code.\n```js\nconst value = 1;\n```\n````")
    ).toEqual([
      {
        type: "code",
        language: "markdown",
        content: "Use `inline` code.\n```js\nconst value = 1;\n```\n",
      },
    ]);
  });

  it("renders independent panels and copy controls for multiple code blocks", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatMessageContent, {
        content: "```json\n{\n  \"ok\": true\n}\n```\n\n```python\nprint('ok')\n```",
      })
    );

    expect(markup).toContain(">json</span>");
    expect(markup).toContain(">python</span>");
    expect((markup.match(/aria-label=\"Copy code\"/g) ?? []).length).toBe(2);
    expect(markup).toContain("&quot;ok&quot;");
    expect(markup).toContain("print(&#x27;ok&#x27;)");
  });
});
