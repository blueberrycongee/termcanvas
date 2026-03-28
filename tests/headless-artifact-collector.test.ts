import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ArtifactCollector,
  type S3Client,
  type ExecFn,
  type ArtifactManifestEntry,
} from "../headless-runtime/artifact-collector.ts";

function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "artifact-test-"));
}

function mockS3Client(uploads: ArtifactManifestEntry[] = []): S3Client {
  return {
    async upload(bucket, key, body) {
      const size = Buffer.isBuffer(body) ? body.length : 0;
      const url = `s3://${bucket}/${key}`;
      uploads.push({ name: key, type: "files", url, size });
      return { url, size };
    },
  };
}

function mockExec(calls: Array<{ file: string; args: string[] }> = []): ExecFn {
  return async (file, args, _opts) => {
    calls.push({ file, args });
    // If tar is called with -czf, create a fake tar.gz so readFile succeeds
    if (file === "tar" && args[0] === "-czf") {
      await fs.writeFile(args[1], "fake-tar-content");
    }
    return { stdout: "", stderr: "" };
  };
}

describe("ArtifactCollector", () => {
  it("returns empty manifest when result.json does not exist", async () => {
    const collector = new ArtifactCollector({});
    const manifest = await collector.collectArtifacts("/nonexistent/result.json");
    assert.deepEqual(manifest, []);
  });

  it("returns empty manifest when outputs is empty array", async () => {
    const tmpDir = await makeTmpDir();
    const resultPath = path.join(tmpDir, "result.json");
    await fs.writeFile(
      resultPath,
      JSON.stringify({ success: true, summary: "ok", outputs: [] }),
    );

    const collector = new ArtifactCollector({});
    const manifest = await collector.collectArtifacts(resultPath);
    assert.deepEqual(manifest, []);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("returns empty manifest when result.json is invalid JSON", async () => {
    const tmpDir = await makeTmpDir();
    const resultPath = path.join(tmpDir, "result.json");
    await fs.writeFile(resultPath, "not json");

    const collector = new ArtifactCollector({});
    const manifest = await collector.collectArtifacts(resultPath);
    assert.deepEqual(manifest, []);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("correctly parses result.json and identifies artifact types", async () => {
    const tmpDir = await makeTmpDir();
    const resultPath = path.join(tmpDir, "result.json");
    await fs.writeFile(
      resultPath,
      JSON.stringify({
        success: true,
        summary: "done",
        outputs: [
          { path: "src/main.ts", type: "git", description: "main code" },
          { path: "dist/bundle.js", type: "files" },
          { path: "meta.json", type: "metadata" },
        ],
      }),
    );

    const execCalls: Array<{ file: string; args: string[] }> = [];
    const uploads: ArtifactManifestEntry[] = [];
    const collector = new ArtifactCollector(
      { s3Bucket: "test-bucket", repoPath: tmpDir },
      mockS3Client(uploads),
      mockExec(execCalls),
    );

    const manifest = await collector.collectArtifacts(resultPath);

    // Git artifact should have run git commands
    const gitCalls = execCalls.filter((c) => c.file === "git");
    assert.ok(gitCalls.length >= 2, "should run git add and git commit");

    // All three types should produce entries (git + files + metadata may fail without real files)
    // At minimum, the git artifact should succeed since we mock exec
    assert.ok(manifest.length >= 1, "should have at least one artifact");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("git artifact runs expected git commands", async () => {
    const tmpDir = await makeTmpDir();
    const resultPath = path.join(tmpDir, "result.json");
    await fs.writeFile(
      resultPath,
      JSON.stringify({
        success: true,
        summary: "done",
        outputs: [{ path: "code.ts", type: "git", description: "code changes" }],
      }),
    );

    const execCalls: Array<{ file: string; args: string[] }> = [];
    const collector = new ArtifactCollector(
      { repoPath: tmpDir, gitBranch: "cloud/test-123" },
      undefined,
      mockExec(execCalls),
    );

    const manifest = await collector.collectArtifacts(resultPath);

    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].type, "git");
    assert.equal(manifest[0].url, "git://cloud/test-123");

    // Verify git commands
    assert.deepEqual(execCalls[0], { file: "git", args: ["add", "-A"] });
    assert.equal(execCalls[1].file, "git");
    assert.ok(execCalls[1].args.includes("commit"));
    assert.equal(execCalls[2].file, "git");
    assert.ok(execCalls[2].args.includes("push"));

    await fs.rm(tmpDir, { recursive: true });
  });

  it("file artifact uses S3 upload (mock)", async () => {
    const tmpDir = await makeTmpDir();
    const resultPath = path.join(tmpDir, "result.json");
    const targetFile = path.join(tmpDir, "output.txt");
    await fs.writeFile(targetFile, "file contents");
    await fs.writeFile(
      resultPath,
      JSON.stringify({
        success: true,
        summary: "done",
        outputs: [{ path: targetFile, type: "files" }],
      }),
    );

    const uploads: ArtifactManifestEntry[] = [];
    const execCalls: Array<{ file: string; args: string[] }> = [];
    const collector = new ArtifactCollector(
      { s3Bucket: "my-bucket" },
      mockS3Client(uploads),
      mockExec(execCalls),
    );

    const manifest = await collector.collectArtifacts(resultPath);

    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].type, "files");
    assert.ok(manifest[0].url.startsWith("s3://my-bucket/"));

    // Verify tar was called
    const tarCall = execCalls.find((c) => c.file === "tar");
    assert.ok(tarCall, "should call tar to create archive");

    await fs.rm(tmpDir, { recursive: true });
  });
});
