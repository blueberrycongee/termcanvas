import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function getMarkdownUtils() {
  if (typeof globalThis.window === "undefined") {
    (globalThis as any).window = new JSDOM("").window;
  }
  return import("../src/utils/markdownClass.ts");
}

test("sanitize removes script and event handlers", async () => {
  const { renderMarkdown } = await getMarkdownUtils();
  const html = renderMarkdown(
    '<script>bad</script><img src="x" onerror="alert(1)"><b>ok</b>',
  );
  assert.ok(!html.includes("<script>"), "script tag should be removed");
  assert.ok(!html.includes("onerror"), "event handler should be removed");
  assert.ok(html.includes("<b>ok</b>"), "safe content should survive");
});

test("tc-attachment URI survives sanitization", async () => {
  const { renderMarkdownWithAttachments } = await getMarkdownUtils();
  const html = renderMarkdownWithAttachments(
    "![](./pic.png)",
    "tc-attachment://local/test.png",
  );
  assert.ok(
    html.includes('src="tc-attachment://local/test.png'),
    "tc-attachment src should survive",
  );
});

test("plain markdown round-trips through sanitize", async () => {
  const { renderMarkdown } = await getMarkdownUtils();
  const html = renderMarkdown("**bold** and `code`");
  assert.ok(
    html.includes("<strong>bold</strong>") || html.includes("<b>bold</b>"),
    "bold should survive",
  );
  assert.ok(html.includes("<code>code</code>"), "code should survive");
});

test("html fragments render while unsafe handlers are stripped", async () => {
  const { renderMarkdownWithAttachments } = await getMarkdownUtils();
  const html = renderMarkdownWithAttachments(
    `<section>
      <h2>Plan</h2>
      <table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>
      <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red" onload="bad()" /></svg>
      <button onclick="bad()">Run</button>
    </section>`,
    undefined,
  );

  assert.ok(html.includes("<section>"), "html section should survive");
  assert.ok(html.includes("<table>"), "html table should survive");
  assert.ok(html.includes("<svg"), "svg should survive");
  assert.ok(!html.includes("onload"), "svg event handler should be removed");
  assert.ok(!html.includes("onclick"), "button event handler should be removed");
});

test("raw html image refs resolve against pin attachments", async () => {
  const { renderMarkdownWithAttachments } = await getMarkdownUtils();
  const html = renderMarkdownWithAttachments(
    '<a href="./pin-aa11.attachments/shot.png"><img src="./pin-aa11.attachments/shot.png"></a>',
    "tc-attachment://local/tmp/pin-aa11.attachments",
  );

  assert.ok(
    html.includes('src="tc-attachment://local/tmp/pin-aa11.attachments/shot.png"'),
    "raw html img src should resolve to the pin attachment URL",
  );
  assert.ok(
    html.includes('href="tc-attachment://local/tmp/pin-aa11.attachments/shot.png"'),
    "wrapping html link should follow the resolved attachment URL",
  );
  assert.ok(html.includes('loading="lazy"'), "raw html images should lazy-load");
});

test("full html documents get sandbox CSP while preserving local scripts", async () => {
  const {
    isHtmlDocument,
    renderHtmlDocumentWithAttachments,
  } = await getMarkdownUtils();
  const html = renderHtmlDocumentWithAttachments(
    `<!doctype html>
    <html>
      <head>
        <base href="https://example.com/">
        <meta http-equiv="Content-Security-Policy" content="default-src *">
        <style>body { color: red; }</style>
      </head>
      <body>
        <img src="./pin-aa11.attachments/shot.png">
        <script>window.clicked = true;</script>
      </body>
    </html>`,
    "tc-attachment://local/tmp/pin-aa11.attachments",
  );

  assert.equal(isHtmlDocument(html), true);
  assert.ok(
    html.includes("connect-src 'none'"),
    "sandbox document should receive TermCanvas CSP",
  );
  assert.ok(!html.includes("<base"), "base tags should be removed");
  assert.ok(!html.includes("default-src *"), "caller CSP should be replaced");
  assert.ok(html.includes("<style>"), "local styles should survive");
  assert.ok(html.includes("<script>"), "local scripts should survive");
  assert.ok(
    html.includes('src="tc-attachment://local/tmp/pin-aa11.attachments/shot.png"'),
    "full html doc image refs should resolve to pin attachments",
  );
});
