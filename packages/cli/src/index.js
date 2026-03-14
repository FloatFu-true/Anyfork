#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { agentBridgeForkCommand } from "@floatfu-true/anyfork-core";

const CLI_VERSION = "0.1.8";

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

const MCP_SUPPORTED_PLATFORMS = ["codex", "claude", "gemini"];
const DEFAULT_MCP_SERVER_NAME = "anyfork";
const DEFAULT_MCP_SERVER_COMMAND = "anyfork-mcp-server";
const DEFAULT_MCP_NPX_PACKAGE = "@floatfu-true/anyfork-mcp-server@latest";

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
       anyfork mcp install [OPTIONS]

Commands:
  fork           Fork a source session from one CLI into another CLI
  mcp            Install or inspect AnyFork MCP integration helpers
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
  anyfork mcp install
  anyfork mcp install --platforms codex,claude
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

  if (target === "mcp") {
    return `Usage: anyfork mcp install [OPTIONS]

Install the AnyFork MCP server into Codex, Claude, and/or Gemini without overwriting existing MCP configuration.

Options:
      --platforms <LIST>      Comma-separated platforms: codex,claude,gemini (default: all)
      --name <NAME>           MCP server name to register (default: anyfork)
      --command <COMMAND>     Custom MCP server launch command (default: anyfork-mcp-server)
      --npx                  Register via npx using the matching published version
  -h, --help                 Print help

Examples:
  anyfork mcp install
  anyfork mcp install --platforms codex,claude
  anyfork mcp install --npx
  anyfork mcp install --command "node C:/tools/anyfork-mcp-server.js"
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

function parseBooleanOption(value) {
  return value === true || value === "true";
}

function parseCsvOption(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeMcpPlatforms(value) {
  const requested = parseCsvOption(value);
  if (requested.length === 0) {
    return [...MCP_SUPPORTED_PLATFORMS];
  }

  const invalid = requested.filter((item) => !MCP_SUPPORTED_PLATFORMS.includes(item));
  if (invalid.length > 0) {
    throw new Error(`Unsupported MCP platform(s): ${invalid.join(", ")}`);
  }

  return [...new Set(requested)];
}

function createSpawnInvocation(command, args, options = {}) {
  return {
    command,
    args,
    options: {
      cwd: options.cwd ? options.cwd : process.cwd(),
      stdio: options.stdio ?? "pipe",
      shell: process.platform === "win32"
    }
  };
}

async function runSpawnedCommand(command, args, options = {}, runtime = {}) {
  const invocation = createSpawnInvocation(command, args, options);
  const spawnImpl = runtime.spawn ?? spawn;

  return new Promise((resolve) => {
    const child = spawnImpl(invocation.command, invocation.args, invocation.options);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || String(error?.message ?? error)
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr
      });
    });
  });
}

function buildMcpCommandParts(options = {}) {
  if (parseBooleanOption(options.npx)) {
    return ["npx", "-y", DEFAULT_MCP_NPX_PACKAGE];
  }

  const customCommand = String(options.command ?? "").trim();
  if (customCommand) {
    const parts = [];
    const matcher = /"([^"]*)"|[^\s]+/g;
    let match = matcher.exec(customCommand);
    while (match) {
      parts.push(match[1] ?? match[0]);
      match = matcher.exec(customCommand);
    }
    return parts.filter(Boolean);
  }

  return [DEFAULT_MCP_SERVER_COMMAND];
}

async function isMcpServerInstalled(platform, serverName, runtime = {}) {
  if (platform === "codex") {
    const result = await runSpawnedCommand("codex", ["mcp", "get", serverName], {}, runtime);
    return result.ok;
  }

  if (platform === "claude") {
    const result = await runSpawnedCommand("claude", ["mcp", "get", serverName], {}, runtime);
    return result.ok;
  }

  if (platform === "gemini") {
    const result = await runSpawnedCommand("gemini", ["mcp", "list"], {}, runtime);
    if (!result.ok) {
      return false;
    }

    const matcher = new RegExp(`(^|\\s)${serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|:|$)`, "im");
    return matcher.test(result.stdout);
  }

  throw new Error(`Unsupported MCP platform: ${platform}`);
}

function buildMcpInstallInvocation(platform, serverName, commandParts) {
  if (commandParts.length === 0) {
    throw new Error("Missing MCP server command.");
  }

  if (platform === "codex") {
    return {
      command: "codex",
      args: ["mcp", "add", serverName, "--", ...commandParts]
    };
  }

  if (platform === "claude") {
    return {
      command: "claude",
      args: ["mcp", "add", serverName, "--", ...commandParts]
    };
  }

  if (platform === "gemini") {
    return {
      command: "gemini",
      args: ["mcp", "add", serverName, ...commandParts]
    };
  }

  throw new Error(`Unsupported MCP platform: ${platform}`);
}

async function installMcpServers(options = {}, runtime = {}) {
  const platforms = normalizeMcpPlatforms(options.platforms);
  const serverName = String(options.name ?? DEFAULT_MCP_SERVER_NAME).trim() || DEFAULT_MCP_SERVER_NAME;
  const commandParts = buildMcpCommandParts(options);
  const results = [];

  for (const platform of platforms) {
    const installed = await isMcpServerInstalled(platform, serverName, runtime);
    if (installed) {
      results.push({
        platform,
        status: "skipped",
        reason: "already_installed"
      });
      continue;
    }

    const invocation = buildMcpInstallInvocation(platform, serverName, commandParts);
    const installResult = await runSpawnedCommand(invocation.command, invocation.args, {}, runtime);

    if (!installResult.ok) {
      results.push({
        platform,
        status: "failed",
        command: invocation.command,
        args: invocation.args,
        stderr: installResult.stderr.trim(),
        stdout: installResult.stdout.trim()
      });
      continue;
    }

    results.push({
      platform,
      status: "installed",
      command: invocation.command,
      args: invocation.args
    });
  }

  return {
    ok: results.every((item) => item.status !== "failed"),
    serverName,
    serverCommand: commandParts,
    results
  };
}

export async function runCli(argv = process.argv, runtime = {}) {
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

  if (command === "mcp") {
    const [subcommand] = args;

    if (subcommand === "install") {
      return installMcpServers(options, runtime);
    }

    printText(buildCommandHelpText("mcp"));
    return { ok: true, silent: true };
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
