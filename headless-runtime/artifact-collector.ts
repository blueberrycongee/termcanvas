/**
 * Collects deliverables after task completion and uploads them to S3-compatible storage.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

export interface ArtifactManifestEntry {
  name: string;
  type: "git" | "files" | "metadata";
  url: string;
  size: number;
}

export interface ArtifactCollectorConfig {
  s3Endpoint?: string;
  s3Bucket?: string;
  gitBranch?: string;
  repoPath?: string;
}

interface ResultOutput {
  path: string;
  description?: string;
  type?: "git" | "files" | "metadata";
}

interface ResultJson {
  success: boolean;
  summary: string;
  outputs: ResultOutput[];
}

export interface S3Client {
  upload(
    bucket: string,
    key: string,
    body: Buffer | NodeJS.ReadableStream,
    contentType?: string,
  ): Promise<{ url: string; size: number }>;
}

export interface ExecFn {
  (
    file: string,
    args: string[],
    options: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string }>;
}

export class ArtifactCollector {
  private readonly config: ArtifactCollectorConfig;
  private readonly s3Client: S3Client | null;
  private readonly exec: ExecFn;

  constructor(
    config: ArtifactCollectorConfig,
    s3Client?: S3Client,
    exec?: ExecFn,
  ) {
    this.config = config;
    this.s3Client = s3Client ?? null;
    this.exec = exec ?? ((file, args, opts) => execFileAsync(file, args, opts));
  }

  async collectArtifacts(
    resultJsonPath: string,
  ): Promise<ArtifactManifestEntry[]> {
    let resultJson: ResultJson;
    try {
      const raw = await fs.readFile(resultJsonPath, "utf-8");
      resultJson = JSON.parse(raw) as ResultJson;
    } catch {
      return [];
    }

    if (!resultJson.outputs || resultJson.outputs.length === 0) {
      return [];
    }

    const manifest: ArtifactManifestEntry[] = [];

    for (const output of resultJson.outputs) {
      const artifactType = output.type ?? "files";

      if (artifactType === "git") {
        const entry = await this.collectGitArtifact(output);
        if (entry) manifest.push(entry);
      } else if (artifactType === "files") {
        const entry = await this.collectFileArtifact(output);
        if (entry) manifest.push(entry);
      } else if (artifactType === "metadata") {
        const entry = await this.collectMetadataArtifact(output);
        if (entry) manifest.push(entry);
      }
    }

    return manifest;
  }

  private async collectGitArtifact(
    output: ResultOutput,
  ): Promise<ArtifactManifestEntry | null> {
    const cwd = this.config.repoPath ?? process.cwd();
    const branch =
      this.config.gitBranch ?? `cloud/artifact-${Date.now()}`;

    try {
      await this.exec("git", ["add", "-A"], { cwd });
      await this.exec(
        "git",
        ["commit", "-m", `artifact: ${output.description ?? output.path}`],
        { cwd },
      );
      await this.exec("git", ["push", "origin", `HEAD:${branch}`], {
        cwd,
      });

      return {
        name: path.basename(output.path),
        type: "git",
        url: `git://${branch}`,
        size: 0,
      };
    } catch (err) {
      console.error("[artifact-collector] git artifact failed:", err);
      return null;
    }
  }

  private async collectFileArtifact(
    output: ResultOutput,
  ): Promise<ArtifactManifestEntry | null> {
    if (!this.s3Client || !this.config.s3Bucket) {
      console.error(
        "[artifact-collector] S3 not configured, skipping file artifact",
      );
      return null;
    }

    const filePath = path.resolve(output.path);
    const tarPath = path.join(tmpdir(), `artifact-${Date.now()}.tar.gz`);

    try {
      const dirPath = path.dirname(filePath);
      const fileName = path.basename(filePath);

      await this.exec(
        "tar",
        ["-czf", tarPath, "-C", dirPath, fileName],
        { cwd: dirPath },
      );

      const tarData = await fs.readFile(tarPath);
      const key = `artifacts/${path.basename(output.path)}.tar.gz`;

      const result = await this.s3Client.upload(
        this.config.s3Bucket,
        key,
        tarData,
        "application/gzip",
      );

      await fs.unlink(tarPath).catch(() => {});

      return {
        name: path.basename(output.path),
        type: "files",
        url: result.url,
        size: result.size,
      };
    } catch (err) {
      console.error("[artifact-collector] file artifact failed:", err);
      await fs.unlink(tarPath).catch(() => {});
      return null;
    }
  }

  private async collectMetadataArtifact(
    output: ResultOutput,
  ): Promise<ArtifactManifestEntry | null> {
    if (!this.s3Client || !this.config.s3Bucket) {
      console.error(
        "[artifact-collector] S3 not configured, skipping metadata artifact",
      );
      return null;
    }

    try {
      const filePath = path.resolve(output.path);
      const data = await fs.readFile(filePath, "utf-8");
      const key = `artifacts/${path.basename(output.path)}`;

      const result = await this.s3Client.upload(
        this.config.s3Bucket,
        key,
        Buffer.from(data),
        "application/json",
      );

      return {
        name: path.basename(output.path),
        type: "metadata",
        url: result.url,
        size: result.size,
      };
    } catch (err) {
      console.error("[artifact-collector] metadata artifact failed:", err);
      return null;
    }
  }
}
