import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TaskStore, TaskStoreError } from "../electron/task-store.ts";
import type { Task } from "../shared/task.ts";

function freshStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-tasks-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-tasks-repo-"));
  return { store: new TaskStore(root), root, repo };
}

test("create + get round-trip preserves fields", () => {
  const { store, repo } = freshStore();
  const created = store.create({
    title: "drawer 在 resize 时抖动",
    repo,
    body: "details about the bug",
    links: [{ type: "github_issue", url: "https://github.com/x/y/issues/1", id: "1" }],
  });

  assert.match(created.id, /^drawer-[a-z0-9-]+$/);
  assert.equal(created.title, "drawer 在 resize 时抖动");
  assert.equal(created.status, "open");
  assert.equal(created.body, "details about the bug");
  assert.deepEqual(created.links, [
    { type: "github_issue", url: "https://github.com/x/y/issues/1", id: "1" },
  ]);

  const fetched = store.get(repo, created.id);
  assert.deepEqual(fetched, created);
});

test("list returns tasks for a repo, sorted newest first", async () => {
  const { store, repo } = freshStore();
  const a = store.create({ title: "first", repo });
  await new Promise((r) => setTimeout(r, 5));
  const b = store.create({ title: "second", repo });

  const items = store.list(repo);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, b.id);
  assert.equal(items[1].id, a.id);
});

test("list isolates tasks per repo", () => {
  const { store, repo } = freshStore();
  const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-tasks-repo-"));
  store.create({ title: "for repo A", repo });
  store.create({ title: "for repo B", repo: otherRepo });
  assert.equal(store.list(repo).length, 1);
  assert.equal(store.list(otherRepo).length, 1);
});

test("update mutates fields and bumps updated timestamp", async () => {
  const { store, repo } = freshStore();
  const created = store.create({ title: "old title", repo });
  await new Promise((r) => setTimeout(r, 5));

  const updated = store.update(repo, created.id, {
    title: "new title",
    status: "done",
    body: "new body",
  });
  assert.equal(updated.title, "new title");
  assert.equal(updated.status, "done");
  assert.equal(updated.body, "new body");
  assert.equal(updated.created, created.created);
  assert.notEqual(updated.updated, created.updated);
});

test("update rejects unknown status", () => {
  const { store, repo } = freshStore();
  const created = store.create({ title: "x", repo });
  assert.throws(
    () => store.update(repo, created.id, { status: "weird" as never }),
    (err) => err instanceof TaskStoreError && err.status === 400,
  );
});

test("update on missing task throws 404", () => {
  const { store, repo } = freshStore();
  assert.throws(
    () => store.update(repo, "missing-abcd", { title: "x" }),
    (err) => err instanceof TaskStoreError && err.status === 404,
  );
});

test("remove deletes the task file", () => {
  const { store, repo } = freshStore();
  const created = store.create({ title: "to delete", repo });
  store.remove(repo, created.id);
  assert.equal(store.get(repo, created.id), null);
});

test("remove on missing task throws 404", () => {
  const { store, repo } = freshStore();
  assert.throws(
    () => store.remove(repo, "missing-abcd"),
    (err) => err instanceof TaskStoreError && err.status === 404,
  );
});

test("create rejects empty title", () => {
  const { store, repo } = freshStore();
  assert.throws(
    () => store.create({ title: "   ", repo }),
    (err) => err instanceof TaskStoreError && err.status === 400,
  );
});

test("get with malformed id is rejected", () => {
  const { store, repo } = freshStore();
  assert.throws(
    () => store.get(repo, "../etc/passwd"),
    (err) => err instanceof TaskStoreError && err.status === 400,
  );
});

test("title with quotes / colons survives round-trip", () => {
  const { store, repo } = freshStore();
  const created = store.create({
    title: 'fix "scroll: y" in long files',
    repo,
  });
  const fetched = store.get(repo, created.id);
  assert.equal(fetched?.title, 'fix "scroll: y" in long files');
});

test("create emits task:created event with task and repo", () => {
  const { store, repo } = freshStore();
  let fired: { task: Task; repo: string } | null = null;
  store.on("task:created", (payload: { task: Task; repo: string }) => {
    fired = payload;
  });
  const task = store.create({ title: "test event", repo });
  assert.ok(fired !== null, "event was not fired");
  assert.deepEqual(fired!.task, task);
  assert.equal(fired!.repo, task.repo);
});

test("update emits task:updated event with updated task and resolved repo", () => {
  const { store, repo } = freshStore();
  let fired: { task: Task; repo: string } | null = null;
  const created = store.create({ title: "original", repo });
  store.on("task:updated", (payload: { task: Task; repo: string }) => {
    fired = payload;
  });
  const updated = store.update(repo, created.id, { status: "done" });
  assert.ok(fired !== null, "event was not fired");
  assert.deepEqual(fired!.task, updated);
  assert.equal(fired!.repo, path.resolve(repo));
});

test("remove emits task:removed event with id and resolved repo", () => {
  const { store, repo } = freshStore();
  let fired: { id: string; repo: string } | null = null;
  const created = store.create({ title: "to remove", repo });
  store.on("task:removed", (payload: { id: string; repo: string }) => {
    fired = payload;
  });
  store.remove(repo, created.id);
  assert.ok(fired !== null, "event was not fired");
  assert.equal(fired!.id, created.id);
  assert.equal(fired!.repo, path.resolve(repo));
});

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("saveAttachment writes file and returns relative + absolute paths", () => {
  const { store, repo } = freshStore();
  const created = store.create({ title: "with image", repo });

  const result = store.saveAttachment(
    repo,
    created.id,
    "screenshot.png",
    PNG_HEADER,
  );

  assert.match(
    result.relativePath,
    new RegExp(`^\\./${created.id}\\.attachments/[a-f0-9]{6}\\.png$`),
  );
  assert.equal(path.isAbsolute(result.absolutePath), true);
  assert.ok(fs.existsSync(result.absolutePath));
  assert.deepEqual(fs.readFileSync(result.absolutePath), PNG_HEADER);

  const dir = store.attachmentsDir(repo, created.id);
  assert.equal(path.dirname(result.absolutePath), dir);
});

test("remove also deletes the attachments directory", () => {
  const { store, repo } = freshStore();
  const created = store.create({ title: "to delete with attachments", repo });
  const result = store.saveAttachment(
    repo,
    created.id,
    "shot.png",
    PNG_HEADER,
  );
  const dir = store.attachmentsDir(repo, created.id);
  assert.ok(fs.existsSync(dir));
  assert.ok(fs.existsSync(result.absolutePath));

  store.remove(repo, created.id);

  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(result.absolutePath), false);
});

test("saveAttachment rejects unsafe filenames", () => {
  const { store, repo } = freshStore();
  const created = store.create({ title: "safe", repo });

  const result = store.saveAttachment(
    repo,
    created.id,
    "../../../etc/passwd.png",
    PNG_HEADER,
  );

  const dir = store.attachmentsDir(repo, created.id);
  assert.ok(
    result.absolutePath.startsWith(dir + path.sep),
    `expected absolutePath ${result.absolutePath} to be inside ${dir}`,
  );
  assert.ok(
    result.relativePath.startsWith(`./${created.id}.attachments/`),
    `expected relativePath ${result.relativePath} to stay under task attachments`,
  );
  assert.equal(result.relativePath.includes(".."), false);
  assert.equal(result.relativePath.includes("/etc/"), false);
});
