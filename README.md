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
    <a href="https://github.com/FloatFu-true/Anyfork/blob/main/LICENSE"><img src="https://img.shields.io/github/license/FloatFu-true/Anyfork?style=for-the-badge" alt="MIT License"></a>
    <a href="https://github.com/FloatFu-true/Anyfork/issues"><img src="https://img.shields.io/github/issues/FloatFu-true/Anyfork?style=for-the-badge" alt="Issues"></a>
    <a href="https://www.npmjs.com/package/@floatfu-true/anyfork-cli"><img src="https://img.shields.io/node/v/@floatfu-true/anyfork-cli?style=for-the-badge" alt="Node 22+"></a>
  </p>
</div>

## Table Of Contents

- [About The Project](#about-the-project)
- [Built With](#built-with)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Demo](#demo)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)
- [Acknowledgments](#acknowledgments)

## About The Project

AnyFork is an open-source CLI built for a very specific workflow:

move a real local conversation from one AI coding CLI into another one, preserve the visible transcript, and seed a target-native resumable session whenever the destination format is understood.

This project exists because native fork usually stops at the product boundary. In practice, engineers often build deep context in one tool, then want to continue the exact same thread in another CLI without rewriting context by hand.

AnyFork focuses on practical continuity:

- preserve the visible transcript in order
- generate inspectable bridge artifacts under `.anyfork/`
- seed target-native local session data when supported
- keep the public CLI surface intentionally small

AnyFork does not try to be:

- a cloud sync platform
- a backend memory service
- a byte-for-byte clone of vendor-private hidden caches
- a replacement for the native CLIs themselves

The goal is continuity you can actually use in day-to-day engineering work.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Built With

- [Node.js](https://nodejs.org/)
- npm workspaces
- native local session stores from Codex, Claude Code, and Gemini CLI
- Node SQLite support for Codex thread indexing

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- `Node.js >= 22`
- the source CLI installed locally
- the target CLI installed locally

### Installation

Install the CLI package:

```bash
npm install -g @floatfu-true/anyfork-cli
```

Verify the installation:

```bash
anyfork --help
```

Most users only need `@floatfu-true/anyfork-cli`.

`@floatfu-true/anyfork-core` is the lower-level library used by the CLI and by advanced integrations.

### Local Development

```bash
git clone https://github.com/FloatFu-true/Anyfork.git
cd Anyfork
npm install
npm test
```

Run the CLI locally:

```bash
node packages/cli/src/index.js --help
node packages/cli/src/index.js fork codex claude last --dry-run
```

Create dry-run tarballs before publishing:

```bash
npm run pack:core
npm run pack:cli
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

If no subcommand is specified, AnyFork shows the main help.

```text
Usage: anyfork [OPTIONS]
       anyfork fork <FROM> <TO> <SESSION|last> [OPTIONS]

Commands:
  fork           Fork a source session from one CLI into another CLI
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
```

What happens during a fork:

1. Resolve the source session from local CLI storage.
2. Normalize and deduplicate the visible transcript.
3. Export a portable bridge bundle and a readable handoff note.
4. Seed target-native local session data when the target format is known.
5. Launch the target CLI through its native resume path unless `--dry-run` is used.

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

Current bridge directions:

- `codex -> claude`
- `codex -> gemini`
- `claude -> codex`
- `claude -> gemini`
- `gemini -> codex`
- `gemini -> claude`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Demo

### 30-second promo video

- [Watch the promo video](./assets/demo/anyfork-promo-30s.mp4)

### Real resume screenshots

#### Claude -> Gemini

![Claude to Gemini resume demo](./assets/screenshots/claude-to-gemini-resume.svg)

#### Gemini -> Codex

![Gemini to Codex resume demo](./assets/screenshots/gemini-to-codex-resume.svg)

#### Gemini -> Claude

![Gemini to Claude resume demo](./assets/screenshots/gemini-to-claude-resume.svg)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Cross-CLI session bridge for all six directions
- [x] Native resume seeding for Codex, Claude, and Gemini
- [x] Minimal public CLI surface centered on `fork`
- [x] Bilingual project documentation
- [ ] Improve diagnostics for vendor-specific schema changes
- [ ] Add richer import verification utilities for resume parity checks
- [ ] Publish contribution and release workflow documents

See the [open issues](https://github.com/FloatFu-true/Anyfork/issues) for proposed changes and bug reports.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are what make open source valuable. If you have an idea that improves AnyFork, feel free to open an issue first or send a pull request directly.

1. Fork the Project
2. Create your Feature Branch: `git checkout -b feature/amazing-feature`
3. Commit your Changes: `git commit -m "feat: add amazing feature"`
4. Push to the Branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

Please keep the public CLI surface focused and avoid introducing broad commands unless they clearly improve the fork workflow.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [LICENSE](./LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

- GitHub organization: [FloatFu-true](https://github.com/FloatFu-true)
- Project repository: [https://github.com/FloatFu-true/Anyfork](https://github.com/FloatFu-true/Anyfork)
- Package: [@floatfu-true/anyfork-cli](https://www.npmjs.com/package/@floatfu-true/anyfork-cli)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template) for the README structure inspiration
- [Choose an Open Source License](https://choosealicense.com/)
- [Shields.io](https://shields.io/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
