#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { agentBridgeForkCommand } from "@floatfu-true/anyfork-core";

const CLI_VERSION = "0.1.6";

const COMMAND_ALIASES = {
  "bridge-fork": "fork",
  bf: "fork"
};

const GLOBAL_OPTION_ALIASES = {
  "-C": "cwd",
  "-m": "model",
  "-i": "image",
  "-s": "sandbox",
  "-a": "ask-for-approval"
};

function appendOption(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value;
    return;
  }

  options[key] = `${options[key]},${value}`;
}

function normalizeCommand(command) {
  return COMMAND_ALIASES[command] ?? command;
}

function parseArgs(argv) {
  const [, , ...rest] = argv;
  const options = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index];
    if (part === "-h" || part === "--help") {
      options.help = "true";
      continue;
    }

    if (part === "-V" || part === "--version") {
      options.version = "true";
      continue;
    }

    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = rest[index + 1];
      const value = next && !next.startsWith("-") ? next : "true";
      appendOption(options, key, value);
      if (value !== "true") {
        index += 1;
      }
      continue;
    }

    if (GLOBAL_OPTION_ALIASES[part]) {
      const key = GLOBAL_OPTION_ALIASES[part];
      const next = rest[index + 1];
      const value = next && !next.startsWith("-") ? next : "true";
      appendOption(options, key, value);
      if (value !== "true") {
        index += 1;
      }
      continue;
    }

    positionals.push(part);
  }

  const [command, ...args] = positionals;
  return {
    command: normalizeCommand(command),
    rawCommand: command,
    args,
    options
  };
}

function buildMainHelpText() {
  return `AnyFork CLI

Cross-platform session handoff and fork tooling for Codex, Claude, and Gemini.

Usage: anyfork [OPTIONS]
       anyfork fork <FROM> <TO> <SESSION|last> [OPTIONS]

Commands:
  fork           Fork a source session from one CLI into another CLI
  help           Print this message or the help of the given subcommand(s)

Arguments:
  [COMMAND]
          Optional subcommand. If omitted, this help is shown.

Options:
      --prompt <TEXT>
          Extra instruction appended to the fork handoff

      --max-messages <N>
          Optionally limit exported transcript length for bridge bundles

  -C, --cwd <DIR>
          Working directory used as the target CLI project root and launch root (defaults to current shell directory)

      --output-dir <DIR>
          Explicit output directory for bundle.json and handoff.md

      --codex-home <DIR>
          Override the Codex home directory

      --claude-home <DIR>
          Override the Claude home directory

      --gemini-home <DIR>
          Override the Gemini home directory

  -m, --model <MODEL>
          Model override forwarded to the target CLI when supported

      --search
          Enable web search for Codex runs when supported

      --full-auto
          Enable low-friction Codex automation flags when supported

  -s, --sandbox <MODE>
          Sandbox mode forwarded to Codex when supported

  -a, --ask-for-approval <POLICY>
          Approval policy forwarded to Codex when supported

      --add-dir <DIR>
          Additional writable directory forwarded to Codex or Claude

  -i, --image <FILE>
          Image attachment forwarded to Codex native fork

      --dry-run
          Print the command payload without launching the target CLI

  -h, --help
          Print help

  -V, --version
          Print version

Examples:
  anyfork fork codex claude last
  anyfork fork codex claude 11111111-1111-1111-1111-111111111111
  anyfork fork claude gemini 22222222-2222-2222-2222-222222222222 --prompt "Continue implementation"
`;
}

function buildCommandHelpText(command) {
  const target = normalizeCommand(command);

  if (target === "agent-sessions") {
    return buildMainHelpText();
  }

  if (target === "fork") {
    return `Usage: anyfork fork <FROM> <TO> <SESSION|last> [OPTIONS]

Export a portable bridge bundle and launch a new session in another CLI.

Options:
      <FROM>                  codex | claude | gemini
      <TO>                    codex | claude | gemini
      <SESSION|last>          Source session id, Gemini index, or the literal "last"
      --prompt <TEXT>         Extra handoff instruction for the target CLI
      --max-messages <N>      Optional maximum number of messages included in the bundle
      --output-dir <DIR>      Explicit export directory
  -C, --cwd <DIR>            Target project directory for resume storage and launch; defaults to current shell directory
  -m, --model <MODEL>        Model override forwarded to the target CLI
      --codex-home <DIR>      Override Codex home
      --claude-home <DIR>     Override Claude home
      --gemini-home <DIR>     Override Gemini home
      --dry-run              Print resolved command without execution
  -h, --help                 Print help
`;
  }

  return buildMainHelpText();
}

function printText(text) {
  process.stdout.write(`${text.trimEnd()}\n`);
}

function printVersion() {
  printText(CLI_VERSION);
}

export async function runCli(argv = process.argv) {
  const { command, rawCommand, args, options } = parseArgs(argv);

  if (options.version) {
    printVersion();
    return { ok: true, silent: true };
  }

  if (!command) {
    printText(buildMainHelpText());
    return { ok: true, silent: true };
  }

  if (rawCommand === "help") {
    printText(buildCommandHelpText(args[0]));
    return { ok: true, silent: true };
  }

  if (options.help) {
    printText(buildCommandHelpText(command));
    return { ok: true, silent: true };
  }

  if (command === "fork") {
    const [from, to, session] = args;

    if (!from || !to || !session) {
      printText(buildCommandHelpText("fork"));
      return { ok: true, silent: true };
    }

    const forkOptions = {
      ...options,
      from,
      to
    };

    if (session === "last") {
      forkOptions.last = "true";
    } else {
      forkOptions.id = session;
    }

    return agentBridgeForkCommand(forkOptions);
  }

  throw new Error(`Unknown command: ${command}`);
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFilePath) {
  try {
    const result = await runCli(process.argv);
    if (result && !result.silent) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    if (error?.message) {
      console.error(`Error: ${error.message}`);
      console.error("");
      console.error("Run `anyfork --help` to see available commands.");
    } else {
      console.error("Unknown error");
    }
    process.exitCode = 1;
  }
}
