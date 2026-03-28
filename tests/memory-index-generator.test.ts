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
