import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { createLogger } from "../utils/logger.js";

const log = createLogger("lsp-bridge");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LspDefinitionResult {
  symbolName: string;
  locations: LspLocation[];
  /** True when result came from LSP (vs. falling back) */
  fromLsp: boolean;
}

export interface LspReferencesResult {
  symbolName: string;
  locations: LspLocation[];
  fromLsp: boolean;
}

export interface LspResolutionStats {
  totalRequests: number;
  lspHits: number;
  fallbacks: number;
  errors: number;
}

export interface LspBridge {
  /** True when an LSP server is available for the project's primary language */
  isAvailable(): boolean;
  /** Resolve definitions for a batch of symbol names. Falls back silently on error. */
  resolveDefinitions(symbolNames: string[]): Promise<LspDefinitionResult[]>;
  /** Get references for a symbol. Falls back silently on error. */
  getReferences(symbolName: string): Promise<LspReferencesResult>;
  /** Return cumulative resolution statistics. */
  getStats(): LspResolutionStats;
  /** Gracefully shut down any spawned LSP processes. */
  shutdown(): void;
}

// ---------------------------------------------------------------------------
// Server detection
// ---------------------------------------------------------------------------

interface LspServerSpec {
  language: string;
  binaryNames: string[];
  /** Additional args to test invocability (e.g. --version) */
  testArgs: string[];
}

const LSP_SERVER_SPECS: LspServerSpec[] = [
  {
    language: "typescript",
    binaryNames: ["typescript-language-server", "tsserver"],
    testArgs: ["--version"],
  },
  {
    language: "python",
    binaryNames: ["pyright-langserver", "pyright", "pylsp", "python-language-server"],
    testArgs: ["--version"],
  },
  {
    language: "go",
    binaryNames: ["gopls"],
    testArgs: ["version"],
  },
  {
    language: "rust",
    binaryNames: ["rust-analyzer"],
    testArgs: ["--version"],
  },
];

/** Return the first binary from PATH that exits successfully with testArgs, or null. */
function detectBinary(spec: LspServerSpec): string | null {
  const opts: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout: 3000,
    stdio: "pipe",
  };

  for (const bin of spec.binaryNames) {
    try {
      const result = spawnSync(bin, spec.testArgs, opts);
      if (result.status === 0 || (result.status !== null && result.status < 2)) {
        return bin;
      }
    } catch {
      // binary not found or errored — try next
    }
  }
  return null;
}

export interface DetectedLspServer {
  language: string;
  binary: string;
}

/** Detect all available LSP servers in the current environment. */
export function detectAvailableLspServers(): DetectedLspServer[] {
  const detected: DetectedLspServer[] = [];
  for (const spec of LSP_SERVER_SPECS) {
    const binary = detectBinary(spec);
    if (binary) {
      detected.push({ language: spec.language, binary });
      log.debug(`LSP server detected for ${spec.language}: ${binary}`);
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// No-op / graceful-degradation implementation
//
// A full LSP stdio JSON-RPC client requires significant infrastructure
// (initialize handshake, capability negotiation, per-file didOpen, etc.).
// The design here provides the interface + detection layer so the indexer
// can call it as the highest-priority resolver. When no server is available
// (or when a request fails), all methods return empty results silently.
//
// A real implementation would add the JSON-RPC transport in a follow-up.
// ---------------------------------------------------------------------------

export class NullLspBridge implements LspBridge {
  private readonly stats: LspResolutionStats = {
    totalRequests: 0,
    lspHits: 0,
    fallbacks: 0,
    errors: 0,
  };

  isAvailable(): boolean {
    return false;
  }

  async resolveDefinitions(symbolNames: string[]): Promise<LspDefinitionResult[]> {
    this.stats.totalRequests += symbolNames.length;
    this.stats.fallbacks += symbolNames.length;
    return symbolNames.map((name) => ({ symbolName: name, locations: [], fromLsp: false }));
  }

  async getReferences(symbolName: string): Promise<LspReferencesResult> {
    this.stats.totalRequests += 1;
    this.stats.fallbacks += 1;
    return { symbolName, locations: [], fromLsp: false };
  }

  getStats(): LspResolutionStats {
    return { ...this.stats };
  }

  shutdown(): void {
    // nothing to do
  }
}

// ---------------------------------------------------------------------------
// Active LSP bridge — wraps detected servers and batches requests
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;

export class ActiveLspBridge implements LspBridge {
  private readonly servers: DetectedLspServer[];
  private readonly stats: LspResolutionStats = {
    totalRequests: 0,
    lspHits: 0,
    fallbacks: 0,
    errors: 0,
  };

  constructor(servers: DetectedLspServer[]) {
    this.servers = servers;
  }

  isAvailable(): boolean {
    return this.servers.length > 0;
  }

  /**
   * Resolve definitions for a batch of symbol names using Promise.allSettled.
   * Batches are processed in groups of BATCH_SIZE.
   * On any per-symbol error the result falls back to an empty location list.
   */
  async resolveDefinitions(symbolNames: string[]): Promise<LspDefinitionResult[]> {
    this.stats.totalRequests += symbolNames.length;
    const results: LspDefinitionResult[] = [];

    for (let i = 0; i < symbolNames.length; i += BATCH_SIZE) {
      const batch = symbolNames.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((name) => this.resolveOneDef(name))
      );
      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j]!;
        const name = batch[j]!;
        if (outcome.status === "fulfilled") {
          results.push(outcome.value);
          if (outcome.value.fromLsp) {
            this.stats.lspHits++;
          } else {
            this.stats.fallbacks++;
          }
        } else {
          log.debug(`LSP resolveDefinition failed for ${name}: ${String(outcome.reason)}`);
          this.stats.errors++;
          this.stats.fallbacks++;
          results.push({ symbolName: name, locations: [], fromLsp: false });
        }
      }
    }

    return results;
  }

  private async resolveOneDef(symbolName: string): Promise<LspDefinitionResult> {
    return { symbolName, locations: [], fromLsp: false };
  }

  async getReferences(symbolName: string): Promise<LspReferencesResult> {
    this.stats.totalRequests++;
    // Placeholder: would send textDocument/references.
    this.stats.fallbacks++;
    return { symbolName, locations: [], fromLsp: false };
  }

  getStats(): LspResolutionStats {
    return { ...this.stats };
  }

  shutdown(): void {
    // Would close spawned stdio processes here.
    log.debug("LSP bridge shutdown (no active connections)");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an LspBridge for the given project root.
 * Returns an ActiveLspBridge when servers are detected, NullLspBridge otherwise.
 * Always degrades gracefully — callers never need to guard for null.
 */
export function createLspBridge(projectRoot: string): LspBridge {
  try {
    const servers = detectAvailableLspServers();
    if (servers.length === 0) {
      log.debug(`No LSP servers detected for ${projectRoot}, using null bridge`);
      return new NullLspBridge();
    }
    log.debug(`LSP bridge active for ${projectRoot} with ${servers.length} server(s)`);
    return new ActiveLspBridge(servers);
  } catch (err) {
    log.debug(`LSP bridge creation failed: ${String(err)}, using null bridge`);
    return new NullLspBridge();
  }
}

// ---------------------------------------------------------------------------
// Status formatter (for cw_status output)
// ---------------------------------------------------------------------------

export function formatLspStatus(bridge: LspBridge): string[] {
  const stats = bridge.getStats();
  const available = bridge.isAvailable();

  const lines = [
    `LSP Bridge:   ${available ? "available" : "unavailable (graceful fallback)"}`,
  ];

  if (bridge instanceof ActiveLspBridge) {
    const hitRate = stats.totalRequests > 0
      ? Math.round((stats.lspHits / stats.totalRequests) * 100)
      : 0;
    lines.push(
      `  LSP hits:   ${stats.lspHits}/${stats.totalRequests} (${hitRate}% hit rate)`,
      `  Fallbacks:  ${stats.fallbacks}`,
      `  Errors:     ${stats.errors}`
    );
  }

  return lines;
}
