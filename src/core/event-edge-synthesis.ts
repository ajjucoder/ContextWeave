import type Database from "better-sqlite3";
import type { EdgeKind } from "./types.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { fileQueries } from "../db/queries/files.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("event-edge-synthesis");

const EMITTER_PATTERNS: RegExp[] = [
  /\bemit(?:_all)?\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\$emit\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\bpublish\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\btrigger\s*\(\s*(['"`])([^'"`]+)\1/g,
];

const LISTENER_PATTERNS: RegExp[] = [
  /\bon\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\blisten\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\baddEventListener\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\bsubscribe\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\bonce\s*\(\s*(['"`])([^'"`]+)\1/g,
];

const HTTP_CALLER_PATTERNS: RegExp[] = [
  /fetch\s*\(\s*(['"`])(\/?api\/[^'"`]+)\1/g,
  /axios\s*\.\s*(?:get|post|put|delete|patch)\s*\(\s*(['"`])(\/?api\/[^'"`]+)\1/g,
];

const TAURI_INVOKE_PATTERN = /\binvoke\s*\(\s*(['"`])([^'"`]+)\1/g;

const CONVEX_CALLER_PATTERNS: RegExp[] = [
  /\buseMutation\s*\(\s*api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g,
  /\buseQuery\s*\(\s*api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g,
  /\buseAction\s*\(\s*api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g,
];

const CONVEX_EXPORT_PATTERN =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:mutation|query|action)\s*\(/g;

const WS_CALLER_PATTERNS: RegExp[] = [
  /\brequest\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\bsend\s*\(\s*JSON\.stringify\s*\(\s*\{[^}]*method\s*:\s*(['"`])([^'"`]+)\1/g,
];

const WS_HANDLER_PATTERNS: RegExp[] = [
  /\bcase\s+(['"`])([^'"`]+)\1\s*:/g,
  /\bif\s*\(\s*(?:msg|message|data|event)(?:\?\.|\.)method\s*===?\s*(['"`])([^'"`]+)\1/g,
];

function extractWsCallers(source: string): string[] {
  const methods: string[] = [];
  for (const pattern of WS_CALLER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of source.matchAll(re)) {
      const method = match[2] ?? match[4];
      if (method) methods.push(normalizeChannel(method));
    }
  }
  return methods;
}

function extractWsHandlers(source: string): string[] {
  const methods: string[] = [];
  for (const pattern of WS_HANDLER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of source.matchAll(re)) {
      const method = match[2] ?? match[4];
      if (method) methods.push(normalizeChannel(method));
    }
  }
  return methods;
}

function normalizeChannel(channel: string): string {
  return channel.trim().toLowerCase();
}

function extractEventEmitters(source: string): string[] {
  const channels: string[] = [];
  for (const pattern of EMITTER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of source.matchAll(re)) {
      const channel = match[2];
      if (channel) channels.push(normalizeChannel(channel));
    }
  }
  return channels;
}

function extractEventListeners(source: string): string[] {
  const channels: string[] = [];
  for (const pattern of LISTENER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of source.matchAll(re)) {
      const channel = match[2];
      if (channel) channels.push(normalizeChannel(channel));
    }
  }
  return channels;
}

function extractHttpCallers(source: string): string[] {
  const paths: string[] = [];
  for (const pattern of HTTP_CALLER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of source.matchAll(re)) {
      const path = match[2];
      if (path) paths.push(path.startsWith("/") ? path : `/${path}`);
    }
  }
  return paths;
}

function extractTauriInvocations(source: string, filePath: string): string[] {
  if (filePath.endsWith(".rs")) return [];
  const commands: string[] = [];
  const re = new RegExp(TAURI_INVOKE_PATTERN.source, TAURI_INVOKE_PATTERN.flags);
  for (const match of source.matchAll(re)) {
    const command = match[2];
    if (command) commands.push(normalizeChannel(command));
  }
  return commands;
}

interface ConvexReference {
  module: string;
  exportName: string;
}

function extractConvexCallers(source: string): ConvexReference[] {
  const refs: ConvexReference[] = [];
  for (const pattern of CONVEX_CALLER_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of source.matchAll(re)) {
      const module = match[1];
      const exportName = match[2];
      if (module && exportName) refs.push({ module, exportName });
    }
  }
  return refs;
}

function extractConvexExports(source: string): string[] {
  const names: string[] = [];
  const re = new RegExp(CONVEX_EXPORT_PATTERN.source, CONVEX_EXPORT_PATTERN.flags);
  for (const match of source.matchAll(re)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

function matchNextApiRoute(filePath: string, routePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const cleanRoute = routePath.replace(/^\/api\//, "").replace(/\/$/, "");

  if (/app\/api\//.test(normalized)) {
    const afterApi = normalized.replace(/.*app\/api\//, "");
    const routePattern = afterApi.replace(/\/route\.(ts|tsx|js|jsx)$/, "").replace(/\/$/, "");
    if (routePattern === cleanRoute) return true;
  }

  if (/pages\/api\//.test(normalized)) {
    const afterApi = normalized.replace(/.*pages\/api\//, "");
    const routePattern = afterApi.replace(/\.(ts|tsx|js|jsx)$/, "");
    if (routePattern === cleanRoute) return true;
  }

  return false;
}

export function synthesizeEventEdges(db: Database.Database): number {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const files = fileQueries(db);
  const now = Date.now();

  const allSymbols = symbols.getAll();
  if (allSymbols.length === 0) return 0;

  const filePathCache = new Map<number, string>();
  const getFilePath = (fileId: number): string => {
    const cached = filePathCache.get(fileId);
    if (cached !== undefined) return cached;
    const file = files.getById(fileId);
    const path = file?.path ?? "";
    filePathCache.set(fileId, path);
    return path;
  };

  const emittersByChannel = new Map<string, number[]>();
  const listenersByChannel = new Map<string, number[]>();
  const httpCallersByPath = new Map<string, number[]>();
  const tauriInvokerIds: number[] = [];
  const tauriHandlerIds: number[] = [];
  const convexCallersByRef = new Map<string, number[]>();
  const convexExportersByName = new Map<string, number[]>();
  const serverActionIds = new Set<number>();
  const wsCallersByMethod = new Map<string, number[]>();
  const wsHandlersByMethod = new Map<string, number[]>();

  for (const sym of allSymbols) {
    const source = sym.fullSource;
    if (!source) continue;
    const filePath = getFilePath(sym.fileId);

    for (const channel of extractEventEmitters(source)) {
      const bucket = emittersByChannel.get(channel) ?? [];
      bucket.push(sym.id);
      emittersByChannel.set(channel, bucket);
    }

    for (const channel of extractEventListeners(source)) {
      const bucket = listenersByChannel.get(channel) ?? [];
      bucket.push(sym.id);
      listenersByChannel.set(channel, bucket);
    }

    for (const path of extractHttpCallers(source)) {
      const bucket = httpCallersByPath.get(path) ?? [];
      bucket.push(sym.id);
      httpCallersByPath.set(path, bucket);
    }

    const tauriCommands = extractTauriInvocations(source, filePath);
    if (tauriCommands.length > 0) {
      tauriInvokerIds.push(sym.id);
    }

    if (
      filePath.endsWith(".rs") &&
      (source.includes("#[tauri::command]") || source.includes("tauri::command"))
    ) {
      tauriHandlerIds.push(sym.id);
    }

    for (const ref of extractConvexCallers(source)) {
      const key = `${ref.module}:${ref.exportName}`;
      const bucket = convexCallersByRef.get(key) ?? [];
      bucket.push(sym.id);
      convexCallersByRef.set(key, bucket);
    }

    for (const name of extractConvexExports(source)) {
      const bucket = convexExportersByName.get(name) ?? [];
      bucket.push(sym.id);
      convexExportersByName.set(name, bucket);
    }

    for (const method of extractWsCallers(source)) {
      const bucket = wsCallersByMethod.get(method) ?? [];
      bucket.push(sym.id);
      wsCallersByMethod.set(method, bucket);
    }

    for (const method of extractWsHandlers(source)) {
      const bucket = wsHandlersByMethod.get(method) ?? [];
      bucket.push(sym.id);
      wsHandlersByMethod.set(method, bucket);
    }
  }

  for (const sym of allSymbols) {
    const selfEdges = edges.getBySource(sym.id);
    if (selfEdges.some((e) => e.targetSymbolId === sym.id && e.kind === "server-action")) {
      serverActionIds.add(sym.id);
    }
  }

  const pendingEdges: Array<{ sourceId: number; targetId: number; kind: EdgeKind }> = [];

  for (const [channel, emitterIds] of emittersByChannel) {
    const listenerIds = listenersByChannel.get(channel);
    if (!listenerIds || listenerIds.length === 0) continue;
    for (const emitterId of emitterIds) {
      for (const listenerId of listenerIds) {
        if (emitterId !== listenerId) {
          pendingEdges.push({ sourceId: emitterId, targetId: listenerId, kind: "event" });
        }
      }
    }
  }

  for (const [path, callerIds] of httpCallersByPath) {
    const matchingIds: number[] = [];
    for (const sym of allSymbols) {
      const filePath = getFilePath(sym.fileId);
      if (!matchNextApiRoute(filePath, path)) continue;
      const n = sym.name;
      if (
        n === "GET" || n === "POST" || n === "PUT" || n === "DELETE" || n === "PATCH" ||
        n === "handler" || n === "default"
      ) {
        matchingIds.push(sym.id);
      }
    }
    for (const callerId of callerIds) {
      for (const targetId of matchingIds) {
        if (callerId !== targetId) {
          pendingEdges.push({ sourceId: callerId, targetId, kind: "event" });
        }
      }
    }
  }

  if (tauriInvokerIds.length > 0 && tauriHandlerIds.length > 0) {
    for (const invokerId of tauriInvokerIds) {
      for (const handlerId of tauriHandlerIds) {
        if (invokerId !== handlerId) {
          pendingEdges.push({ sourceId: invokerId, targetId: handlerId, kind: "event" });
        }
      }
    }
  }

  for (const [refKey, callerIds] of convexCallersByRef) {
    const colonIdx = refKey.indexOf(":");
    if (colonIdx === -1) continue;
    const module = refKey.slice(0, colonIdx);
    const exportName = refKey.slice(colonIdx + 1);

    const matchingIds: number[] = [];
    for (const sym of allSymbols) {
      if (sym.name !== exportName) continue;
      const filePath = getFilePath(sym.fileId);
      if (
        filePath.includes(`convex/${module}`) ||
        filePath.includes(`convex\\${module}`)
      ) {
        matchingIds.push(sym.id);
      }
    }

    if (matchingIds.length === 0) {
      const exporterIds = convexExportersByName.get(exportName);
      if (exporterIds) matchingIds.push(...exporterIds);
    }

    for (const callerId of callerIds) {
      for (const targetId of matchingIds) {
        if (callerId !== targetId) {
          pendingEdges.push({ sourceId: callerId, targetId, kind: "event" });
        }
      }
    }
  }

  if (serverActionIds.size > 0) {
    for (const serverActionId of serverActionIds) {
      const callerEdges = edges.getByTarget(serverActionId);
      for (const callerEdge of callerEdges) {
        if (
          (callerEdge.kind === "call" || callerEdge.kind === "import") &&
          callerEdge.sourceSymbolId !== serverActionId
        ) {
          pendingEdges.push({
            sourceId: callerEdge.sourceSymbolId,
            targetId: serverActionId,
            kind: "server-action",
          });
        }
      }
    }
  }

  for (const [method, callerIds] of wsCallersByMethod) {
    const handlerIds = wsHandlersByMethod.get(method);
    if (!handlerIds || handlerIds.length === 0) continue;
    for (const callerId of callerIds) {
      for (const handlerId of handlerIds) {
        if (callerId !== handlerId) {
          pendingEdges.push({ sourceId: callerId, targetId: handlerId, kind: "event" });
        }
      }
    }
  }

  if (pendingEdges.length === 0) return 0;

  const insertBatch = db.transaction(() => {
    for (const edge of pendingEdges) {
      edges.insert({
        sourceSymbolId: edge.sourceId,
        targetSymbolId: edge.targetId,
        kind: edge.kind,
        createdAt: now,
      });
    }
  });

  insertBatch();
  log.info(`synthesized ${pendingEdges.length} cross-boundary event edges`);
  return pendingEdges.length;
}
