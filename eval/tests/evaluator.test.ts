import { describe, it } from "node:test";
import { strict as a } from "node:assert";
import { evaluatePatchSimple } from "../src/evaluator.ts";

const GOLD_PATCH = `diff --git a/django/cache/backends/base.py b/django/cache/backends/base.py
--- a/django/cache/backends/base.py
+++ b/django/cache/backends/base.py
@@ -100,6 +100,8 @@
     def delete(self, key):
-        pass
+        result = self._delete(key)
+        return result

diff --git a/django/cache/backends/db.py b/django/cache/backends/db.py
--- a/django/cache/backends/db.py
+++ b/django/cache/backends/db.py
@@ -50,6 +50,8 @@
     def _delete(self, key):
-        pass
+        cursor.execute("DELETE FROM %s WHERE key = %s", [self._table, key])
+        return cursor.rowcount > 0
`;

describe("evaluatePatchSimple", () => {
  it("returns similarity=0 for empty model patch", () => {
    const result = evaluatePatchSimple("", GOLD_PATCH);
    a.equal(result.applied, false);
    a.equal(result.similarity, 0);
  });

  it("returns high similarity for identical patch", () => {
    const result = evaluatePatchSimple(GOLD_PATCH, GOLD_PATCH);
    a.equal(result.applied, true);
    a.equal(result.similarity, 1.0);
  });

  it("returns partial similarity for overlapping files", () => {
    const modelPatch = `diff --git a/django/cache/backends/base.py b/django/cache/backends/base.py
--- a/django/cache/backends/base.py
+++ b/django/cache/backends/base.py
@@ -100,6 +100,8 @@
     def delete(self, key):
-        pass
+        return self._delete(key)
`;
    const result = evaluatePatchSimple(modelPatch, GOLD_PATCH);
    a.equal(result.applied, true);
    // 1/2 file overlap (0.5 * 0.4) + some line overlap
    a.ok(result.similarity > 0);
    a.ok(result.similarity < 1);
  });

  it("returns 0 similarity for completely different patch", () => {
    const modelPatch = `diff --git a/unrelated/file.py b/unrelated/file.py
--- a/unrelated/file.py
+++ b/unrelated/file.py
@@ -1 +1,2 @@
+completely_different_change = True
`;
    const result = evaluatePatchSimple(modelPatch, GOLD_PATCH);
    a.equal(result.applied, true);
    a.equal(result.similarity, 0);
  });
});
