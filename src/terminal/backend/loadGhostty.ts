import { Ghostty } from "ghostty-web";

/**
 * Ghostty's WASM needs one env import (`log`) to dump parser diagnostics. The
 * callback has to read from the instance's own exported memory, which only
 * exists after `instantiate` resolves — so we close over a lazy getter rather
 * than capturing the instance before it exists.
 */
function makeImports(
  getMemory: () => WebAssembly.Memory,
): WebAssembly.Imports {
  return {
    env: {
      log: (ptr: number, len: number) => {
        try {
          const mem = getMemory();
          const bytes = new Uint8Array(mem.buffer, ptr, len);
          console.log("[ghostty-vt]", new TextDecoder().decode(bytes));
        } catch {
          // Ignore — instance memory not ready (shouldn't happen post-init).
        }
      },
    },
  };
}

/**
 * Compile and instantiate Ghostty's VT WASM from raw bytes. This is the
 * environment-agnostic entry point; see the Node / browser helpers below for
 * the two usual ways to obtain the bytes.
 */
export async function loadGhosttyFromBytes(
  bytes: BufferSource,
): Promise<Ghostty> {
  const compiled = await WebAssembly.compile(bytes);
  let instance: WebAssembly.Instance | null = null;
  const imports = makeImports(() => {
    if (!instance) {
      throw new Error("Ghostty WASM memory accessed before instantiation");
    }
    return instance.exports.memory as WebAssembly.Memory;
  });
  instance = await WebAssembly.instantiate(compiled, imports);
  return new Ghostty(instance);
}

/**
 * Node-side loader. Defaults to the WASM shipped inside the ghostty-web npm
 * package so tests and headless tooling don't need a manual path.
 */
export async function loadGhosttyInNode(wasmPath?: string): Promise<Ghostty> {
  const { readFile } = await import("node:fs/promises");
  let resolvedPath: string;
  if (wasmPath) {
    resolvedPath = wasmPath;
  } else {
    // ghostty-web's package.json is hidden behind its `exports` map, so we
    // can't ask for it directly. Resolve the main entry and walk up to the
    // package root, which is where ghostty-vt.wasm lives.
    const { createRequire } = await import("node:module");
    const { dirname, join, sep } = await import("node:path");
    const req = createRequire(import.meta.url);
    const entryPath = req.resolve("ghostty-web");
    const segments = entryPath.split(sep);
    const idx = segments.lastIndexOf("ghostty-web");
    if (idx === -1) {
      throw new Error(
        `Could not locate ghostty-web package root in ${entryPath}`,
      );
    }
    const pkgRoot = segments.slice(0, idx + 1).join(sep);
    resolvedPath = join(pkgRoot, "ghostty-vt.wasm");
    // Fallback — some toolchains install the wasm only inside dist/.
    try {
      await (await import("node:fs/promises")).access(resolvedPath);
    } catch {
      resolvedPath = join(pkgRoot, "dist", "ghostty-vt.wasm");
    }
    void dirname; // keep import-check happy if the try branch is taken
  }
  const bytes = await readFile(resolvedPath);
  return loadGhosttyFromBytes(bytes);
}

/**
 * Browser / Electron renderer loader. The caller passes a URL that resolves to
 * ghostty-vt.wasm (typically obtained via Vite `?url` import).
 */
export async function loadGhosttyInBrowser(wasmUrl: string): Promise<Ghostty> {
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Ghostty WASM from ${wasmUrl}: ${response.status} ${response.statusText}`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error(`Ghostty WASM at ${wasmUrl} is empty`);
  }
  return loadGhosttyFromBytes(bytes);
}
