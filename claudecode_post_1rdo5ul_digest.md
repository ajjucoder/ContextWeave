# Reddit Post Digest — I cut Claude Code's token usage by 65% with a local dependency graph and it remembers what it learned across sessions

- Source URL: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/
- Captured at (UTC): 2026-02-25T15:14:01.315181+00:00
- Subreddit: r/ClaudeCode
- Author: u/redacted_user
- Score: 217 | Comments reported by Reddit: 145 | Comments captured: 141

## What the post is about
Author promotes 'vexp', a local VS Code extension that uses an AST dependency graph and persistent observations to reduce context tokens and preserve session memory for Claude Code.

## Original post text
Disclosure: I'm the developer of the tool mentioned below.

Been running Claude Code full-time on a growing TypeScript codebase. Two problems kept burning me:



1. Token waste. Claude reads files linearly to build context. A single query was pulling \~18k tokens, most of it irrelevant. On Max plan that means hitting the usage cap faster. On API it's just money on fire.

2. Session amnesia. Every new session, Claude re-discovers the same architecture, re-reads the same files, asks the same questions. All the understanding from yesterday's session? Gone.



So I built a VS Code extension to fix both.

**For token waste:** it builds a dependency graph from your code's AST using tree-sitter. Not embeddings, not semantic search, actual structural relationships. Who calls what, who imports what, what types flow where. When Claude asks for context, it gets a token-budgeted capsule with only the relevant subgraph. \~2.4k tokens instead of \~18k. Better context, fewer tokens.

**For session memory:** observations from each session are linked to specific nodes in the dependency graph. What Claude explored, what it changed, what patterns it noticed. But here's the thing I didn't expect: Claude won't save its own notes even if you ask. Put "save what you learn" in CLAUDE.md, it cooperates maybe 10% of the time. So the extension also observes passively, it watches what Claude does, detects file changes at the AST level (not "file modified" but "function signature changed, parameter added"), and generates memory automatically. When code changes later, linked observations go stale. Next session, Claude sees "previous context exists but code changed since, re-evaluate."



Also catches anti-patterns: dead-end exploration (added something then removed it same session) and file thrashing (modifying same file 4+ times in 5 minutes).

Auto-generates .claude/CLAUDE.md with the full MCP tool descriptions based on your project structure. Auto-detects Claude Code via env vars.

Native Rust binary under the hood, SQLite, 100% local, zero cloud, zero network calls. Works with Cursor, Copilot, Windsurf, Zed, Continue, and other agents too, but built Claude Code-first.

It's called **vexp** (https://vexp.dev/), free on the VS Code Marketplace.



What's your current approach for session continuity? Curious what's working for people.

## Links in post body
- https://vexp.dev/
- https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/

## Links in comments (grouped by comment)

### (26) u/Buckweb — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76qfhk/
- https://ast-grep.github.io/

### (6) u/redacted_user — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76t17n/
- http://memory.md

### (2) u/redacted_user — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7alddn/
- https://vexp.dev/docs

### (2) u/redacted_user — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7774mm/
- http://CLAUDE.md
- http://Claude.md

### (1) u/ardicli2000 — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7agaz8/
- http://Terminal.App

### (1) u/RemindMeBot — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78omzs/
- http://www.wolframalpha.com/input/?i=2026-03-04%2000:42:20%20UTC%20To%20Local%20Time
- https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78ojfu/?context=3
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Reminder&message=%5Bhttps%3A%2F%2Fwww.reddit.com%2Fr%2FClaudeCode%2Fcomments%2F1rdo5ul%2Fi_cut_claude_codes_token_usage_by_65_with_a_local%2Fo78ojfu%2F%5D%0A%0ARemindMe%21%202026-03-04%2000%3A42%3A20%20UTC
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Delete%20Comment&message=Delete%21%201rdo5ul
- https://www.reddit.com/r/RemindMeBot/comments/e1bko7/remindmebot_info_v21/
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Reminder&message=%5BLink%20or%20message%20inside%20square%20brackets%5D%0A%0ARemindMe%21%20Time%20period%20here
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=List%20Of%20Reminders&message=MyReminders%21
- https://www.reddit.com/message/compose/?to=Watchful1&subject=RemindMeBot%20Feedback
- https://www.wolframalpha.com/input/?i=2026-03-04%2000:42:20%20UTC%20To%20Local%20Time

### (1) u/shooshmashta — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77xzw4/
- http://github.com/CodeAnt-AI/tree-sitter-vb-dotnet

### (1) u/HostNo8115 — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77rs1j/
- https://github.com/campfirein/cipher/

### (1) u/redacted_user — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77o46c/
- http://lessons.md

### (1) u/shogster — https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7780wq/
- http://Memory.md

## Unique links from comments
- http://CLAUDE.md
- http://Claude.md
- http://Memory.md
- http://Terminal.App
- http://github.com/CodeAnt-AI/tree-sitter-vb-dotnet
- http://lessons.md
- http://memory.md
- http://www.wolframalpha.com/input/?i=2026-03-04%2000:42:20%20UTC%20To%20Local%20Time
- https://ast-grep.github.io/
- https://github.com/campfirein/cipher/
- https://vexp.dev/docs
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Delete%20Comment&message=Delete%21%201rdo5ul
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=List%20Of%20Reminders&message=MyReminders%21
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Reminder&message=%5BLink%20or%20message%20inside%20square%20brackets%5D%0A%0ARemindMe%21%20Time%20period%20here
- https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Reminder&message=%5Bhttps%3A%2F%2Fwww.reddit.com%2Fr%2FClaudeCode%2Fcomments%2F1rdo5ul%2Fi_cut_claude_codes_token_usage_by_65_with_a_local%2Fo78ojfu%2F%5D%0A%0ARemindMe%21%202026-03-04%2000%3A42%3A20%20UTC
- https://www.reddit.com/message/compose/?to=Watchful1&subject=RemindMeBot%20Feedback
- https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78ojfu/?context=3
- https://www.reddit.com/r/RemindMeBot/comments/e1bko7/remindmebot_info_v21/
- https://www.wolframalpha.com/input/?i=2026-03-04%2000:42:20%20UTC%20To%20Local%20Time

## All comments captured
Format: score | author | permalink | body

### (31) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76svol/
Same here. CLI version is dropping in the next few days, native Rust binary on stdin/stdout. I'll update this thread when it's live.

### (26) u/Buckweb
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76qfhk/
Have you tried https://ast-grep.github.io/?

### (20) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76okxz/
Standalone CLI is coming in the next few days, actually. Native Rust binary, single command, works over stdin/stdout with any MCP-compatible agent. No VS Code needed.

I'll update this thread when it's out. If you want I can ping you directly.

### (19) u/keekje
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76qico/
CLI would be really great. For me I found that Claude works the best in a terminal.

### (14) u/kallaMigBeau
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77gfxe/
Pro version is a little bit too expensive and the repo restriction for pro is insane

### (14) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76slbt/
Yeah, ast-grep is great for structural search and linting. Different use case though. ast-grep is "find all functions matching this pattern", you define the pattern, you run the query. vexp builds the full dependency graph automatically and keeps it updated as you code. No queries to write, no patterns to define. It just knows that function A calls B, imports type C from repo D, and that changing A's signature breaks three downstream consumers.

Think of it as: ast-grep is grep on steroids, vexp is a persistent structural map of your codebase with memory attached.

### (8) u/kvothe5688
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o778vuv/
i have a lessons.md file . closing hook ask orchestrator agent what lessons it learned during solving that issue. it will add new lessons to lessons.md. when new session start context injection script injects lessons and workflow at start. then when it wants to research it runs context injection script and all context is injected as per file list it asked

### (6) u/oppenheimer135
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79hgxa/
Does this product have no consumers? Agents shipping code to production? What kinda hell am I in?

### (6) u/lionmeetsviking
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o777csx/
I don’t get this hate for creators. Are you Linus T? Or you created something equally valuable that gives you the “right” to define what is right or wrong project? 

And I trust you evaluated his code and are not just shouting from the hip because you haven’t been loved enough?

### (6) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76t17n/
Memory.md gets you a solid chunk of the way, especially if you maintain it well. The gap shows up when the project grows: hundreds of cross-file relationships that are hard to keep in a markdown file, and staleness your memory.md says "auth uses JWT middleware" but someone refactored that two days ago.

The graph handles the structural side automatically. The memory layer adds the "why" on top: not just what depends on what, but what Claude learned about it and whether that knowledge is still valid. Observations auto-link to graph nodes, so when code changes, the linked memories get flagged stale.

But yeah, if [memory.md](http://memory.md) is working for your project size, that's totally valid. vexp starts paying off more as the codebase and the number of sessions grow.

### (5) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o771762/
Fair enough. I built it, I think it's useful, I disclosed that I'm the developer. If it's not for you, no worries.

### (5) u/Select-Dirt
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76qh60/
Memory.md and a good claude.md is all you need though. With that said, yeah the dependency graph sounds like a neat idea

### (5) u/shooshmashta
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76lr1h/
For someone who never uses vsc and lives in the command line, is there anything that is planned there?

### (4) u/throwaway490215
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7b651z/
Ah, that explains it. I was wondering why yet-another "I cut my tokens with this project" was hitting so many upvotes, but they probably got some accounts to upvote their slop. 

Seriously - asking subscription money for something I could feed to Claude right now and get working in 30 min lol.

### (4) u/Kayyam
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79f3gr/
What kind of product you working on? How do you get the confidence needed to ship Claude's code to production? Our team is small, junior, AI friendly but very conservative about Production.

### (4) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o776ppy/
I actually like Serena a lot, but we use different approach. Serena wraps language servers to give your agent IDE-like operations: find symbol, find references, edit at the symbol level. It's basically giving Claude the same tools a developer has in their IDE.

vexp does something different: it pre-computes a full dependency graph from the AST and serves token-budgeted context capsules. So instead of the agent making 5 tool calls to navigate the code (find this symbol, now find its references, now find what calls that), it gets the relevant subgraph in one shot. Less back-and-forth, fewer tokens spent on exploration.

The other piece Serena doesn't cover is cross-session memory. vexp persists what the agent explored and learned, links it to the code graph, and auto-stales it when code changes.

Honestly they solve different layers of the same problem. Serena gives agents better hands within a session, while vexp gives them a map of the codebase and a memory that carries over. You could run both.

### (3) u/elpigo
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bbzjg/
remind me! 2 weeks

### (3) u/kknow
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79hxnc/
Yeah we are the same. I use claude for coding a lot now. We introduced our own flows but they are still context heavy since we clear context a lot to reduce the possibility of claude itself using too much context and producing bad code.  
But even then we review everything and we also still find quite a few things to change before shipping.  
Right now I don't think we can get the confidence high enough to ship without human layers

### (3) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o799vvk/
Session amnesia is something we've hit hard running AI agents continuously in production. Each agent wakes up with zero memory of what other agents did 20 minutes ago.

The approach that's worked for us: a shared state file that agents write structured summaries to after each task — not conversation history, but facts. 'Task WQ-X: deployed Y, result: Z.' New agents read this before starting and skip re-discovering what's already known.

The dependency graph angle in your writeup is clever because it's *typed* context, not raw file contents. That's the key insight — Claude doesn't need to *read* the codebase, it needs to know the *shape* of the codebase. Those are different token budgets.

### (3) u/Somecount
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o788rpq/
Either you have spent a lot if time reading Claudes responses or you are them. I know I did and listens to each response as well.

### (3) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77ceah/
Context isolation is the real unlock. When we moved to per-agent context boundaries in our multi-agent pipeline, token efficiency improved dramatically — but the bigger win was correctness. Agents stopped hallucinating from irrelevant context bleed. A dependency graph approach makes a lot of sense for codebases where the call graph is well-defined. One thing we've noticed: the session memory across runs is tricky when multiple agents are writing to shared state. How are you handling concurrent agents that might have conflicting views of what 'changed' since last session?

### (3) u/ax3capital
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7798ll/
thank u kindly

### (3) u/lionmeetsviking
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o777q58/
How would you compare this to using skills? 

I’ve approached my projects by trying to architect them as modular as possible. This means that there are usually easily recognisable patterns that are module bound. And then the skill is easy for Claude/Codex to identify.

### (3) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o774x3x/
The AST analysis runs under the hood to build the dependency graph and power the diff engine. What the model sees are 10 MCP tools that sit on top of it...things like get\_context\_capsule (gives relevant code for a query), get\_impact\_graph (shows what breaks if you change something), search\_logic\_flow (traces execution paths between functions).

So the model doesn't parse the AST itself, it just gets the results of that analysis in a format it can actually use.

### (3) u/KhabibNurmagomurmur
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76qa2b/
Trying this today. I hate having to fire up a new session to lay a bunch of groundwork for context all over again. 

Do you have any examples of what this dependency graph looks like, like what it's storing? And is there an onboarding process or does it only learn as you go?

Edit: you can ignore these questions, I didn't see your "how it works" section initially, it explains a lot.

### (2) u/messiah-of-cheese
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bll12/
Agree with the other people here, would be better as a CLI tool too.

Keep going buddy.

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bk1ys/
You're right the homepage needs work, I'll trim it down. It's a VS Code extension that gives Claude Code (and other agents) a dependency graph and session memory via MCP. Install it, open a project, Claude gets better context automatically.

As for the pricing: free tier is 2k nodes with all memory tools, that covers most individual projects. But I hear you, I'll revisit the limits. Appreciate the honesty.

### (2) u/Rosell_DK
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7b555a/
following

### (2) u/marcopaulodirect
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7axm9d/
Ping me three

### (2) u/ShroomShroomBeepBeep
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7an8ky/
Yeah, a Claude plugin costing the same monthly amount as Claude Pro itself is a choice.

### (2) u/domus_seniorum
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7an2ah/
wow,
merci,
heute habe ich also was vor 🤗

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7alddn/
You can install right now! Just search "vexp" in the VS Code extensions marketplace and install it. Open your WordPress project and it starts indexing automatically (follow the official doc [https://vexp.dev/docs](https://vexp.dev/docs) or write me a DM if you will face some issues) . No terminal needed.

The CLI version that's coming is for people who don't use VS Code at all. Since you're already in VS Code with Claude Code, you're good to go with the extension as it is.

### (2) u/SmartestCatHooman
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7ahz1m/
Remind me! Two weeks

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7agy6t/
For a single WordPress theme, your md-file setup honestly sounds like it's already working well. A theme project would fit easily in the free tier, so there's no risk in trying it.

Where it might help you: if Claude keeps recreating things that already exist in your theme or forgets decisions from previous sessions. If that's not a problem for you right now, your current setup is solid.

### (2) u/Intelligent-Plane402
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7ac109/
Contattami per favore grazie

### (2) u/harshamv
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a6jts/
Looks promising. Will wait for the cli tool

### (2) u/JasonStathamBatman
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a639j/
following

### (2) u/Arctic_Chaos
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79jgus/
sweet, can't wait!

### (2) u/its_witty
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79gs11/
I see it supports both Codex in VSCode and Antigravity.

What happens if I use Codex in VSCode to do some backend work and then switch to Antigravity for Gemini to do frontend? Will the files the extension generate get overwritten to suit different agent and replace Codex memory with a fresh Gemini one? 

Will it be better to use Gemini extension in VSCode for such? 
Does it create separate memories?

### (2) u/Otherwise_Bee_7330
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o793hcx/
not a single data point or coherent example to prove that it works at all

I would bet this loses to well maintained memory files every single time

### (2) u/Lovecore
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o792cne/
!remindme 7 days 

Checking for cli

### (2) u/Goould
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o790nm0/
!RemindMe 7 days

### (2) u/Sudden_Surprise_333
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78zij3/
Discard my other comment. I want in on the cli notifications.

### (2) u/r2tincan
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78pimc/
Following

### (2) u/entheosoul
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78mvvk/
Definitely not enough when you work on complex projects and need to be able to switch between them,  replay, audit, and store the artifacts that led to the memory or create connections like dependency graphs but not just for code, for the thinking that went behind the code for tool graph dependency so you can have the AI understand what tools to use when... And contextually relevant injection of stored related memories like mistakes made, dead ends, unknowns, predictions, assumptions...  I built something that does all this if interested

### (2) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78cwiy/
Dependency graphs are underrated for multi-agent setups too. When you have 6 agents all reading the same codebase, the token cost multiplies — each agent rebuilds its own mental model from scratch. We ended up with a shared context layer that agents reference instead of re-ingesting files. The graph structure makes invalidation clean: change a model, you know exactly which agents need to re-sync their working context. Without it, we were paying 3-4x the tokens for work that overlapped heavily across agents.

### (2) u/DestinTheLion
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7880lk/
Ty

### (2) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7823vy/
Dependency graph approach is sharp — we've been wrestling with the same problem running 6 agents concurrently on a shared codebase.

The token explosion happens because each agent re-reads context it already has. A local graph that says 'this agent only needs modules X, Y, Z' is effectively a scoping layer. We ended up building something similar to avoid agents stomping on each other's assumptions.

One thing we found: the graph needs to be dynamic, not static. When agent A modifies a module, any downstream agent needs that invalidated — otherwise you get stale context collisions that are genuinely hard to debug. How are you handling graph invalidation after writes?

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o781mnq/
Not yet, Rider is on the roadmap as part of JetBrains support. For now it's VS Code only, but CLI is coming in the next few days which would work alongside any IDE.

### (2) u/friedinando
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o780het/
+1

### (2) u/shooshmashta
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77w4xk/
Vb would also be nice. There are a lot of companies out there using ancient software. Epic for example

### (2) u/HostNo8115
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77u4wo/
Does this dep graph preserve parts of my chat history too? Many times I dictate a ton of my thoughts and reasoning behind an ask, etc. as part of my prompting process. And this is important to give full context to the LLM (so for e.g. if I explain why i dont something, i shouldnt have to keep repeating this preference in every cross-session prompt - a human wouldnt need me to).

And code comments - are they captured and queried too? I ask my coding agents to add copious inline comments, and would need that to be part of the dep graph based context too.

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77ssi1/
Cipher is a solid memory layer, different focus though. It's primarily about persisting what the agent learned using vector embeddings, so it needs API keys (OpenAI, Anthropic, etc.) and optionally an external vector store like Qdrant.

vexp does two things Cipher doesn't: first, it builds a dependency graph of your actual code structure, so agents get precise context instead of reading whole files. That's the token reduction side. Second, the memory system is linked to the code graph, when code changes, observations about that code auto-stale. Cipher stores memories, but it doesn't know if the code those memories refer to has changed since.

The other difference is dependencies. Cipher needs API keys for embeddings and optionally Docker + a vector DB. vexp is a single Rust binary with SQLite, zero external dependencies, zero network calls. Nothing leaves your machine.

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77pp1v/
Yeah 24/7 agents are a different beast, token waste compounds fast when there's no human going "wait, why are you reading that file again."

For big refactors: the file watcher picks up changes in real time and the graph incrementally re-indexes only the affected files. It doesn't rebuild from scratch. Each file change triggers an AST diff so the graph knows exactly which symbols were added, removed, renamed, or had their signature changed. Downstream edges get updated automatically.

The memory side is where it gets more interesting after a refactor. If an agent learned "function X handles validation" and then X gets renamed or its signature changes, that observation gets flagged stale. But if someone renames the file without changing the function bodies, the rename detection picks that up via body hash matching and the observations survive with updated references.

Worst case after a truly massive refactor (like restructuring half the project), you can force a full re-index from the sidebar. Takes a few seconds on a medium codebase. Memories linked to deleted symbols get marked stale permanently but stay searchable as historical context.

Curious about your setup, are your 6 agents sharing context through a common store or does each one maintain its own view?

### (2) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77on6n/
Token efficiency hits differently when your agents run 24/7 with no human stopping them.

We coordinate 6 agents that ship code to production daily — the dependency graph approach you're describing is basically what we had to build for context management between agents. Each agent needs to know what other agents touched recently without re-reading the whole codebase.

The 65% reduction makes sense. The model doesn't need file contents if it already knows the dependency structure. What's your approach when the graph goes stale after a big refactor?

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77mos4/
Yeah that context bleed issue is real. Dumping everything into one big context is how you get Claude confidently using a function signature that changed three files ago.

On the concurrent agents question — each agent gets its own session ID and agent ID in the observation log, so their views don't bleed into each other. If agent A and agent B both modify auth.ts in the same window, the correlator attributes each change to the right agent based on the tool call timing. The staleness system works at the symbol level, not the session level, so if agent B changes a function that agent A had observations about, those observations get flagged stale regardless of who made the change.

Where it gets genuinely hard is conflicting \*decisions\*. Agent A decides "use JWT" and agent B decides "switch to session tokens" in parallel. Right now both observations persist and the next agent sees both with timestamps. Not ideal — I don't have automatic conflict resolution yet. On the roadmap but honestly it's a hard problem.

How are you handling it in your pipeline? Curious if you've found something that works beyond "don't let two agents touch the same scope."

### (2) u/shyney
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o777byq/
Please also add qml support. Would be nice 🙂 and cli only solution for non vsc users.

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7774mm/
Nah it's more than that...The [CLAUDE.md](http://CLAUDE.md) generation is just the setup step so Claude knows the tools exist.

The actual engine does two things:

1. It builds a live dependency graph of your codebase: every function, class, type, and the relationships between them (who calls what, who imports what). When Claude needs context for a task, instead of reading whole files, it calls get\_context\_capsule and gets back only the relevant code scoped to a token budget. So 2.4k tokens of precise context instead of 18k tokens of "here's the whole file, good luck."

2. It remembers across sessions. What Claude explored, what decisions were made, what patterns were noticed, all stored locally and linked to the code graph. Next session that context surfaces automatically. If the code changed since, those memories get flagged stale.

So [Claude.md](http://Claude.md) is just the door. The dependency graph and the memory system behind it are the actual product.

### (2) u/Business-Weekend-537
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7748qa/
Cool, please dm me when the command line version is ready

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o773ef3/
Not open source at the moment, but the binary runs 100% locally though, zero network calls, so no data leaves your machine.

For cost: free tier is 2k nodes with all memory tools included, that covers most individual projects comfortably. A typical React + API codebase sits around 500-1500 nodes. Pro is $19/mo if you need multi-repo support and larger projects (up to 50k nodes).

No credit system, no usage caps, flat pricing. And the free tier doesn't expire.

### (2) u/PraZith3r
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76vmw0/
Ping me also :)

### (2) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76s9pu/
Nice, let me know how it goes. The graph starts building the moment you open a project, no onboarding needed. It parses your code's AST and extracts every function, class, interface, type, and exported variable as nodes, then maps the edges between them: imports, calls, type references, cross-file dependencies. On a typical React + API project it takes a few seconds to index.

So if you ask Claude about an auth middleware, instead of dumping the whole file, it serves a capsule with that function + everything it depends on and everything that depends on it, scoped to a token budget. Claude gets precise context instead of "here's 400 lines, figure it out."

The memory layer builds as you go. First session it's mostly the graph doing the work. By session 3-4 you start seeing observations from previous sessions surface automatically, with stale flags if the code changed since.

Status bar in VS Code shows the node count after indexing so you can see exactly what it picked up.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bnd54/
Free tier is there for a reason. Try it first, decide later.

### (1) u/CuteKiwi3395
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bn1sj/
lol $20 a month when I’m already paying for Claude, nah hard PASS! I guess this will be useful to vibe coders.

### (1) u/messiah-of-cheese
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bjcjw/
Home page is way too wordy, couldnt be bothered to read it after it started sounding like slop.

Very restrictive free v.s. paid tier for a 100% local application.

Because the home page is so wordy, I dont know what it really does or how it even works with CC. The pricing list says something about an extension... to what?

I dont know the state of this or anything, business wise. But it seems to me like you got greedy too early.

Sorry if this sounds harsh

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bixll/
CLI is coming in the next few days.

Interesting take on versions. The free tier already includes all memory tools and passive observation, the main limits are node count (2k) and single repo. Pro unlocks multi-repo, higher node cap, and advanced graph tools like impact analysis and logic flow search. But I hear you, I'll think about it.

### (1) u/Foi_Engano
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7bb76s/
Great! Now we need for cli.

A suggestion: change free version tô Full, but only for 1 project/Repo

### (1) u/mkaaaaaaaaaaaaaaaaay
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7b53d1/
Great idea, thank you. Building this out now.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7ayg1d/
Thanks! Let me know

### (1) u/marcopaulodirect
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7axp09/
!RemindMe 7 days

### (1) u/its_witty
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7axe2y/
Sounds awesome, I'll definitely try it out!

### (1) u/domus_seniorum
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7akc9b/
sorry, letzte Frage 🤗, ich arbeite ja mit Claude Code. Da kommt noch was für Terminal auf meinem Mac? Oder kann ich jetzt schon installieren? Beim Lesen habe ich gesehen, dass von Dir noch eine Terminal Version kommt?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7aimx5/
That consistency problem across page templates is actually a great use case for the dependency graph, it tracks which variables and functions are shared across files, so Claude sees "this variable is used in 5 templates" before touching anything. Might save you some of that manual teaching.

Since you're rebuilding your instructions anyway, good timing to try it. Install vexp, let it index your theme, and it'll auto-generate a claude.md. You can then add your custom rules on top of that.

And if you're close to hitting your Pro limits, the 65% token reduction would stretch that subscription a lot further.

### (1) u/domus_seniorum
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7ai1mx/
insgesamt scheine ich ihn gut im Griff zu haben. Anfangs hatte ich nachschärfen müssen, dass er tatsächlich die Wordpress Konventionen einhält und mein "Hauptproblem" ist eher, dass er etwas Schwierigkeiten hat, gleiche Funktionen in allen Seitentemplates synchron durchzuziehen. Gleiche Variabel für gleichen Funktionsbereich bringe ich ihm also gerade bei. 

Was ich noch nicht wusste, ich baue ihm heute eine claude.md und baue meine Anweisungen auf jetzt erreichter Basis noch mal neu. Das mache ich sowieso bei jedem erreichten Zwischenstand. Sowas macht mir Spaß 😁

Im Moment komme ich jede Woche knapp mit einem normalen Pro Abo aus 🤗

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7agoyq/
yes, you should have a vexp.log file inside .vexp folder. Could you please send it to me in DM?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7agicy/
The duplicate problem is exactly what the dependency graph kills, Claude sees what already exists before writing anything new. Let me know how it goes, and if you need help setting it up.

### (1) u/domus_seniorum
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7agbfx/
nach dem x-ten lesen, als sehr interessierter Nicht-progger, der gerade ein sehr individuelles Wordpress Theme selbst baut, habe ich das Prinzip nachvollzogen und - wirklich geil 🤗

Frage, macht das auch für mich Sinn? Da ich kein komplettes Programm entwickele, sondern ein Theme auf Wordpress aufsetze?

Ich arbeite jetzt schon intensiv und systematisch durchdacht mit md Dateien und mein Tokenverbrauch ist, scheint es, schon jetzt moderat. Er darf meine md nur lesen, nicht verändern und hat nur eine einzige md Datei, die er für seinen Fortschritt schreiben darf - und natürlich die Theme Dateien selbst 😁

Danke für einen Tipp an mich alten phantasiegeplagten Onlineunternehmer, dem sich eine wunderbare Welt aufgetan hat 🤗

### (1) u/ardicli2000
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7agaz8/
\- I am using CC in [Terminal.App](http://Terminal.App)

\- I did not see any bar in VSC. It just created a .vexp fodler with two files in it.

When I started CC, it opened up mcpserver.mjs file and i checked with /mcp. It reported failed.

I deleted afterwards. If you need me do some testing I am happy to help.

### (1) u/m15k0
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7ag6s5/
Not developer by any shot as people here but been playing with Claude Code doing some amazing stuff never had time to pick up. Can say something like this would help a lot as right now what I have is set of .md files in .claude/rules/ defining what is out there and path dependant so Claude knows when to read what to understand what is in that folder, what can / can't be done.... Works amazingly well but with bigger things, more complex codebases it definitely needs something better as it becomes really hard when you have to do bit more complex work, context gets filled up so fast, but what I hate more is when you end up with duplicates as sometimes agents decide to build their own version of alredy existing... so glad to see this problem gets addressed by more and more people, will give it I try.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7ag5tu/
That's a solid starting point and honestly gets you further than most people realize. Opus is right that it doesn't need a static file structure dump since it can already see your project tree.

The gaps show up in three places:

First, relationships. Your cheatsheet has method signatures, but it doesn't tell Claude that changing validateToken breaks 4 downstream consumers in 3 different files. The dependency graph tracks those edges automatically.

Second, maintenance. Your cheatsheet is accurate the day you write it. A week later someone adds a parameter, renames a method, moves a file. Now it's silently wrong and Claude is working from stale info with no way to know. vexp rebuilds incrementally on every file save.

Third, cross-session context. Your cheatsheet tells Claude what the code looks like. It doesn't tell Claude "last Tuesday you spent 30 minutes debugging a race condition in this exact function and the fix was X." The memory layer captures that and surfaces it automatically, with stale flags if the code changed since.

For a small project that doesn't change much, your approach works fine. The graph and memory start earning their keep when the codebase grows, changes frequently, or you're working across multiple sessions where continuity matters.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7af887/
Can you share a bit more? Specifically:

\- Are you using Claude Code in VS Code or in the terminal?

\- Do you see vexp running in the status bar?

\- Any error message?

### (1) u/Whiden0
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7aevar/
How does this compare to just building a cheatsheet.md that contains methods signature per class and a structure.md which contains file structure with light descriptions? That's what I did, and when asking opus, opus told me to archive the structure file because Claude has already access to file structure through my project and it didn't need to actually get it from a file post initial setup.

### (1) u/ardicli2000
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7adz7j/
Claude could not connect mcp server

### (1) u/dat_cosmo_cat
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7aalgy/
how are you enforcing per-agent context scoping exactly? like init each agent in different sub-directories of a broader codebase?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a3kio/
Repomix packs your entire codebase (or parts of it) into a single XML file that you feed to an LLM. It's great for one-shot analysis, but it's a snapshot. Every time you want context, it re-packs, and the agent gets everything rather than just what's relevant to the task.

vexp is the opposite approach: it builds a live dependency graph that stays updated as you code, and when the agent needs context it serves only the relevant subgraph scoped to a token budget. So instead of 30k tokens of "here's the entire repo," you get 2-3k tokens of "here's exactly what matters for your question."

The other big difference is memory. Repomix is stateless, it packs, you use it, done. vexp persists what the agent learned across sessions and links that to the code graph, so observations go stale when code changes.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a3euh/
Good question, I have two things to say:

Config files: each agent gets its own config file and they don't overwrite each other.

Memory: observations are shared across all agents automatically. The system stores them in a flat observation store with no agent-based filtering, so if Claude Code explores the backend auth flow on Monday and then you switch to Cursor for frontend work on Tuesday, Cursor sees everything Claude learned about the backend. Sessions track which agent created them, but the observations themselves are globally visible; cross-agent memory means Gemini doesn't start from zero just because Claude did the earlier work.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a2wlz/
Yep, Antigravity is fully supported. Same auto config and install as claude code.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a29ck/
I haven't published formal benchmarks yet, that's on the roadmap. The 65% token reduction comes from comparing capsule size vs full file reads on the same queries across a few real projects, but I haven't packaged that into something reproducible.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a1xcf/
CLI is dropping in the next few days, should work in PowerShell no problem, I'll update the thread.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a1t5j/
Appreciate it!

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a1ptx/
That's exactly the insight that got me started, the incentive for AI providers to reduce context is basically zero. Let me know how it goes if you try it.

### (1) u/Wooden-Pen8606
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7a06or/
The most I have been able to push my max plan is to 26% in the 5 hour limit. I have no idea how you guys are maxing out so quickly. I'm only on day 10 of using it though and I've learned a lot in those few days.

### (1) u/williamtkelley
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79yojn/
How does this differ from repomix MCP?

### (1) u/Gibis83
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79vmx0/
Will this work on Antigravity?

### (1) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79ojru/
The dependency graph angle gets even more interesting when multiple agents are sharing the same codebase. Context drift becomes a coordination problem — agent A has a mental model of module X, agent B has a stale one, and they're both editing. The shared index approach solves this better than per-session context: one canonical graph that all agents read from, invalidated on write. We run 6 agents on a shared Rails codebase and the index layer is what keeps them from stepping on each other's feet.

### (1) u/Redditstole12yr_acct
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o796gps/
Remind me! Two weeks

### (1) u/No-Cardiologist1196
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o796awk/
Please ping me!

### (1) u/skankhunt_697
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o795zuw/
Ping me too

### (1) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o793yue/
Session amnesia is exactly the problem that pushed us toward a work queue architecture. Instead of each agent session rediscovering context, tasks carry their own state — what was attempted, what succeeded, what the next agent needs to know. The dependency graph you built solves it at the file level; we solved it at the task level. Both approaches point at the same root issue: LLM sessions have no memory of prior work, so something external has to hold that continuity.

### (1) u/Sudden_Surprise_333
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78z2hb/
Any way to get this working on Claude cli?

### (1) u/IntroVertticle
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78yl1b/
Let us know when the Claude Code on Powershell version is available please

### (1) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78yk4j/
Session amnesia is the deeper problem, and you've nailed it.

Running 6 AI agents simultaneously, we hit the same issue — each agent independently re-reading shared files meant token costs multiplied by agent count. The dependency graph approach makes this worse: if agent A and agent B both need the same module's context, they're each building that graph from scratch.

What we ended up doing was treating the dependency graph as a shared artifact that gets serialized to disk and loaded at session start, not rebuilt per-query. Agents read from a cache, only invalidating specific nodes when files change. Token cost for context became nearly flat across agents instead of linear.

The graph itself is surprisingly small — under 50KB even for larger codebases. The expensive part was always the re-reading, not the structure.

### (1) u/RemindMeBot
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78omzs/
I will be messaging you in 7 days on [**2026-03-04 00:42:20 UTC**](http://www.wolframalpha.com/input/?i=2026-03-04%2000:42:20%20UTC%20To%20Local%20Time) to remind you of [**this link**](https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78ojfu/?context=3)

[**5 OTHERS CLICKED THIS LINK**](https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Reminder&message=%5Bhttps%3A%2F%2Fwww.reddit.com%2Fr%2FClaudeCode%2Fcomments%2F1rdo5ul%2Fi_cut_claude_codes_token_usage_by_65_with_a_local%2Fo78ojfu%2F%5D%0A%0ARemindMe%21%202026-03-04%2000%3A42%3A20%20UTC) to send a PM to also be reminded and to reduce spam.

^(Parent commenter can ) [^(delete this message to hide from others.)](https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Delete%20Comment&message=Delete%21%201rdo5ul)

*****

|[^(Info)](https://www.reddit.com/r/RemindMeBot/comments/e1bko7/remindmebot_info_v21/)|[^(Custom)](https://www.reddit.com/message/compose/?to=RemindMeBot&subject=Reminder&message=%5BLink%20or%20message%20inside%20square%20brackets%5D%0A%0ARemindMe%21%20Time%20period%20here)|[^(Your Reminders)](https://www.reddit.com/message/compose/?to=RemindMeBot&subject=List%20Of%20Reminders&message=MyReminders%21)|[^(Feedback)](https://www.reddit.com/message/compose/?to=Watchful1&subject=RemindMeBot%20Feedback)|
|-|-|-|-|

### (1) u/CatsFrGold
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78ojfu/
RemindMe! 7 days

### (1) u/dubitat
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78hhbk/
brilliant!

### (1) u/Goould
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78h9so/
Followed. Thanks and good luck !

### (1) u/Efficient_Ant6223
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78cfu2/
I was just starting to think I need to build this. From a pure motivation standpoint, for mid to large codebases, any AI provider wouldn't want to do this. Makes sense long term.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o781hce/
Codex is one of the 12 agents vexp auto-configures out of the box. Just install the extension and open your project, it'll detect Codex and generate the right config.

### (1) u/Arctic_Chaos
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o780rju/
is there a way to integrate it on rider?

### (1) u/mimizone
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o780lzn/
Wha would that take to make it compatible with Codex?

### (1) u/shooshmashta
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77xzw4/
[github.com/CodeAnt-AI/tree-sitter-vb-dotnet](http://github.com/CodeAnt-AI/tree-sitter-vb-dotnet)

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77xe9k/
Yeah legacy codebases are exactly where good context tooling matters most...nobody remembers how that 15 year old VB codebase is wired together. I'll look into tree-sitter grammar availability for VB and add it to the list.

### (1) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77uon5/
Token bloat across agent handoffs is the real killer in multi-agent systems. We run 6 AI agents that coordinate on the same codebase — the dependency graph approach resonates deeply. Context accumulates across agents when there's no explicit boundary for what each agent actually needs to see. We've found that per-agent context scoping (each agent only sees diffs relevant to its role) cuts wasted cycles significantly. The insight about what ISN'T relevant is underrated — most token optimization focuses on compression but selective exclusion is more powerful.

### (1) u/HostNo8115
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77rs1j/
I've been searching for something like this. How does it compare with [https://github.com/campfirein/cipher/](https://github.com/campfirein/cipher/)?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77o9rh/
Thanks! Let me know how it goes if you try it.

### (1) u/HostNo8115
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77o5ql/
I mean - it adds competition, right? What is this other product u are referring to, btw?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77o46c/
That's a clever setup, basically a manual observation pipeline. The closing hook asking the orchestrator for lessons is smart,  you're capturing the "why" not just the "what."

The main difference is yours relies on the agent cooperating at close time. If the session crashes, times out, or the agent just doesn't produce great lessons that run, you lose that context. The passive piece in vexp captures everything as it happens, every tool call, every file change at the AST level, so even messy sessions where the agent went in circles leave useful traces.

The other thing is staleness. Your [lessons.md](http://lessons.md) might say "service X uses Redis for caching" but if someone swapped Redis for Memcached last week, that lesson is now wrong and there's no automatic way to know. vexp links observations to specific symbols in the graph, so when that code changes the linked memory gets flagged.

But honestly your setup is more than most people do. The hook-based approach is solid if you're willing to maintain the scripts.

### (1) u/Hot-Landscape4648
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77mcvm/
Awesome!

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77m5h5/
That's a really similar philosophy actually, detect changes, rebuild context, inject it. Sounds like you've wired together what I ended up building as a single system.

Couple things vexp adds on top: the dependency graph isn't just regenerated, it's incrementally updated on every file save so there's no "run script" step. And the context injection is token-budgeted — it doesn't dump the whole graph, it picks the relevant subgraph for whatever the agent is working on. The passive observation piece also captures stuff your hooks might miss, like when the agent explores code without modifying anything, or when it goes down a dead end.

Curious how you handle staleness, like if the dependency graph says X depends on Y but someone refactored Y since last run?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77m14a/
That's a solid approach honestly. If your codebase is modular enough that skills map cleanly to modules, you're already ahead of most projects.

Where it starts to break down in my experience is cross-module dependencies, when changing something in one module quietly affects three others. That's where the graph helps, it tracks those relationships automatically so the agent knows the blast radius before touching anything. And the memory layer means if Claude figured out a tricky interaction between two modules last week, that context is still there next session without you encoding it into a skill manually.

But yeah if your architecture is clean and skills are working, that's a legit setup.

### (1) u/shogster
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7780wq/
Will check it out.   
Is this useful for Playwright framework projects, or a [Memory.md](http://Memory.md) file is the better approach? So Claude knows how a fixture or an API controller or endpoint in an API test suite should look like?

### (1) u/kvothe5688
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o777uy7/
i build the same thing but with hooks and skills. there is a dependency generator script that runs after every successful issue close. which update dependency graph. when new issue start starting hook tells the agent that you should run context injection script which it runs and takes output. same for subagent. whenever it runs researcher or verifier subagent hook tells it to run context injection file and output is given to subagent

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o777n40/
Qml is an interesting one, tree-sitter does have a grammar for it so it's doable. Adding it to the list.

CLI is coming in the next few days, I'll update the thread when it's live.

### (1) u/saymynamepeeps
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o776ani/
I’m still confused. This basically just reads your folder and try to generate some kind of Claude.md file for say Claude code to read as context?

### (1) u/rdalot
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o775rr1/
Have you considered using Serena? If yes what made you go for a custom tool with tree sitter?

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o774mbz/
Yep, C++ is fully supported. Right now it covers TypeScript, JavaScript, Python, Rust, Go, Java, C#, C, C++, Ruby, and Bash, each with a dedicated tree-sitter parser. Should work out of the box on your codebase.

### (1) u/Fresh_Profile544
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7745c3/
For ast, do you expose that to the model as a new tool?

### (1) u/shyney
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o773o9g/
Only for web development languages or also for languages like c++ etc?

### (1) u/DragonTree
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o7732mn/
Commenting to stay in the loop :)

### (1) u/SoaringRedCarpet
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o77311r/
Please ping me!

### (1) u/Business-Weekend-537
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o772viu/
Is it open source btw? It’s ok if it’s not I’m just curious about long term usage cost.

### (1) u/Business-Weekend-537
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o772org/
Ping me also please.

### (1) u/redacted_user
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o771gnc/
It activates per project. When you open a folder in VS Code it indexes that specific workspace. If you have multiple folders open in a multi-root workspace, each one gets its own graph.

It won't scan anything you don't have open.

### (1) u/bobaloooo
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o770s90/
Is it possible to activate per project or it automatically scans every project?

### (1) u/cicamicacica
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76z4yp/
Drop a comment here, I subscibed!

### (1) u/rocket_zen
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o76y1c6/
ping me too . thanks

### (0) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o79e33g/
Token waste from linear file reads is a real problem at scale. We hit this running 6 agents concurrently on the same codebase — each agent re-reading context the others had already processed.

The fix we landed on: agents write structured summaries to shared state files after each session. Downstream agents consume the summaries instead of re-reading source. Rough equivalent of your dependency graph but for inter-agent coordination rather than single-session context.

Still doesn't fully solve cold-start amnesia on the first run, but repeat sessions get dramatically cheaper. The 65% reduction number lines up with what we saw once agents stopped re-reading what was already known.

### (-1) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78t2vx/
Dependency graph approach is interesting — we hit a similar wall running 6 Claude Code agents in parallel. Without explicit dependency tracking, every agent was re-reading shared files and burning context on overlapping state.

The key insight for us: agents don't need to share context, they need to share an up-to-date index. We route all reads through a lightweight registry that tracks which files changed since each agent's last run. Cut redundant file reads dramatically.

Your tool looks like the next level of that — actually building the graph rather than just tracking timestamps. Curious how it handles circular deps in large monorepos.

### (-1) u/ultrathink-art
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o78i4go/
Session amnesia is the bigger pain than token cost, at least in our setup. We run 6 AI agents in production — designer, coder, QA, etc — and the cross-session context problem compounds badly when agents need to hand off work. Each new session re-learns things the previous one already figured out.

Dependency graphs help with file relevance, but we've found that the WHAT (which files matter) is easier to solve than the WHY (what constraints exist). The constraints don't live in files — they live in past decisions, failed attempts, rejected designs. That's what keeps getting re-discovered.

### (-5) u/Vivid_Search674
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o770fae/
Same copycat ai slop post of the day claiming same thing with 10 other Claudecode posts. Sharing somrthing you shared on vs code marketplace here is also pathetic

### (-6) u/Vivid_Search674
- Permalink: https://www.reddit.com/r/ClaudeCode/comments/1rdo5ul/i_cut_claude_codes_token_usage_by_65_with_a_local/o771wox/
Literally, you copied a whole product and vibe coded everything. Even this answer with "fair enough" start which is copy of 'youre absolutely right" is ai slop. Pathetic because vibe coders have same one ending.