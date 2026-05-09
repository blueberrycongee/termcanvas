import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  PIN_RENDER_MAX_HEIGHT,
  PIN_RENDER_MAX_WIDTH,
  buildPinRenderHtml,
  getDefaultPinRenderPath,
  isPinHtmlDocument,
  normalizePinRenderOptions,
} from "../electron/pin-render-utils.ts";
import type { Pin } from "../shared/pin.ts";

function makePin(overrides: Partial<Pin> = {}): Pin {
  return {
    id: "render-pin-aa11",
    title: "Render pin",
    status: "open",
    repo: "/repo",
    body: "",
    links: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("default render path overwrites latest under repo .termcanvas", () => {
  assert.equal(
    getDefaultPinRenderPath("/repo", "pin-aa11"),
    path.join("/repo", ".termcanvas", "pin-renders", "pin-aa11", "latest.png"),
  );
});

test("normalizePinRenderOptions clamps dimensions and wait time", () => {
  const options = normalizePinRenderOptions("/repo", "pin-aa11", {
    width: 99999,
    height: 1,
    waitMs: 99999,
    fullPage: true,
  });

  assert.equal(options.width, PIN_RENDER_MAX_WIDTH);
  assert.equal(options.height, 240);
  assert.equal(options.waitMs, 5000);
  assert.equal(options.fullPage, true);
  assert.equal(
    options.outputPath,
    path.join("/repo", ".termcanvas", "pin-renders", "pin-aa11", "latest.png"),
  );
});

test("buildPinRenderHtml wraps markdown pins in a renderable document", () => {
  const html = buildPinRenderHtml(
    makePin({
      title: "A <title>",
      body: "![shot](./render-pin-aa11.attachments/shot.png)\n\n**bold**",
      attachmentsUrl: "tc-attachment://local/tmp/render-pin-aa11.attachments",
    }),
  );

  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<main>"));
  assert.ok(html.includes("&lt;title&gt;"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(
    html.includes(
      'src="tc-attachment://local/tmp/render-pin-aa11.attachments/shot.png"',
    ),
  );
});

test("buildPinRenderHtml prepares full html documents for sandboxed rendering", () => {
  const html = buildPinRenderHtml(
    makePin({
      body: `<!doctype html>
      <html>
        <head>
          <base href="https://example.com/">
          <meta http-equiv="Content-Security-Policy" content="default-src *">
        </head>
        <body><img src="./render-pin-aa11.attachments/shot.png"><script>window.ok = true</script></body>
      </html>`,
      attachmentsUrl: "tc-attachment://local/tmp/render-pin-aa11.attachments",
    }),
  );

  assert.equal(isPinHtmlDocument(html), true);
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!html.includes("<base"));
  assert.ok(!html.includes("default-src *"));
  assert.ok(html.includes("<script>window.ok = true</script>"));
  assert.ok(
    html.includes(
      'src="tc-attachment://local/tmp/render-pin-aa11.attachments/shot.png"',
    ),
  );
});
