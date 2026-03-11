import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

const CELERY_TASK_RE = /@(?:shared_task|app\.task|celery\.task)(?:\([^)]*\))?/g;
const CELERY_DELAY_RE = /([A-Za-z_][\w]*)\s*\.\s*(?:delay|apply_async)\s*\(/g;
const SIDEKIQ_PERFORM_ASYNC_RE = /([A-Za-z_][\w]*)\s*\.\s*perform_async\s*\(/g;
const SIDEKIQ_PERFORM_RE = /def\s+perform\s*\(/g;

function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}

export const celerySidekiqFrameworkPlugin: FrameworkTracePlugin = {
  id: "celery-sidekiq",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    if (language === "python") {
      for (const symbol of symbols) {
        const taskRe = new RegExp(CELERY_TASK_RE.source, CELERY_TASK_RE.flags);
        if (taskRe.test(symbol.fullSource)) {
          const key = `${symbol.name}:celery_task:def`;
          if (!seen.has(key)) {
            seen.add(key);
            calls.push({
              callerSymbol: symbol.name,
              targetName: symbol.name,
              line: symbol.startLine,
              framework: "celery_task",
            });
          }
        }

        const delayRe = new RegExp(CELERY_DELAY_RE.source, CELERY_DELAY_RE.flags);
        for (const match of symbol.fullSource.matchAll(delayRe)) {
          const taskName = match[1] ?? "";
          const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
          const key = `${symbol.name}:celery_delay:${taskName}:${line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          calls.push({
            callerSymbol: symbol.name,
            targetName: taskName,
            line,
            framework: "celery_task",
          });
        }
      }
    }

    if (language === "ruby") {
      for (const symbol of symbols) {
        const performRe = new RegExp(SIDEKIQ_PERFORM_ASYNC_RE.source, SIDEKIQ_PERFORM_ASYNC_RE.flags);
        for (const match of symbol.fullSource.matchAll(performRe)) {
          const workerName = match[1] ?? "";
          const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
          const key = `${symbol.name}:sidekiq:${workerName}:${line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          calls.push({
            callerSymbol: symbol.name,
            targetName: workerName,
            line,
            framework: "sidekiq_task",
          });
        }

        const implRe = new RegExp(SIDEKIQ_PERFORM_RE.source, SIDEKIQ_PERFORM_RE.flags);
        if (implRe.test(symbol.fullSource)) {
          const key = `${symbol.name}:sidekiq_perform`;
          if (!seen.has(key)) {
            seen.add(key);
            calls.push({
              callerSymbol: symbol.name,
              targetName: symbol.name,
              line: symbol.startLine,
              framework: "sidekiq_task",
            });
          }
        }
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "celery_task" || call.framework === "sidekiq_task";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
