import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  agentBridgeExportCommand,
  agentBridgeForkCommand,
  agentForkCommand,
  agentSessionsCommand,
  buildCliSpawnInvocation,
  codexForkCommand,
  codexSessionsCommand
} from "../packages/core/src/index.js";
import { runCli } from "../packages/cli/src/index.js";

function normalizeGeminiRegistryPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function createRuntimeRoot(t) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anyfork-"));
  t.after(async () => {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  });
  return runtimeRoot;
}

async function captureStdout(fn) {
  const chunks = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = function patchedWrite(chunk, encoding, callback) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString(encoding));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    const result = await fn();
    return {
      result,
      stdout: chunks.join("")
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function writeCodexRollout({
  codexHome,
  relativePath,
  sessionId,
  cwd,
  userText,
  assistantText,
  archived = false,
  duplicateAssistant = false,
  nativeLike = false,
  nativeMeta = {}
}) {
  const targetPath = path.join(
    codexHome,
    archived ? "archived_sessions" : "sessions",
    relativePath,
    `rollout-${sessionId}.jsonl`
  );

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const lines = nativeLike
    ? [
        JSON.stringify({
          timestamp: "2026-03-11T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            cwd,
            cli_version: nativeMeta.cliVersion ?? "0.112.0-alpha.3",
            originator: nativeMeta.originator ?? "Codex Desktop",
            source: nativeMeta.source ?? "vscode",
            model_provider: nativeMeta.modelProvider ?? "crs"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:00.001Z",
          type: "turn_context",
          payload: {
            turn_id: "turn-1",
            cwd,
            current_date: "2026-03-11",
            timezone: "Asia/Shanghai",
            approval_policy: "never",
            sandbox_policy: { type: "danger-full-access" },
            model: "gpt-5.4",
            personality: "friendly",
            summary: "none",
            effort: "high",
            collaboration_mode: { mode: "default" },
            realtime_active: false
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: userText }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:01.001Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: userText
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: assistantText }]
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:02.001Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: assistantText
          }
        })
      ]
    : [
        JSON.stringify({
          timestamp: "2026-03-11T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            cwd,
            cli_version: "0.112.0-alpha.3"
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: userText
          }
        }),
        JSON.stringify({
          timestamp: "2026-03-11T08:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: assistantText
          }
        })
      ];

  if (duplicateAssistant) {
    lines.push(
      JSON.stringify({
        timestamp: "2026-03-11T08:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: assistantText
        }
      })
    );
  }

  await fs.writeFile(targetPath, lines.join("\n"), "utf8");

  return targetPath;
}

async function writeCodexRolloutWithTranscript({ codexHome, relativePath, sessionId, cwd, messages }) {
  const targetPath = path.join(
    codexHome,
    "sessions",
    relativePath,
    `rollout-${sessionId}.jsonl`
  );

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const lines = [
    JSON.stringify({
      timestamp: "2026-03-11T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd,
        cli_version: "0.112.0-alpha.3",
        originator: "Codex Desktop",
        source: "vscode",
        model_provider: "crs"
      }
    }),
    JSON.stringify({
      timestamp: "2026-03-11T08:00:00.001Z",
      type: "turn_context",
      payload: {
        turn_id: "turn-many",
        cwd,
        current_date: "2026-03-11",
        timezone: "Asia/Shanghai",
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        model: "gpt-5.4",
        personality: "friendly",
        summary: "none",
        effort: "high",
        collaboration_mode: { mode: "default" },
        realtime_active: false
      }
    }),
    ...messages.map((message, index) =>
      JSON.stringify({
        timestamp: new Date(Date.UTC(2026, 2, 11, 8, 0, index + 1)).toISOString(),
        type: "response_item",
        payload: {
          type: "message",
          role: message.role,
          content: [
            {
              type: message.role === "user" ? "input_text" : "output_text",
              text: message.content
            }
          ]
        }
      })
    )
  ];

  await fs.writeFile(targetPath, lines.join("\n"), "utf8");
  return targetPath;
}

async function writeClaudeSession({ claudeHome, projectName, sessionId, cwd, userText, assistantText }) {
  const targetPath = path.join(claudeHome, "projects", projectName, `${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    [
      JSON.stringify({
        type: "file-history-snapshot",
        messageId: "snapshot-1",
        snapshot: {
          messageId: "snapshot-1",
          trackedFileBackups: {},
          timestamp: "2026-03-11T08:00:00.000Z"
        },
        isSnapshotUpdate: false
      }),
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        userType: "external",
        cwd,
        sessionId,
        version: "2.1.50",
        gitBranch: "HEAD",
        type: "user",
        message: { role: "user", content: userText },
        uuid: "user-1",
        timestamp: "2026-03-11T08:00:01.000Z",
        todos: [],
        permissionMode: "default"
      }),
      JSON.stringify({
        parentUuid: "user-1",
        isSidechain: false,
        userType: "external",
        cwd,
        sessionId,
        version: "2.1.50",
        gitBranch: "HEAD",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: assistantText
            }
          ]
        },
        uuid: "assistant-1",
        timestamp: "2026-03-11T08:00:02.000Z"
      })
    ].join("\n"),
    "utf8"
  );

  return targetPath;
}

async function writeGeminiSession({ geminiHome, projectDir, cwd, sessionId, userText, assistantText, updatedAt }) {
  const targetPath = path.join(geminiHome, "tmp", projectDir, "chats", `session-${sessionId}.json`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(path.join(geminiHome, "tmp", projectDir, ".project_root"), cwd, "utf8");
  await fs.writeFile(
    targetPath,
    JSON.stringify(
      {
        sessionId,
        projectHash: projectDir,
        title: "Gemini Session",
        summary: "Gemini Session",
        kind: "main",
        directories: [cwd],
        startTime: "2026-03-11T08:00:00.000Z",
        lastUpdated: updatedAt,
        messages: [
          {
            id: "m1",
            type: "user",
            role: "user",
            content: userText,
            parts: [{ text: userText }],
            timestamp: "2026-03-11T08:00:00.000Z"
          },
          {
            id: "m2",
            type: "gemini",
            role: "model",
            content: assistantText,
            parts: [{ text: assistantText }],
            timestamp: "2026-03-11T08:00:05.000Z"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  return targetPath;
}

async function writeGeminiProjectRegistry(geminiHome, mapping) {
  const registryPath = path.join(geminiHome, "projects.json");
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    JSON.stringify(
      {
        projects: mapping
      },
      null,
      2
    ),
    "utf8"
  );

  return registryPath;
}

async function writeCodexStateDb({ codexHome, rows = [] }) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        git_sha TEXT,
        git_branch TEXT,
        git_origin_url TEXT,
        cli_version TEXT NOT NULL DEFAULT '',
        first_user_message TEXT NOT NULL DEFAULT '',
        agent_nickname TEXT,
        agent_role TEXT,
        memory_mode TEXT NOT NULL DEFAULT 'enabled'
      );
    `);

    const insert = db.prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        source,
        model_provider,
        cwd,
        title,
        sandbox_policy,
        approval_mode,
        tokens_used,
        has_user_event,
        archived,
        archived_at,
        git_sha,
        git_branch,
        git_origin_url,
        cli_version,
        first_user_message,
        agent_nickname,
        agent_role,
        memory_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      insert.run(
        row.id,
        row.rolloutPath,
        row.createdAt,
        row.updatedAt,
        row.source,
        row.modelProvider,
        row.cwd,
        row.title,
        row.sandboxPolicy,
        row.approvalMode,
        row.tokensUsed ?? 0,
        row.hasUserEvent ?? 0,
        row.archived ?? 0,
        row.archivedAt ?? null,
        row.gitSha ?? null,
        row.gitBranch ?? null,
        row.gitOriginUrl ?? null,
        row.cliVersion,
        row.firstUserMessage,
        null,
        null,
        row.memoryMode ?? "enabled"
      );
    }
  } finally {
    db.close();
  }

  return dbPath;
}

async function assertSeededTarget(target, seededSession, expectedUser, expectedAssistant) {
  if (target === "claude") {
    const raw = await fs.readFile(seededSession.sessionPath, "utf8");
    const records = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const transcript = records
      .filter((record) => record.type === "user" || record.type === "assistant")
      .map((record) => ({
        role: record.type,
        text:
          record.type === "assistant"
            ? record.message?.content?.[0]?.text ?? ""
            : typeof record.message?.content === "string"
              ? record.message.content
              : ""
      }));

    assert.deepEqual(transcript, [
      { role: "user", text: expectedUser },
      { role: "assistant", text: expectedAssistant }
    ]);
    assert.doesNotMatch(raw, /bundle\.json/i);
    return;
  }

  if (target === "codex") {
    const raw = await fs.readFile(seededSession.sessionPath, "utf8");
    const indexRaw = await fs.readFile(seededSession.indexPath, "utf8");
    const records = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const responseMessages = records
      .filter((record) => record.type === "response_item" && record.payload?.type === "message")
      .map((record) => ({
        role: record.payload.role,
        text: record.payload.content?.[0]?.text ?? ""
      }));

    assert.ok(records.some((record) => record.type === "session_meta"));
    assert.ok(records.some((record) => record.type === "turn_context"));
    assert.equal(records.some((record) => record.type === "event_msg"), true);
    assert.deepEqual(responseMessages, [
      { role: "user", text: expectedUser },
      { role: "assistant", text: expectedAssistant }
    ]);
    assert.match(indexRaw, new RegExp(seededSession.sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return;
  }

  if (target === "gemini") {
    const payload = JSON.parse(await fs.readFile(seededSession.sessionPath, "utf8"));
    assert.equal(payload.kind, "main");
    assert.ok(Array.isArray(payload.directories));
    assert.ok(payload.directories.length >= 1);
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].content, expectedUser);
    assert.equal(payload.messages[1].content, expectedAssistant);
    assert.equal(payload.messages[0].type, "user");
    assert.equal(payload.messages[0].role, "user");
    assert.deepEqual(payload.messages[0].parts, [{ text: expectedUser }]);
    assert.equal(payload.messages[1].type, "gemini");
    assert.equal(payload.messages[1].role, "model");
    assert.deepEqual(payload.messages[1].parts, [{ text: expectedAssistant }]);
    assert.equal(seededSession.resumeHint, "latest");
  }
}

test("codex sessions command can list and filter local sessions", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const activeSessionId = "11111111-1111-1111-1111-111111111111";
  const archivedSessionId = "22222222-2222-2222-2222-222222222222";

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: activeSessionId,
    cwd: "C:\\Work\\Alpha",
    userText: "alpha prompt",
    assistantText: "alpha reply"
  });
  await writeCodexRollout({
    codexHome,
    relativePath: "",
    sessionId: archivedSessionId,
    cwd: "C:\\Work\\Beta",
    userText: "beta prompt",
    assistantText: "beta reply",
    archived: true
  });

  const listResult = await codexSessionsCommand({
    "codex-home": codexHome,
    limit: "10"
  });

  assert.equal(listResult.ok, true);
  assert.equal(listResult.total, 2);
  assert.ok([activeSessionId, archivedSessionId].includes(listResult.latestSessionId));
  assert.deepEqual(new Set(listResult.items.map((item) => item.id)), new Set([activeSessionId, archivedSessionId]));
  assert.ok(listResult.items.some((item) => item.cwd === "C:\\Work\\Alpha"));
  assert.ok(listResult.items.some((item) => item.archived === true));

  const filteredResult = await codexSessionsCommand({
    "codex-home": codexHome,
    cwd: "C:\\Work\\Beta"
  });

  assert.equal(filteredResult.total, 1);
  assert.equal(filteredResult.items[0].id, archivedSessionId);
});

test("agent sessions command can list claude and gemini local sessions", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const claudeHome = path.join(runtimeRoot, "claude-home");
  const geminiHome = path.join(runtimeRoot, "gemini-home");

  await writeClaudeSession({
    claudeHome,
    projectName: "workspace-a",
    sessionId: "44444444-4444-4444-4444-444444444444",
    cwd: runtimeRoot,
    userText: "claude first prompt",
    assistantText: "claude first reply"
  });
  await writeGeminiSession({
    geminiHome,
    projectDir: "workspace-b",
    cwd: runtimeRoot,
    sessionId: "gemini-session-a",
    userText: "gemini first prompt",
    assistantText: "gemini first reply",
    updatedAt: "2026-03-11T09:00:00.000Z"
  });

  const claudeResult = await agentSessionsCommand({
    platform: "claude",
    "claude-home": claudeHome
  });
  const geminiResult = await agentSessionsCommand({
    platform: "gemini",
    "gemini-home": geminiHome
  });

  assert.equal(claudeResult.ok, true);
  assert.equal(claudeResult.total, 1);
  assert.equal(claudeResult.items[0].firstPrompt, "claude first prompt");

  assert.equal(geminiResult.ok, true);
  assert.equal(geminiResult.total, 1);
  assert.equal(geminiResult.items[0].id, "gemini-session-a");
  assert.equal(geminiResult.items[0].resumeHint, 1);
});

test("native fork commands can build dry-run invocations", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);

  const codexResult = await codexForkCommand({
    id: "33333333-3333-3333-3333-333333333333",
    prompt: "Continue the analysis",
    cwd: runtimeRoot,
    model: "gpt-5-codex",
    search: "true",
    "full-auto": "true",
    image: "one.png,two.png",
    "add-dir": `${runtimeRoot}`,
    "dry-run": "true"
  });
  const claudeResult = await agentForkCommand({
    platform: "claude",
    id: "55555555-5555-5555-5555-555555555555",
    prompt: "Continue from this branch",
    cwd: runtimeRoot,
    model: "sonnet",
    "dry-run": "true"
  });
  const geminiResult = await agentForkCommand({
    platform: "gemini",
    last: "true",
    prompt: "Continue from this checkpoint",
    cwd: runtimeRoot,
    model: "gemini-2.5-pro",
    "approval-mode": "plan",
    "dry-run": "true"
  });

  assert.equal(codexResult.ok, true);
  assert.deepEqual(codexResult.args, [
    "fork",
    "33333333-3333-3333-3333-333333333333",
    "--search",
    "--full-auto",
    "--model",
    "gpt-5-codex",
    "--cd",
    path.resolve(runtimeRoot),
    "--image",
    "one.png",
    "--image",
    "two.png",
    "--add-dir",
    path.resolve(runtimeRoot),
    "Continue the analysis"
  ]);
  assert.deepEqual(claudeResult.args, [
    "--resume",
    "55555555-5555-5555-5555-555555555555",
    "--fork-session",
    "--model",
    "sonnet",
    "Continue from this branch"
  ]);
  assert.deepEqual(geminiResult.args, [
    "--resume",
    "latest",
    "--prompt-interactive",
    "Continue from this checkpoint",
    "--model",
    "gemini-2.5-pro",
    "--approval-mode",
    "plan"
  ]);
});

test("cli help only advertises the public fork surface", async () => {
  const { stdout } = await captureStdout(() => runCli(["node", "anyfork"]));

  assert.match(stdout, /Usage: anyfork \[OPTIONS\]/);
  assert.match(stdout, /anyfork fork <FROM> <TO> <SESSION\|last> \[OPTIONS\]/);
  assert.match(stdout, /\bfork\s+Fork a source session from one CLI into another CLI/);
  assert.doesNotMatch(stdout, /\bplatforms\b/);
});

test("cli rejects hidden commands that are no longer part of the public surface", async () => {
  await assert.rejects(
    () => runCli(["node", "anyfork", "platforms"]),
    /Unknown command: platforms/
  );
});

test("windows cli spawning uses shell mode for npm shim commands", async () => {
  const originalPlatform = process.platform;

  Object.defineProperty(process, "platform", {
    value: "win32"
  });

  try {
    const invocation = buildCliSpawnInvocation("gemini", ["--resume", "latest"], {
      cwd: "C:\\Users\\Tester"
    });

    assert.equal(invocation.command, "gemini");
    assert.deepEqual(invocation.args, ["--resume", "latest"]);
    assert.equal(invocation.options.cwd, "C:\\Users\\Tester");
    assert.equal(invocation.options.stdio, "inherit");
    assert.equal(invocation.options.shell, true);
  } finally {
    Object.defineProperty(process, "platform", {
      value: originalPlatform
    });
  }
});

test("agent bridge export can write a portable bundle and handoff", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const launchCwd = path.join(runtimeRoot, "workspace");
  const sessionId = "66666666-6666-6666-6666-666666666666";
  await fs.mkdir(launchCwd, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId,
    cwd: launchCwd,
    userText: "Please keep building the cross-platform fork flow",
    assistantText: "I will keep going"
  });

  const result = await agentBridgeExportCommand({
    from: "codex",
    id: sessionId,
    cwd: launchCwd,
    "codex-home": codexHome,
    "max-messages": "10"
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, sessionId);
  const bundle = JSON.parse(await fs.readFile(result.bundlePath, "utf8"));
  const handoff = await fs.readFile(result.handoffPath, "utf8");
  assert.equal(bundle.source.platform, "codex");
  assert.equal(bundle.source.sessionId, sessionId);
  assert.ok(bundle.messages.length >= 2);
  assert.match(handoff, /Cross-Agent Handoff/);
  assert.match(handoff, /Transcript/);
});

test("agent bridge export dedupes adjacent identical transcript messages", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const launchCwd = path.join(runtimeRoot, "workspace");
  const sessionId = "dedupe-6666-6666-6666-666666666666";
  await fs.mkdir(launchCwd, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId,
    cwd: launchCwd,
    userText: "Please continue",
    assistantText: "I am continuing",
    duplicateAssistant: true
  });

  const result = await agentBridgeExportCommand({
    from: "codex",
    id: sessionId,
    "codex-home": codexHome,
    "max-messages": "10"
  });

  const bundle = JSON.parse(await fs.readFile(result.bundlePath, "utf8"));
  assert.equal(bundle.messages.length, 2);
  assert.deepEqual(
    bundle.messages.map((message) => message.content),
    ["Please continue", "I am continuing"]
  );
});

test("agent bridge export dedupes codex native response_item and event mirrors", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const launchCwd = path.join(runtimeRoot, "workspace");
  const sessionId = "native-6666-6666-6666-666666666666";
  await fs.mkdir(launchCwd, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId,
    cwd: launchCwd,
    userText: "native user prompt",
    assistantText: "native assistant reply",
    nativeLike: true
  });

  const result = await agentBridgeExportCommand({
    from: "codex",
    id: sessionId,
    "codex-home": codexHome,
    "max-messages": "20"
  });

  const bundle = JSON.parse(await fs.readFile(result.bundlePath, "utf8"));
  assert.equal(bundle.messages.length, 2);
  assert.deepEqual(
    bundle.messages.map((message) => ({ role: message.role, content: message.content })),
    [
      { role: "user", content: "native user prompt" },
      { role: "assistant", content: "native assistant reply" }
    ]
  );
});

test("agent bridge export includes the full deduped transcript by default", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const launchCwd = path.join(runtimeRoot, "workspace");
  const sessionId = "full-export-6666-6666-6666-666666666666";
  await fs.mkdir(launchCwd, { recursive: true });

  const messages = Array.from({ length: 120 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index + 1}`
  }));

  await writeCodexRolloutWithTranscript({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId,
    cwd: launchCwd,
    messages
  });

  const result = await agentBridgeExportCommand({
    from: "codex",
    id: sessionId,
    "codex-home": codexHome
  });

  const bundle = JSON.parse(await fs.readFile(result.bundlePath, "utf8"));
  assert.equal(bundle.stats.messageCount, 120);
  assert.equal(bundle.stats.includedMessages, 120);
  assert.equal(bundle.stats.truncated, false);
  assert.equal(bundle.messages.length, 120);
  assert.equal(bundle.messages[0].content, "message-1");
  assert.equal(bundle.messages[119].content, "message-120");
});

test("agent bridge fork seeds native resume sessions for every cross-platform direction", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const claudeHome = path.join(runtimeRoot, "claude-home");
  const geminiHome = path.join(runtimeRoot, "gemini-home");
  const launchCwd = path.join(runtimeRoot, "workspace");
  await fs.mkdir(launchCwd, { recursive: true });

  const sources = {
    codex: {
      id: "77777777-7777-7777-7777-777777777777",
      userText: "codex source user",
      assistantText: "codex source assistant"
    },
    claude: {
      id: "88888888-8888-8888-8888-888888888888",
      userText: "claude source user",
      assistantText: "claude source assistant"
    },
    gemini: {
      id: "gemini-source-session",
      userText: "gemini source user",
      assistantText: "gemini source assistant"
    }
  };

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: sources.codex.id,
    cwd: launchCwd,
    userText: sources.codex.userText,
    assistantText: sources.codex.assistantText,
    nativeLike: true
  });
  await writeClaudeSession({
    claudeHome,
    projectName: "workspace-source",
    sessionId: sources.claude.id,
    cwd: launchCwd,
    userText: sources.claude.userText,
    assistantText: sources.claude.assistantText
  });
  await writeGeminiSession({
    geminiHome,
    projectDir: "workspace-source",
    cwd: launchCwd,
    sessionId: sources.gemini.id,
    userText: sources.gemini.userText,
    assistantText: sources.gemini.assistantText,
    updatedAt: "2026-03-11T09:00:00.000Z"
  });

  const directions = [
    { from: "codex", to: "claude" },
    { from: "codex", to: "gemini" },
    { from: "claude", to: "codex" },
    { from: "claude", to: "gemini" },
    { from: "gemini", to: "codex" },
    { from: "gemini", to: "claude" }
  ];

  for (const direction of directions) {
    const source = sources[direction.from];
    const result = await agentBridgeForkCommand({
      from: direction.from,
      to: direction.to,
      id: source.id,
      cwd: launchCwd,
      "codex-home": codexHome,
      "claude-home": claudeHome,
      "gemini-home": geminiHome,
      "dry-run": "true"
    });

    assert.equal(result.ok, true, `${direction.from} -> ${direction.to}`);
    assert.ok(result.seededSession, `${direction.from} -> ${direction.to} should return seeded session metadata`);
    assert.ok(result.bundlePath.endsWith("bundle.json"));
    assert.ok(result.handoffPath.endsWith("handoff.md"));

    if (direction.to === "claude") {
      assert.deepEqual(result.args.slice(0, 2), ["--resume", result.seededSession.sessionId]);
    } else if (direction.to === "codex") {
      assert.deepEqual(result.args.slice(0, 2), ["resume", result.seededSession.sessionId]);
    } else if (direction.to === "gemini") {
      assert.deepEqual(result.args.slice(0, 2), ["--resume", "latest"]);
    }

    await assertSeededTarget(direction.to, result.seededSession, source.userText, source.assistantText);
  }
});

test("codex bridge uses native metadata and updates sqlite thread index", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const claudeHome = path.join(runtimeRoot, "claude-home");
  const launchCwd = path.join(runtimeRoot, "AnyFork");
  const nativeSessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const sourceSessionId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await fs.mkdir(launchCwd, { recursive: true });

  const nativeRolloutPath = await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "12"),
    sessionId: nativeSessionId,
    cwd: launchCwd,
    userText: "native codex prompt",
    assistantText: "native codex reply",
    nativeLike: true,
    nativeMeta: {
      cliVersion: "0.112.0",
      originator: "codex_cli_rs",
      source: "cli",
      modelProvider: "crs"
    }
  });

  await writeCodexStateDb({
    codexHome,
    rows: [
      {
        id: nativeSessionId,
        rolloutPath: nativeRolloutPath,
        createdAt: 1773290000,
        updatedAt: 1773290001,
        source: "cli",
        modelProvider: "crs",
        cwd: process.platform === "win32" ? `\\\\?\\${path.resolve(launchCwd)}` : path.resolve(launchCwd),
        title: "native codex prompt",
        sandboxPolicy: JSON.stringify({ type: "workspace-write" }),
        approvalMode: "on-request",
        cliVersion: "0.112.0",
        firstUserMessage: "native codex prompt",
        memoryMode: "enabled"
      }
    ]
  });

  await writeClaudeSession({
    claudeHome,
    projectName: "workspace-source",
    sessionId: sourceSessionId,
    cwd: launchCwd,
    userText: "hello from claude",
    assistantText: "hello from claude assistant"
  });

  const result = await agentBridgeForkCommand({
    from: "claude",
    to: "codex",
    id: sourceSessionId,
    cwd: launchCwd,
    "codex-home": codexHome,
    "claude-home": claudeHome,
    "dry-run": "true"
  });

  const records = (await fs.readFile(result.seededSession.sessionPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const sessionMeta = records.find((record) => record.type === "session_meta")?.payload;

  assert.equal(sessionMeta.originator, "codex_cli_rs");
  assert.equal(sessionMeta.source, "cli");
  assert.equal(sessionMeta.model_provider, "crs");
  assert.equal(sessionMeta.cli_version, "0.112.0");
  assert.equal(sessionMeta.anyfork_imported, true);

  const db = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  try {
    const thread = db
      .prepare("SELECT source, model_provider, cwd, cli_version, first_user_message FROM threads WHERE id = ?")
      .get(result.seededSession.sessionId);
    assert.equal(thread.source, "cli");
    assert.equal(thread.model_provider, "crs");
    assert.equal(thread.cli_version, "0.112.0");
    assert.equal(thread.first_user_message, "hello from claude");
    assert.equal(thread.cwd, process.platform === "win32" ? `\\\\?\\${path.resolve(launchCwd)}` : path.resolve(launchCwd));
  } finally {
    db.close();
  }
});

test("gemini seeding respects registered project slug when stale duplicate markers exist", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const geminiHome = path.join(runtimeRoot, "gemini-home");
  const launchCwd = path.join(runtimeRoot, "AnyFork");
  const sourceSessionId = "99999999-9999-9999-9999-999999999999";
  await fs.mkdir(launchCwd, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: sourceSessionId,
    cwd: launchCwd,
    userText: "registered gemini user",
    assistantText: "registered gemini assistant",
    nativeLike: true
  });

  await writeGeminiProjectRegistry(geminiHome, {
    [normalizeGeminiRegistryPath(launchCwd)]: "anyfork-1"
  });

  await fs.mkdir(path.join(geminiHome, "tmp", "anyfork"), { recursive: true });
  await fs.writeFile(path.join(geminiHome, "tmp", "anyfork", ".project_root"), path.resolve(launchCwd), "utf8");
  await fs.mkdir(path.join(geminiHome, "tmp", "anyfork-1"), { recursive: true });
  await fs.writeFile(path.join(geminiHome, "tmp", "anyfork-1", ".project_root"), normalizeGeminiRegistryPath(launchCwd), "utf8");

  const result = await agentBridgeForkCommand({
    from: "codex",
    to: "gemini",
    id: sourceSessionId,
    cwd: launchCwd,
    "codex-home": codexHome,
    "gemini-home": geminiHome,
    "dry-run": "true"
  });

  assert.equal(result.ok, true);
  assert.equal(result.seededSession.projectDirName, "anyfork-1");
  assert.match(result.seededSession.sessionPath, /anyfork-1/);
  assert.equal(await fs.stat(path.join(geminiHome, "tmp", "anyfork-1", "chats")).then(() => true).catch(() => false), true);
  assert.equal(await fs.stat(path.join(geminiHome, "tmp", "anyfork", "chats")).then(() => true).catch(() => false), false);
});

test("agent bridge fork defaults target project cwd to invocation cwd instead of source session cwd", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const claudeHome = path.join(runtimeRoot, "claude-home");
  const sourceWorkspace = path.join(runtimeRoot, "source-workspace");
  const invocationWorkspace = path.join(runtimeRoot, "invocation-workspace");
  const sourceSessionId = "target-cwd-9999-9999-9999-999999999999";
  await fs.mkdir(sourceWorkspace, { recursive: true });
  await fs.mkdir(invocationWorkspace, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: sourceSessionId,
    cwd: sourceWorkspace,
    userText: "source cwd user",
    assistantText: "source cwd assistant",
    nativeLike: true
  });

  const result = await agentBridgeForkCommand(
    {
      from: "codex",
      to: "claude",
      id: sourceSessionId,
      "codex-home": codexHome,
      "claude-home": claudeHome,
      "dry-run": "true"
    },
    {
      cwd: invocationWorkspace
    }
  );

  assert.equal(result.ok, true);
  const raw = await fs.readFile(result.seededSession.sessionPath, "utf8");
  const records = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const transcript = records.filter((record) => record.type === "user" || record.type === "assistant");

  assert.equal(result.targetCwd, path.resolve(invocationWorkspace));
  assert.equal(transcript[0].cwd, path.resolve(invocationWorkspace));
  assert.doesNotMatch(result.seededSession.sessionPath, new RegExp(sourceWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("agent bridge export defaults artifact output directory to invocation cwd instead of source session cwd", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const sourceWorkspace = path.join(runtimeRoot, "source-workspace");
  const invocationWorkspace = path.join(runtimeRoot, "invocation-workspace");
  const sourceSessionId = "artifact-cwd-9999-9999-9999-999999999999";
  await fs.mkdir(sourceWorkspace, { recursive: true });
  await fs.mkdir(invocationWorkspace, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: sourceSessionId,
    cwd: sourceWorkspace,
    userText: "artifact cwd user",
    assistantText: "artifact cwd assistant",
    nativeLike: true
  });

  const result = await agentBridgeExportCommand(
    {
      from: "codex",
      id: sourceSessionId,
      "codex-home": codexHome,
      cwd: invocationWorkspace
    }
  );

  assert.equal(result.ok, true);
  assert.match(result.outputDir, new RegExp(invocationWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(result.outputDir, new RegExp(sourceWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});
