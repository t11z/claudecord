<p align="center">
  <img src="assets/banner.svg" alt="claudecord — @claude for Discord" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/t11z/claudecord/actions/workflows/ci.yml"><img src="https://github.com/t11z/claudecord/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-D97757" alt="MIT license" /></a>
  <a href="https://t11z.github.io/claudecord/"><img src="https://img.shields.io/badge/docs-github%20pages-5865F2" alt="Documentation" /></a>
  <a href="https://github.com/t11z/claudecord/pkgs/container/claudecord"><img src="https://img.shields.io/badge/ghcr.io-amd64%20%7C%20arm64-D97757" alt="GHCR image (amd64 & arm64)" /></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-2ea44f" alt="Node >= 20" />
</p>

<h3 align="center">Mention the bot. Get Claude. In a thread, with memory.</h3>

<p align="center">
  <b>claudecord</b> brings the <code>@claude</code> experience you know from GitHub to your Discord server —
  self-hosted, open source, with <b>no shared, instance-wide credential</b>. Every member links
  their own Claude subscription and every run is billed to them, not the operator.
</p>

---

## How it feels

```
#general
  you      @Claude our deploy script keeps timing out, any ideas? 📎 deploy.sh
  Claude   👀
  └─ 🧵 "our deploy script keeps timing out…"
       Claude   Looking at your script, three things stand out… ▌   ← grows live
       you      can you rewrite it with retries?
       Claude   Sure — here's the updated script: …                 ✅
```

One mention opens a thread. Everything in that thread is one conversation —
Claude remembers all of it, even across bot restarts.

## Features

| | |
| --- | --- |
| 🧵 **Threads with memory** | Every conversation maps to a persistent Claude session (`resume` under the hood) |
| 🔑 **Per-user subscription auth** | Each member runs `/link-claude` and pastes their own `claude setup-token` output. No shared token, no shared limits |
| ⚡ **Streaming feel** | 👀 → live-growing reply → ✅. Code fences are never split across messages |
| 📎 **Attachments** | Send text files and images; long answers come back as `response.md` |
| 🎛️ **Admin dashboard** | Setup wizard, channel/role allowlists, live sessions, usage stats — in a Claude×Discord themed UI |
| 🤖 **Agentic mode (opt-in)** | File & shell tools in per-thread sandboxes. Off by default, admin-gated, Docker-first |
| 🐙 **Per-user GitHub (opt-in)** | Members `/link-github` their own account; agentic threads clone, push & open PRs as *them*, via `git`/`gh` |
| 🚦 **Limit-aware** | Per-user queue, friendly "resets at 3pm" messages, `/usage` command |
| 🐳 **One-container deploy** | `docker compose up -d` and you're live |

## Quickstart

**You need:** Docker and 5 minutes. Each member who talks to the bot will need their own Claude
Pro/Max subscription (or Anthropic Console access) to run `claude setup-token`.

```bash
# 1. Run the bot
git clone https://github.com/t11z/claudecord.git
cd claudecord
docker compose up -d

# 2. Finish in the browser
open http://localhost:3000   # setup wizard: paste the Discord bot token, invite the bot

# 3. In Discord, each member links their own subscription
/link-claude link            # opens a modal — paste the output of `claude setup-token`
```

Then mention the bot in any channel. That's it.

📚 **[Full documentation →](https://t11z.github.io/claudecord/)** — setup
guides, configuration reference, security notes and maintainer docs.

## Commands

| Command | |
| --- | --- |
| `@Claude …` | Start a conversation (opens a thread) |
| `/ask` | One-shot question, optionally private |
| `/reset` | Make Claude forget the current thread |
| `/usage` | Server usage & queue stats |
| `/model` | Sonnet / Opus / Haiku for new threads *(admin)* |
| `/config` | Allowlists, agentic mode, on/off *(admin)* |
| `/link-claude` | Connect your own Claude subscription — required before the bot will run for you |
| `/link-github` | Connect your own GitHub account for agentic runs *(optional)* |

## A note on security & fair use

- **Agentic mode** gives Claude shell access inside a sandbox. It's off by
  default for a reason — read the
  [security docs](https://t11z.github.io/claudecord/guide/access-control/)
  before enabling it, and run the bot in Docker.
- claudecord has **no shared, instance-wide Claude credential**. Every run is
  billed to the Discord user who started it, via their own `/link-claude`.
  You self-host the infrastructure (the Discord bot); each member brings their
  own subscription and their own rate limits.

## Contributing

Contributions are very welcome — this project is deliberately built to be
hackable: TypeScript everywhere, no ORM, no framework magic, pure functions
where it counts, and a documented
[architecture](https://t11z.github.io/claudecord/maintainer/architecture/).

- 🟢 Start with a [`good first issue`](https://github.com/t11z/claudecord/labels/good%20first%20issue)
- 📖 Read [CONTRIBUTING.md](CONTRIBUTING.md) (5-minute dev setup)
- 💬 Or just open a [discussion](https://github.com/t11z/claudecord/discussions) — ideas welcome

```bash
npm install && npm run dev     # bot
npm run dev:dashboard          # dashboard with hot reload
npm test                       # no tokens needed
```

## License

[MIT](LICENSE) — do whatever makes your server happier.

---

<p align="center">
  <sub>Not affiliated with Anthropic or Discord. Claude is a trademark of Anthropic, PBC.</sub>
</p>
