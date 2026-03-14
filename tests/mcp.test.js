import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  findAndImportSession,
  findRelevantSessions,
  importSession,
  listSessions
} from "../packages/mcp/src/service.js";

async function createRuntimeRoot(t) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anyfork-mcp-"));
  t.after(async () => {
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  });
  return runtimeRoot;
}

async function writeCodexRollout({ codexHome, relativePath, sessionId, cwd, userText, assistantText }) {
  const targetPath = path.join(codexHome, "sessions", relativePath, `rollout-${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const lines = [
    JSON.stringify({
      timestamp: "2026-03-11T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd,
        cli_version: "0.112.0",
        originator: "codex_cli_rs",
        source: "cli",
        model_provider: "crs"
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
      timestamp: "2026-03-11T08:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: assistantText }]
      }
    })
  ];
  await fs.writeFile(targetPath, `${lines.join("\n")}\n`, "utf8");
  return targetPath;
}

async function writeClaudeSession({ claudeHome, sessionId, cwd, userText, assistantText }) {
  const targetPath = path.join(claudeHome, "projects", "workspace-a", `${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const lines = [
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
      timestamp: "2026-03-11T08:00:01.000Z"
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
        content: [{ type: "text", text: assistantText }]
      },
      uuid: "assistant-1",
      timestamp: "2026-03-11T08:00:02.000Z"
    })
  ];
  await fs.writeFile(targetPath, `${lines.join("\n")}\n`, "utf8");
  return targetPath;
}

test("mcp service can list and rank relevant sessions", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const claudeHome = path.join(runtimeRoot, "claude-home");
  const workspace = path.join(runtimeRoot, "AnyFork");
  await fs.mkdir(workspace, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: "11111111-1111-1111-1111-111111111111",
    cwd: workspace,
    userText: "fix anyfork dry run invalid string length bug",
    assistantText: "I will patch the export path"
  });
  await writeClaudeSession({
    claudeHome,
    sessionId: "22222222-2222-2222-2222-222222222222",
    cwd: path.join(runtimeRoot, "OtherProject"),
    userText: "build a landing page",
    assistantText: "Here is the UI plan"
  });

  const listed = await listSessions({
    codexHome,
    claudeHome,
    platforms: ["codex", "claude"]
  });
  assert.equal(listed.total, 2);

  const found = await findRelevantSessions({
    query: "AnyFork dry run invalid string length",
    cwd: workspace,
    codexHome,
    claudeHome,
    platforms: ["codex", "claude"]
  });

  assert.ok(found.items.length >= 1);
  assert.equal(found.items[0].id, "11111111-1111-1111-1111-111111111111");
  assert.ok(found.items[0].score > 0);
  assert.ok(found.items[0].reasons.includes("same_project_cwd"));
});

test("mcp service can import by session id without launching target cli", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const claudeHome = path.join(runtimeRoot, "claude-home");
  const workspace = path.join(runtimeRoot, "AnyFork");
  await fs.mkdir(workspace, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: "33333333-3333-3333-3333-333333333333",
    cwd: workspace,
    userText: "continue anyfork mcp integration",
    assistantText: "I will build the MCP server"
  });

  const imported = await importSession({
    from: "codex",
    to: "claude",
    sessionId: "33333333-3333-3333-3333-333333333333",
    cwd: workspace,
    codexHome,
    claudeHome
  });

  assert.equal(imported.ok, true);
  assert.equal(imported.imported, true);
  assert.ok(imported.seededSession);
  const stat = await fs.stat(imported.seededSession.sessionPath);
  assert.equal(stat.isFile(), true);
});

test("mcp service can find and import the best matching session", async (t) => {
  const runtimeRoot = await createRuntimeRoot(t);
  const codexHome = path.join(runtimeRoot, "codex-home");
  const geminiHome = path.join(runtimeRoot, "gemini-home");
  const workspace = path.join(runtimeRoot, "AnyFork");
  await fs.mkdir(workspace, { recursive: true });

  await writeCodexRollout({
    codexHome,
    relativePath: path.join("2026", "03", "11"),
    sessionId: "44444444-4444-4444-4444-444444444444",
    cwd: workspace,
    userText: "implement MCP tool to find and import sessions into current project",
    assistantText: "Let's wrap AnyFork with MCP tools"
  });

  const result = await findAndImportSession({
    query: "find and import sessions into current project",
    to: "gemini",
    cwd: workspace,
    codexHome,
    geminiHome,
    platforms: ["codex"]
  });

  assert.equal(result.selectedSession.id, "44444444-4444-4444-4444-444444444444");
  assert.equal(result.importResult.ok, true);
  assert.equal(result.importResult.imported, true);
  assert.ok(result.importResult.seededSession.sessionPath.includes("chats"));
});
