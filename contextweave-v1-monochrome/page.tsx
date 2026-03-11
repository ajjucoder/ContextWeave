import type { Metadata } from "next"
import MonochromeLanding from "./MonochromeLanding"

export const metadata: Metadata = {
  title: "ContextWeave — Context Engine for Coding Agents",
  description:
    "ContextWeave builds an AST dependency graph of your entire codebase and delivers token-budgeted context capsules. Local-first. No cloud. Lightning fast.",
}

export default function ContextWeavePage() {
  return <MonochromeLanding />
}
