"use client"

import { useState } from "react"
import { motion, useMotionValueEvent, useScroll } from "framer-motion"
import {
  ArrowRight,
  Check,
  Clock,
  Globe,
  Layers,
  Lock,
  Menu,
  Search,
  X,
  Zap,
} from "lucide-react"

const P = "font-[family-name:var(--font-playfair)]"
const S = "font-[family-name:var(--font-source)]"
const J = "font-[family-name:var(--font-geist-mono)]"

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  },
}

const stagger = {
  visible: { transition: { staggerChildren: 0.07 } },
}

const vp = { once: true, margin: "-60px" as const }

const features = [
  { label: "Graph", icon: Globe, title: "AST Dependency Graph", desc: "Tree-sitter powered. Understands structure, not just text. Maps every symbol relationship across your codebase." },
  { label: "Capsule", icon: Zap, title: "Token-Budgeted Capsules", desc: "Request 2,000 or 20,000 tokens. The 7-phase pipeline delivers exactly what fits, ranked by relevance." },
  { label: "Memory", icon: Clock, title: "Cross-Session Memory", desc: "Remember architectural decisions, past queries, and conventions. Context that persists and improves." },
  { label: "Private", icon: Lock, title: "100% Local & Private", desc: "Your code never leaves your machine. No cloud, no telemetry, no API keys. Just SQLite and tree-sitter." },
  { label: "Search", icon: Search, title: "BM25 + PageRank Search", desc: "Three-layer fuzzy search: Porter stemming, trigram matching, Levenshtein correction. Finds what grep can't." },
  { label: "Speed", icon: Zap, title: "Sub-Second Performance", desc: "PageRank on 1M symbols in 556ms. Capsules for 10M-line codebases in under 20 seconds." },
]

const steps = [
  { num: "01", title: "Index", desc: "Tree-sitter parses your code into an AST dependency graph. Every symbol, every call, every import \u2014 mapped across 12 languages." },
  { num: "02", title: "Query", desc: "Ask with natural language. The 7-phase pipeline resolves symbols, scores via BM25 + PageRank, and compresses to your token budget." },
  { num: "03", title: "Deliver", desc: "Your agent receives exactly the code it needs. No noise, no waste, no missing dependencies." },
]

const savings = [
  { metric: "2\u00D7", label: "Longer Sessions", desc: "Less token waste means your Claude Code sessions last twice as long before hitting context limits." },
  { metric: "60%", label: "Less Token Usage", desc: "AST-aware context replaces speculative grep+read. A capsule costs ~2K tokens vs 10\u201340K for manual exploration." },
  { metric: "5\u00D7", label: "Faster Lookups", desc: "Direct symbol resolution instead of scanning files. Your agent finds the right code on the first try." },
  { metric: "$0", label: "Cloud Costs", desc: "Runs entirely on your machine. No API keys, no subscriptions, no per-query charges. Just local SQLite." },
]

function Navbar() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 32))

  const links = [
    { label: "How It Works", href: "#how-it-works" },
    { label: "Features", href: "#features" },
    { label: "Why ContextWeave", href: "#why" },
    { label: "Pricing", href: "#pricing" },
  ]

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-200 ${scrolled ? "border-b border-[#e5e5e5] bg-white/97" : "border-b border-transparent bg-white/80"}`}
      style={{ backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
    >
      <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-6 md:px-10 lg:px-12">
        <a href="#" className={`${P} text-lg font-semibold tracking-tight no-underline`}>
          ContextWeave
        </a>

        <nav className={`${J} hidden items-center gap-7 md:flex`}>
          {links.map((l) => (
            <a key={l.label} href={l.href} className="text-[0.68rem] uppercase tracking-[0.1em] text-[#525252] transition-colors duration-100 hover:!text-black">
              {l.label}
            </a>
          ))}
        </nav>

        <a href="#cta" className={`${J} hidden items-center gap-1.5 border border-black bg-black px-5 py-2 text-[0.65rem] font-medium uppercase tracking-[0.08em] !text-white transition-all duration-100 hover:bg-white hover:!text-black md:inline-flex`}>
          Get Early Access
        </a>

        <button
          type="button"
          className="flex size-10 items-center justify-center border border-[#e5e5e5] bg-transparent md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>

      {open && (
        <div className={`${J} border-t border-black bg-white px-6 py-5 md:hidden`}>
          {links.map((l) => (
            <a key={l.label} href={l.href} onClick={() => setOpen(false)} className="block border-b border-[#e5e5e5] py-3 text-[0.75rem] uppercase tracking-[0.08em] text-[#525252]">
              {l.label}
            </a>
          ))}
          <a href="#cta" onClick={() => setOpen(false)} className="mt-4 block border border-black bg-black py-3 text-center text-[0.75rem] uppercase tracking-[0.08em] !text-white">
            Get Early Access
          </a>
        </div>
      )}
    </header>
  )
}

function Rule({ weight = 2 }: { weight?: number }) {
  return <div style={{ height: weight, background: "#000" }} />
}

function TerminalMockup() {
  return (
    <div className="border-[1.5px] border-black">
      <div className={`${J} flex items-center gap-2 border-b border-black px-4 py-2.5`}>
        <div className="flex gap-[5px]">
          <span className="size-[7px] border border-[#525252]" />
          <span className="size-[7px] border border-[#525252]" />
          <span className="size-[7px] border border-[#525252]" />
        </div>
        <span className="ml-2 text-[0.6rem] uppercase tracking-[0.1em] text-[#525252]">
          ContextWeave MCP
        </span>
      </div>
      <div className={`${J} bg-black p-5 text-[clamp(0.62rem,1vw,0.73rem)] leading-[1.9] text-[#666]`}>
        <div><span className="text-[#444]">$</span> <span className="text-[#e5e5e5]">cw_capsule</span>({"{"} query: <span className="text-[#aaa]">&quot;UserService auth flow&quot;</span>, budget: <span className="text-[#888]">4000</span> {"}"})</div>
        <br />
        <div className="text-[#444]">{"━━━"} Context Capsule {"━━━━━━━━━━━━━━━━━━━━━━━━━"}</div>
        <div>Pivot: <span className="text-white">UserService.authenticate()</span></div>
        <br />
        <div><span className="text-[#aaa]">{"◆"}</span> <span className="text-[#555]">src/auth/UserService.ts:42</span></div>
        <div>&nbsp;&nbsp;<span className="text-white">authenticate</span>(credentials: AuthCredentials)</div>
        <div>&nbsp;&nbsp;<span className="text-[#444]">{"→"}</span> validatePassword() <span className="text-[#444]">{"→"}</span> generateToken()</div>
        <br />
        <div><span className="text-[#aaa]">{"◆"}</span> <span className="text-[#555]">src/auth/TokenManager.ts:18</span></div>
        <div>&nbsp;&nbsp;<span className="text-white">generateToken</span>(user: User): JWT</div>
        <div>&nbsp;&nbsp;<span className="text-[#444]">{"→"}</span> signPayload() <span className="text-[#444]">{"→"}</span> setExpiry()</div>
        <br />
        <div><span className="text-[#aaa]">{"◆"}</span> <span className="text-[#555]">src/middleware/authGuard.ts:7</span></div>
        <div>&nbsp;&nbsp;<span className="text-white">verifyRequest</span>(req: Request)</div>
        <div>&nbsp;&nbsp;<span className="text-[#444]">{"→"}</span> extractToken() <span className="text-[#444]">{"→"}</span> validateClaims()</div>
        <br />
        <div className="text-[#555]">Symbols: 12 | Files: 3 | Tokens: <span className="text-white">1,847</span>/4,000</div>
        <div className="text-[#444]">{"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"}</div>
      </div>
    </div>
  )
}

export default function MonochromeLanding() {
  return (
    <main className={`${S} min-h-screen bg-white text-black`}>
      {/* Noise texture overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-[9999] opacity-[0.016]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Horizontal line texture */}
      <div
        className="pointer-events-none fixed inset-0 z-[9998] opacity-[0.008]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 1px, #000 1px, #000 2px)",
          backgroundSize: "100% 4px",
        }}
      />

      <Navbar />

      {/* ───────── HERO ───────── */}
      <section className="relative overflow-hidden px-6 pb-20 pt-28 md:px-10 lg:px-12 lg:pb-28 lg:pt-36">
        <div className="relative mx-auto max-w-[1080px]">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} inline-block text-[0.6rem] uppercase tracking-[0.18em] text-[#525252]`}>
                MCP-Native Context Engine
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className={`${P} mt-5 text-[clamp(2.8rem,7vw,6rem)] font-semibold leading-[0.95] tracking-[-0.035em]`}
            >
              Your Agent
              <br />
              Deserves <span className="italic text-[#999]">Better</span>
              <br />
              Context
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-6 max-w-[520px] text-[clamp(0.9rem,1.4vw,1.05rem)] leading-[1.8] text-[#525252]"
            >
              ContextWeave builds an AST dependency graph of your entire codebase
              and delivers token-budgeted context capsules. Local-first. No cloud.
              Lightning fast.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
              <a href="#cta" className={`${J} inline-flex items-center gap-2 border-[1.5px] border-black bg-black px-7 py-3.5 text-[0.7rem] font-medium uppercase tracking-[0.08em] !text-white transition-all duration-100 hover:bg-white hover:!text-black`}>
                Get Early Access <ArrowRight className="size-3.5" />
              </a>
              <a href="#how-it-works" className={`${J} inline-flex items-center border-[1.5px] border-black px-7 py-3.5 text-[0.7rem] font-medium uppercase tracking-[0.08em] text-black transition-all duration-100 hover:bg-black hover:!text-white`}>
                See How It Works
              </a>
            </motion.div>

            {/* Key metrics strip */}
            <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-0">
              {[
                { num: "12", text: "Languages\nSupported" },
                { num: "< 5s", text: "Capsule\nGeneration" },
                { num: "100%", text: "Local &\nPrivate" },
              ].map((item, i) => (
                <div key={item.num} className="flex items-center">
                  {i > 0 && <div className="mx-5 h-10 w-px bg-[#e5e5e5] sm:mx-7" />}
                  <div className="flex items-center gap-3">
                    <span className={`${P} text-[1.8rem] font-semibold leading-none tracking-tight sm:text-[2.2rem]`}>
                      {item.num}
                    </span>
                    <span className={`${J} whitespace-pre-line text-[0.55rem] uppercase leading-[1.5] tracking-[0.08em] text-[#525252]`}>
                      {item.text}
                    </span>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Terminal */}
            <motion.div variants={fadeUp} className="mt-14 max-w-[720px]">
              <TerminalMockup />
            </motion.div>

            {/* Decorative rule */}
            <motion.div variants={fadeUp} className="mt-12 flex items-center">
              <div className="h-[2px] flex-1 bg-black" />
              <div className="size-[9px] border-[1.5px] border-black" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── WHAT IS CONTEXT ───────── */}
      <section className="px-6 py-20 md:px-10 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#525252]`}>The Problem</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 max-w-lg text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Your AI agent is blind without <span className={`${P} italic text-[#999]`}>context</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 max-w-md text-[0.95rem] leading-[1.75] text-[#525252]">
              Context is the code your agent needs to see to do its job. Without the right context, agents guess, hallucinate, and waste tokens reading irrelevant files.
            </motion.p>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger} className="mt-14 grid gap-0 border-[1.5px] border-black md:grid-cols-2">
            <motion.div variants={fadeUp} className="border-b border-[#e5e5e5] p-8 md:border-b-0 md:border-r md:border-black">
              <h3 className={`${J} mb-5 text-[0.65rem] uppercase tracking-[0.12em] text-[#999]`}>Without a context engine</h3>
              <ul className="space-y-3.5">
                {[
                  "Agent uses grep to search \u2014 misses call chains and dependencies",
                  "Reads 5\u201310 files speculatively, burning 10\u201340K tokens",
                  "Hits context limit mid-task, forgets earlier work",
                  "You re-explain architecture every session",
                  "Breaks on monorepos and large codebases",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[0.85rem] leading-[1.65] text-[#525252]">
                    <span className={`${J} mt-0.5 flex-shrink-0 text-[0.7rem] text-[#ccc]`}>&times;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div variants={fadeUp} className="bg-black p-8 text-white">
              <h3 className={`${J} mb-5 text-[0.65rem] uppercase tracking-[0.12em] text-[#666]`}>With ContextWeave</h3>
              <ul className="space-y-3.5">
                {[
                  "AST graph traces exact call chains and symbol dependencies",
                  "Capsule delivers ~2K tokens of precisely ranked code",
                  "Sessions last 2\u00D7 longer \u2014 no wasted context window",
                  "Cross-session memory remembers architecture decisions",
                  "Tested on 10M+ line codebases, PageRank in 556ms",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[0.85rem] leading-[1.65] text-[#aaa]">
                    <span className={`${J} mt-0.5 flex-shrink-0 text-[0.7rem] text-white`}>&#10003;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── IMPACT / SAVINGS ───────── */}
      <section className="bg-[#fafafa] px-6 py-20 md:px-10 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#525252]`}>Impact</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 max-w-lg text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Save tokens. Save money.
              <span className={`${P} block italic text-[#999]`}>Ship faster.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 max-w-md text-[0.95rem] leading-[1.75] text-[#525252]">
              Every token your agent wastes on irrelevant context is money spent and time lost. ContextWeave pays for itself in the first session.
            </motion.p>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger} className="mt-14 grid gap-0 border-[1.5px] border-black sm:grid-cols-2 lg:grid-cols-4">
            {savings.map((s, i) => (
              <motion.div
                key={s.label}
                variants={fadeUp}
                className={`group border-b border-[#e5e5e5] p-7 transition-all duration-100 hover:bg-black hover:text-white sm:border-b-0 ${i < 3 ? "sm:border-r sm:border-[#e5e5e5] sm:hover:border-black" : ""} ${i < 2 ? "lg:border-b-0" : ""}`}
              >
                <div className={`${P} mb-2 text-[2.5rem] font-semibold leading-none tracking-tight`}>
                  {s.metric}
                </div>
                <div className={`${J} mb-3 text-[0.6rem] uppercase tracking-[0.1em] text-[#525252] group-hover:text-[#888]`}>
                  {s.label}
                </div>
                <p className="text-[0.8rem] leading-[1.7] text-[#525252] group-hover:text-[#aaa]">
                  {s.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── HOW IT WORKS ───────── */}
      <section id="how-it-works" className="px-6 py-20 md:px-10 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#525252]`}>Process</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              From codebase to <span className={`${P} italic`}>perfect context.</span>
              <span className="block text-[#999]">In milliseconds.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 max-w-md text-[0.95rem] leading-[1.75] text-[#525252]">
              Three steps from raw code to token-budgeted context for any coding agent.
            </motion.p>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger} className="mt-14 grid gap-0 border-[1.5px] border-black md:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.num}
                variants={fadeUp}
                className={`group p-8 transition-all duration-100 hover:bg-black hover:text-white ${i < 2 ? "border-b border-[#e5e5e5] md:border-b-0 md:border-r md:border-[#e5e5e5] md:hover:border-black" : "border-b border-[#e5e5e5] md:border-b-0"}`}
              >
                <div className={`${P} mb-3 text-[3.5rem] font-normal leading-none text-[#e5e5e5] group-hover:text-[#333]`}>
                  {s.num}
                </div>
                <h3 className={`${P} mb-2 text-[1.15rem] font-semibold`}>{s.title}</h3>
                <p className="text-[0.85rem] leading-[1.7] text-[#525252] group-hover:text-[#aaa]">{s.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── CONNECT ───────── */}
      <section className="relative overflow-hidden bg-black px-6 py-20 text-white md:px-10 lg:px-12 lg:py-28">
        {/* Subtle vertical line texture */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 1px, #fff 1px, #fff 2px)", backgroundSize: "4px 100%" }} />

        <div className="relative mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#666]`}>Integrations</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Plug Into Any Coding Agent
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 max-w-md text-[0.95rem] leading-[1.75] text-[#666]">
              ContextWeave runs as an MCP server. Connect it to Claude Code, Cursor, Windsurf, or any MCP-compatible agent in minutes.
            </motion.p>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger} className="mt-14 grid gap-0 border border-white/15 md:grid-cols-2 lg:grid-cols-4">
            {[
              { name: "Claude Code", desc: "Native MCP integration. Auto-indexes on first connect." },
              { name: "Cursor", desc: "Drop-in MCP server. Full AST context in your IDE." },
              { name: "Windsurf", desc: "MCP protocol support. Seamless context delivery." },
              { name: "Any MCP Client", desc: "Standard protocol. Works with any compatible agent." },
            ].map((c) => (
              <motion.div key={c.name} variants={fadeUp} className="border border-white/[0.06] p-7 transition-colors duration-100 hover:bg-white/[0.04]">
                <h3 className={`${P} mb-2 text-[1.05rem] font-semibold`}>{c.name}</h3>
                <p className="text-[0.8rem] leading-[1.65] text-[#555]">{c.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── FEATURES ───────── */}
      <section id="features" className="px-6 py-20 md:px-10 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#525252]`}>Capabilities</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Everything your agent needs.
              <span className={`${P} block italic text-[#999]`}>Nothing it doesn&apos;t.</span>
            </motion.h2>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger} className="mt-14 grid gap-0 border-[1.5px] border-black md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <motion.div key={f.title} variants={fadeUp} className="group border border-[#e5e5e5] p-7 transition-all duration-100 hover:bg-black hover:text-white">
                <span className={`${J} mb-4 block text-[0.55rem] uppercase tracking-[0.12em] text-[#999] group-hover:text-[#555]`}>{f.label}</span>
                <h3 className={`${P} mb-1.5 text-[1.05rem] font-semibold`}>{f.title}</h3>
                <p className="text-[0.8rem] leading-[1.65] text-[#525252] group-hover:text-[#aaa]">{f.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── WHY CONTEXTWEAVE ───────── */}
      <section id="why" className="px-6 py-20 md:px-10 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#525252]`}>Comparison</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Why ContextWeave
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 max-w-md text-[0.95rem] leading-[1.75] text-[#525252]">
              Most AI agents use grep to find context. They don&apos;t know what they don&apos;t know.
            </motion.p>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={fadeUp} className="mt-14 grid gap-0 border-[1.5px] border-black md:grid-cols-2">
            <div className="border-b border-[#e5e5e5] p-8 md:border-b-0 md:border-r md:border-black">
              <h3 className={`${P} mb-5 text-[1.15rem] font-semibold`}>Without ContextWeave</h3>
              {["Grep finds text, misses relationships", "Tokens wasted on irrelevant context", "Agent forgets between sessions", "Cloud dependency, privacy risk", "Breaks on large monorepos"].map((item) => (
                <div key={item} className="flex items-start gap-2.5 border-b border-[#e5e5e5] py-2.5 text-[0.825rem] leading-relaxed text-[#525252]">
                  <span className={`${J} flex-shrink-0 text-[0.75rem] text-[#ccc]`}>&times;</span>
                  {item}
                </div>
              ))}
            </div>
            <div className="bg-black p-8 text-white">
              <h3 className={`${P} mb-5 text-[1.15rem] font-semibold`}>With ContextWeave</h3>
              {["AST graph understands code structure", "Token-budgeted, ranked by relevance", "Cross-session memory persists insights", "100% local, code never leaves", "Tested on 10M+ line codebases"].map((item) => (
                <div key={item} className="flex items-start gap-2.5 border-b border-white/10 py-2.5 text-[0.825rem] leading-relaxed text-[#aaa]">
                  <span className={`${J} flex-shrink-0 text-[0.75rem] text-white`}>&#10003;</span>
                  {item}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── STATS ───────── */}
      <section className="relative overflow-hidden bg-black px-6 py-16 text-white md:px-10 lg:px-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.02]" style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 1px, #fff 1px, #fff 2px)", backgroundSize: "4px 100%" }} />
        <div className="relative mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger} className="grid grid-cols-2 gap-0 md:grid-cols-4">
            {[
              { value: "12", label: "Languages" },
              { value: "556ms", label: "PageRank @ 1M Symbols" },
              { value: "< 5s", label: "Capsule Generation" },
              { value: "10M+", label: "Lines Tested" },
            ].map((s) => (
              <motion.div key={s.label} variants={fadeUp} className="border border-white/[0.06] p-8 text-center">
                <div className={`${P} mb-2 text-[clamp(2rem,4vw,3rem)] font-semibold leading-none`}>{s.value}</div>
                <div className={`${J} text-[0.55rem] uppercase tracking-[0.12em] text-white/30`}>{s.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── PRICING ───────── */}
      <section id="pricing" className="px-6 py-20 md:px-10 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1080px] text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className={`${J} text-[0.6rem] uppercase tracking-[0.15em] text-[#525252]`}>Pricing</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className={`${P} mt-3 text-[clamp(1.8rem,4.5vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Pricing
              <span className={`${P} block italic text-[#999]`}>Coming soon.</span>
            </motion.h2>
          </motion.div>

          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={fadeUp} className="mx-auto mt-12 max-w-[480px] border-[1.5px] border-black p-10 text-center">
            <h3 className={`${P} text-[1.3rem] font-semibold`}>Early Access</h3>
            <p className={`${J} mt-1 text-[0.6rem] uppercase tracking-[0.12em] text-[#999]`}>Founder pricing at launch</p>
            <p className="mt-5 text-[0.875rem] leading-[1.75] text-[#525252]">
              ContextWeave is in active development. Join the early access list to get notified at launch and lock in founder pricing.
            </p>
            <a href="#cta" className={`${J} mt-7 inline-flex w-full items-center justify-center gap-2 border-[1.5px] border-black bg-black py-3.5 text-[0.7rem] font-medium uppercase tracking-[0.08em] !text-white transition-all duration-100 hover:bg-white hover:!text-black`}>
              Get Early Access <ArrowRight className="size-3.5" />
            </a>
          </motion.div>
        </div>
      </section>

      <Rule />

      {/* ───────── CTA ───────── */}
      <section id="cta" className="relative overflow-hidden px-6 py-24 text-center md:px-10 lg:px-12 lg:py-32">
        <div className="pointer-events-none absolute inset-0 opacity-[0.025]" style={{ background: "radial-gradient(circle at 50% 30%, #000, transparent 70%)" }} />
        <div className="relative mx-auto max-w-[1080px]">
          <motion.div initial="hidden" whileInView="visible" viewport={vp} variants={stagger}>
            <motion.h2 variants={fadeUp} className={`${P} mx-auto max-w-lg text-[clamp(1.8rem,4.5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.025em]`}>
              Give Your Agent The Context <span className={`${P} italic`}>It Deserves</span>
            </motion.h2>
            <motion.form
              variants={fadeUp}
              className="mx-auto mt-10 flex max-w-md flex-col gap-0 sm:flex-row"
              onSubmit={(e) => { e.preventDefault(); alert("Thanks! We'll be in touch.") }}
            >
              <input
                type="email"
                placeholder="you@company.com"
                required
                className={`${S} flex-1 border-[1.5px] border-black border-r-0 px-4 py-3.5 text-[0.9rem] outline-none placeholder:italic placeholder:text-[#999] focus:border-b-[3px] sm:border-r-0`}
                style={{ borderRight: "none" }}
              />
              <button type="submit" className={`${J} whitespace-nowrap border-[1.5px] border-black bg-black px-7 py-3.5 text-[0.7rem] font-medium uppercase tracking-[0.08em] !text-white transition-all duration-100 hover:bg-white hover:!text-black`}>
                Join Waitlist
              </button>
            </motion.form>
            <motion.p variants={fadeUp} className={`${J} mt-4 text-[0.6rem] uppercase tracking-[0.08em] text-[#999]`}>
              No spam. Just launch updates and early access.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* ───────── FOOTER ───────── */}
      <footer className="border-t border-black px-6 py-5 md:px-10 lg:px-12">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-4">
          <span className={`${J} text-[0.65rem] text-[#999]`}>&copy; 2026 ContextWeave</span>
          <div className="flex gap-5">
            <a href="https://github.com/ajjucoder/ContextWeave" className={`${J} text-[0.65rem] uppercase tracking-[0.08em] text-[#999] transition-colors duration-100 hover:!text-black`}>GitHub</a>
            <a href="#" className={`${J} text-[0.65rem] uppercase tracking-[0.08em] text-[#999] transition-colors duration-100 hover:!text-black`}>Documentation</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
