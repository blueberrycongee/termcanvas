import test from "node:test";
import assert from "node:assert/strict";

test("findExplicitReferences extracts cross-file markdown links", async () => {
  const { findExplicitReferences } = await import(
    `../electron/memory-index-generator.ts?tag-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "MEMORY.md",
      type: "index",
      body: `- [Auth project](project_auth.md) — auth setup\n- [DB feedback](feedback_db.md) — db tips`,
    },
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Auth setup notes.\n\nSee also [DB feedback](feedback_db.md) for migration tips.`,
    },
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: `Database tips and tricks.`,
    },
  ];

  const refs = findExplicitReferences(nodes);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].from, "project_auth.md");
  assert.equal(refs[0].to, "feedback_db.md");
});

test("findExplicitReferences ignores links to non-existent files", async () => {
  const { findExplicitReferences } = await import(
    `../electron/memory-index-generator.ts?nonexist-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: `See [missing](does_not_exist.md) for details.`,
    },
  ];

  const refs = findExplicitReferences(nodes);
  assert.equal(refs.length, 0);
});

test("findExplicitReferences ignores self-links", async () => {
  const { findExplicitReferences } = await import(
    `../electron/memory-index-generator.ts?self-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Refer back to [this file](project_auth.md) for context.`,
    },
  ];

  const refs = findExplicitReferences(nodes);
  assert.equal(refs.length, 0);
});

test("findTimeSensitiveMemories flags dates older than threshold", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?ts-old-${Date.now()}`
  );

  const oldDate = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Created on ${oldDate}, auth setup notes.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes);
  assert.equal(results.length, 1);
  assert.equal(results[0].fileName, "project_auth.md");
  assert.equal(results[0].date, oldDate);
  assert.ok(results[0].daysAgo >= 29);
});

test("findTimeSensitiveMemories ignores recent dates", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?ts-recent-${Date.now()}`
  );

  const today = new Date().toISOString().slice(0, 10);
  const nodes = [
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: `Updated on ${today}, all good.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes);
  assert.equal(results.length, 0);
});

test("findTimeSensitiveMemories skips index nodes", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?ts-index-${Date.now()}`
  );

  const oldDate = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const nodes = [
    {
      fileName: "MEMORY.md",
      type: "index",
      body: `Index created on ${oldDate}.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes);
  assert.equal(results.length, 0);
});

test("findTimeSensitiveMemories reports only one entry per file", async () => {
  const { findTimeSensitiveMemories } = await import(
    `../electron/memory-index-generator.ts?ts-one-${Date.now()}`
  );

  const oldDate1 = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const oldDate2 = new Date(Date.now() - 60 * 86400000)
    .toISOString()
    .slice(0, 10);
  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Started ${oldDate1}, revised ${oldDate2}.`,
    },
  ];

  const results = findTimeSensitiveMemories(nodes);
  assert.equal(results.length, 1);
});

test("generateEnhancedIndex produces full memory-graph block", async () => {
  const { generateEnhancedIndex } = await import(
    `../electron/memory-index-generator.ts?enh-full-${Date.now()}`
  );

  const oldDate = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const nodes = [
    {
      fileName: "MEMORY.md",
      type: "index",
      body: `- [Auth](project_auth.md)\n- [DB](feedback_db.md)`,
    },
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Auth notes.\nSee [DB feedback](feedback_db.md).\nCreated ${oldDate}.`,
    },
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: `Database tips.`,
    },
  ];

  const output = generateEnhancedIndex(nodes);
  assert.ok(output.includes('<memory-graph source="termcanvas">'));
  assert.ok(output.includes("</memory-graph>"));
  assert.ok(output.includes("## References"));
  assert.ok(output.includes("project_auth.md \u2192 feedback_db.md"));
  assert.ok(output.includes("## Time-sensitive"));
  assert.ok(output.includes(oldDate));
});

test("generateEnhancedIndex returns empty string when no signals", async () => {
  const { generateEnhancedIndex } = await import(
    `../electron/memory-index-generator.ts?enh-empty-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "plain.md",
      type: "feedback",
      body: `Just some plain text with no links or dates.`,
    },
  ];

  const output = generateEnhancedIndex(nodes);
  assert.equal(output, "");
});

test("generateEnhancedIndex omits sections with no entries", async () => {
  const { generateEnhancedIndex } = await import(
    `../electron/memory-index-generator.ts?enh-partial-${Date.now()}`
  );

  const nodes = [
    {
      fileName: "project_auth.md",
      type: "project",
      body: `Auth notes. See [DB feedback](feedback_db.md).`,
    },
    {
      fileName: "feedback_db.md",
      type: "feedback",
      body: `Database tips.`,
    },
  ];

  const output = generateEnhancedIndex(nodes);
  assert.ok(output.includes("## References"));
  assert.ok(!output.includes("## Time-sensitive"));
});
