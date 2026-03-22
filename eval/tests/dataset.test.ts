import { describe, it, assert } from "node:test";
import { strict as a } from "node:assert";
import { countPatchFiles, countPatchLines, taskMeta } from "../src/dataset.ts";
import type { TaskDefinition } from "../src/types.ts";

const SAMPLE_PATCH = `diff --git a/django/contrib/admin/options.py b/django/contrib/admin/options.py
--- a/django/contrib/admin/options.py
+++ b/django/contrib/admin/options.py
@@ -100,6 +100,7 @@
 class ModelAdmin:
     pass
+    new_line = True

diff --git a/django/contrib/admin/sites.py b/django/contrib/admin/sites.py
--- a/django/contrib/admin/sites.py
+++ b/django/contrib/admin/sites.py
@@ -50,7 +50,8 @@
-old_line = False
+new_line = True
+another_line = True

diff --git a/tests/admin/test_options.py b/tests/admin/test_options.py
--- a/tests/admin/test_options.py
+++ b/tests/admin/test_options.py
@@ -10,6 +10,10 @@
+def test_new():
+    pass
+
+def test_another():
+    pass
`;

describe("countPatchFiles", () => {
  it("counts files in a multi-file patch", () => {
    const files = countPatchFiles(SAMPLE_PATCH);
    a.equal(files.length, 3);
    a.deepEqual(files, [
      "django/contrib/admin/options.py",
      "django/contrib/admin/sites.py",
      "tests/admin/test_options.py",
    ]);
  });

  it("returns empty for empty patch", () => {
    a.deepEqual(countPatchFiles(""), []);
  });

  it("handles single file patch", () => {
    const patch = `diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1 +1,2 @@
+new_line`;
    a.equal(countPatchFiles(patch).length, 1);
  });
});

describe("countPatchLines", () => {
  it("counts added and removed lines", () => {
    const lines = countPatchLines(SAMPLE_PATCH);
    a.equal(lines, 9);
  });

  it("returns 0 for empty patch", () => {
    a.equal(countPatchLines(""), 0);
  });
});

describe("taskMeta", () => {
  it("derives metadata from task definition", () => {
    const task: TaskDefinition = {
      instance_id: "django__django-12345",
      repo: "django/django",
      base_commit: "abc123",
      problem_statement: "Fix the bug",
      hints_text: "",
      patch: SAMPLE_PATCH,
      test_patch: "",
      FAIL_TO_PASS: "[]",
      PASS_TO_PASS: "[]",
      version: "3.2",
      environment_setup_commit: "def456",
      created_at: "2023-01-01",
    };

    const meta = taskMeta(task);
    a.equal(meta.instance_id, "django__django-12345");
    a.equal(meta.repo, "django/django");
    a.equal(meta.num_files, 3);
    a.equal(meta.num_lines, 9);
    a.equal(meta.files_changed.length, 3);
  });
});
