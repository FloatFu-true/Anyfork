<a id="readme-top"></a>

<div align="center">
  <a href="https://github.com/FloatFu-true/Anyfork">
    <img src="./assets/logo/anyfork-logo.svg" alt="AnyFork Logo" width="280" height="162">
  </a>

  <h3 align="center">AnyFork</h3>

  <p align="center">
    Fork local sessions across Codex, Claude, and Gemini with native resume-oriented handoff.
    <br />
    <a href="./README.zh-CN.md">简体中文</a>
    ·
    <a href="https://github.com/FloatFu-true/Anyfork/issues">Report Bug</a>
    ·
    <a href="https://github.com/FloatFu-true/Anyfork/issues">Request Feature</a>
  </p>

  <p align="center">
    <a href="https://www.npmjs.com/package/@floatfu-true/anyfork-cli"><img src="https://img.shields.io/npm/v/@floatfu-true/anyfork-cli?style=for-the-badge" alt="NPM Version"></a>
    <a href="https://www.npmjs.com/package/@floatfu-true/anyfork-mcp-server"><img src="https://img.shields.io/npm/v/@floatfu-true/anyfork-mcp-server?style=for-the-badge" alt="MCP Version"></a>
    <a href="https://github.com/FloatFu-true/Anyfork/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FloatFu-true/Anyfork?style=for-the-badge" alt="MIT License"></a>
    <a href="https://github.com/FloatFu-true/Anyfork/issues"><img src="https://img.shields.io/github/issues/FloatFu-true/Anyfork?style=for-the-badge" alt="Issues"></a>
  </p>
</div>

## Table Of Contents

- [About The Project](#about-the-project)
- [What Is New In 0.1.8](#what-is-new-in-018)
- [Packages](#packages)
- [Getting Started](#getting-started)
- [CLI Usage](#cli-usage)
- [MCP Usage](#mcp-usage)
- [Demo](#demo)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## About The Project

AnyFork is an open-source toolkit for one specific workflow:

move a real local conversation from one AI coding CLI into another one, preserve the visible transcript, and seed a target-native resumable session when the destination format is known.

AnyFork is intentionally local-first:

- preserve visible transcript order
- export inspectable bridge artifacts under `.anyfork/`
- seed native resume data for supported targets
- keep the public interface small enough to stay reliable

AnyFork is not trying to be:

- a cloud sync service
- a hosted memory backend
- a byte-for-byte clone of vendor-private hidden caches
- a replacement for Codex, Claude, or Gemini themselves

## What Is New In 0.1.8

- Added `anyfork mcp install` to register the AnyFork MCP server into Codex, Claude, and Gemini without overwriting existing MCP entries.
- The new installer checks whether `anyfork` is already present and only appends missing registrations.
- Supports `--platforms`, `--npx`, `--name`, and `--command` so the MCP install flow can fit local or published setups.
- Fixed `--npx` registration to target the published `@floatfu-true/anyfork-mcp-server@latest` package instead of assuming the CLI and MCP package versions always match.
- Previous `0.1.6` MCP search and import features remain unchanged:
  `anyfork_list_sessions`, `anyfork_find_relevant_sessions`, `anyfork_import_session`, `anyfork_find_and_import`.

## Packages

- `@floatfu-true/anyfork-cli`
  Main CLI for `fork` workflows.
- `@floatfu-true/anyfork-core`
  Core library for local session parsing, bridge artifacts, and native resume seeding.
- `@floatfu-true/anyfork-mcp-server`
  MCP server that lets models find relevant local sessions and import them into the current project.

## Getting Started

### Prerequisites

- `Node.js >= 22`
- source CLI installed locally
- target CLI installed locally if you want native resume handoff

### Install The CLI

```bash
npm install -g @floatfu-true/anyfork-cli
```

Verify:

```bash
anyfork --help
```

### Install The MCP Server

Global install:

```bash
npm install -g @floatfu-true/anyfork-mcp-server
```

One-off execution through `npx`:

```bash
npx -y @floatfu-true/anyfork-mcp-server@latest
```

## CLI Usage

If no subcommand is specified, AnyFork shows the main help.

```text
Usage: anyfork [OPTIONS]
       anyfork fork <FROM> <TO> <SESSION|last> [OPTIONS]
       anyfork mcp install [OPTIONS]

Commands:
  fork           Fork a source session from one CLI into another CLI
  mcp            Install or inspect AnyFork MCP integration helpers
  help           Print this message or the help of the given subcommand(s)
```

Core command:

```bash
anyfork fork <from> <to> <session|last>
```

Examples:

```bash
anyfork fork codex claude last
anyfork fork claude codex 20486cab-8ead-4410-b2d2-8bb6e66ae804
anyfork fork gemini claude 3c5c4e92-b356-483b-ab96-7d14321e7f0c
anyfork fork codex gemini last --prompt "Continue implementation"
anyfork fork codex claude last --dry-run
anyfork mcp install
anyfork mcp install --platforms codex,claude
```

Bridge artifacts are written to:

```text
.anyfork/bridges/<from>-to-<to>-<session>-<timestamp>/
  bundle.json
  handoff.md
```

Supported platforms:

- `codex`
- `claude`
- `gemini`

Supported directions:

- `codex -> claude`
- `codex -> gemini`
- `claude -> codex`
- `claude -> gemini`
- `gemini -> codex`
- `gemini -> claude`

## MCP Usage

### Why MCP Matters

The MCP package is designed for agent-driven workflows:

- find sessions related to the user request
- rank the best candidates by transcript and project match
- import the chosen session into the current project
- keep the resulting context resumable in the target CLI when supported

### Exposed MCP Tools

- `anyfork_list_sessions`
  List local sessions across Codex, Claude, and Gemini.
- `anyfork_find_relevant_sessions`
  Search sessions by task, bug, or feature description.
- `anyfork_import_session`
  Import a known session into a target platform for the current project.
- `anyfork_find_and_import`
  Search first, then import the best match in one call.

### Recommended Tool Calling Pattern

1. Call `anyfork_find_relevant_sessions` with the user request and current `cwd`.
2. Inspect the top candidates and confirm the score looks correct.
3. Call `anyfork_import_session` if the session id is known, or `anyfork_find_and_import` if you want one-step import.
4. Resume in the destination CLI through its native workflow.

### One-Command MCP Setup

AnyFork can now register its MCP server into Codex, Claude, and Gemini without overwriting other existing MCP entries:

```bash
anyfork mcp install
```

Useful variants:

```bash
anyfork mcp install --platforms codex,claude
anyfork mcp install --npx
anyfork mcp install --command "node C:/tools/anyfork-mcp-server.js"
```

### Add To Codex

Verified against local CLI help:

```bash
codex mcp add anyfork -- anyfork-mcp-server
```

Or with `npx`:

```bash
codex mcp add anyfork -- npx -y @floatfu-true/anyfork-mcp-server@latest
```

### Add To Claude Code

Verified against local CLI help:

```bash
claude mcp add anyfork -- anyfork-mcp-server
```

Or with `npx`:

```bash
claude mcp add anyfork -- npx -y @floatfu-true/anyfork-mcp-server@latest
```

### Add To Gemini CLI

Verified against local CLI help:

```bash
gemini mcp add anyfork anyfork-mcp-server
```

Or with `npx`:

```bash
gemini mcp add anyfork npx -y @floatfu-true/anyfork-mcp-server@latest
```

### Example MCP Import Flow

Example prompt a model can satisfy through the MCP tools:

```text
Find the AnyFork development session related to MCP integration bugs, then import it into the current project as a Codex-resumable session.
```

Typical structured import parameters:

```json
{
  "query": "AnyFork MCP integration bug and resume verification",
  "to": "codex",
  "cwd": "/absolute/path/to/current/project",
  "onlyCurrentCwd": true,
  "limit": 5,
  "dryRun": false
}
```

## Demo

### 30-Second Promo Video

- [Watch the promo video](./assets/demo/anyfork-promo-30s.mp4)

### Native Resume Screenshots

#### Claude -> Gemini

![Claude to Gemini resume demo](./assets/screenshots/claude-to-gemini-resume.svg)

#### Gemini -> Codex

![Gemini to Codex resume demo](./assets/screenshots/gemini-to-codex-resume.svg)

#### Gemini -> Claude

![Gemini to Claude resume demo](./assets/screenshots/gemini-to-claude-resume.svg)

## Development

```bash
git clone https://github.com/FloatFu-true/Anyfork.git
cd Anyfork
npm install
npm test
```

Run locally:

```bash
node packages/cli/src/index.js --help
node packages/cli/src/index.js fork codex claude last --dry-run
node packages/mcp/src/index.js
```

Pack checks:

```bash
npm run pack:core
npm run pack:cli
npm run pack:mcp
```

## Roadmap

- [x] Cross-CLI session bridge for all six directions
- [x] Native resume seeding for Codex, Claude, and Gemini
- [x] MCP server for search and import workflows
- [x] Bilingual documentation
- [ ] Improve diagnostics for vendor-specific schema changes
- [ ] Add richer import verification utilities for resume parity checks
- [ ] Publish contribution and release workflow documents

## Contributing

Contributions are welcome. Please keep the public surface focused on practical session continuity instead of broad platform sprawl.

1. Fork the project.
2. Create a branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m "feat: add amazing feature"`
4. Push the branch: `git push origin feature/amazing-feature`
5. Open a pull request.

## License

Distributed under the MIT License. See [LICENSE](./LICENSE).
