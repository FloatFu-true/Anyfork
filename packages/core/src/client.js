import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { extractContent, extractRole } from "./conversation.js";
import { ensureDir, listFilesRecursive, readJsonFile, readTextFile, statSafe, writeJsonFile, writeTextFile } from "./files.js";
import { collectPlatformConversations, PLATFORM_DEFINITIONS } from "./platforms.js";

function parseCliBool(value) {
  return value === true || value === "true";
}

function parseOptionalList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredOption(value, name) {
  if (!value) {
    throw new Error(`Missing required option: --${name}`);
  }

  return value;
}

function parseJsonLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseLimit(value, fallback = 20) {
  const numeric = Number.parseInt(value ?? "", 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeComparablePath(targetPath) {
  return path.resolve(targetPath).replaceAll("\\", "/").toLowerCase();
}

function sameResolvedPath(leftPath, rightPath) {
  return normalizeComparablePath(leftPath) === normalizeComparablePath(rightPath);
}

function extractSessionIdFromPath(filePath) {
  const match = path.basename(filePath).match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );

  return match ? match[1].toLowerCase() : "";
}

function formatPathForPrompt(filePath) {
  return filePath.replaceAll("\\", "/");
}

function formatTimestampForPath(value = new Date()) {
  return value.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function createUuid() {
  return crypto.randomUUID();
}

function createSessionId() {
  return createUuid().toLowerCase();
}

function formatIsoCompact(value = new Date()) {
  return value.toISOString().slice(0, 19).replaceAll(":", "-");
}

function formatIsoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function toUnixSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function sanitizeProjectName(value, fallback = "workspace") {
  const sanitized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function normalizeGeminiProjectPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function slugifyGeminiProjectName(value) {
  return (
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

function isAnyForkOriginator(value) {
  return String(value ?? "").trim().toLowerCase().startsWith("anyfork");
}

function isNativeCodexSource(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "cli" || normalized === "vscode";
}

function formatCodexThreadCwd(cwd) {
  const resolved = path.resolve(cwd);
  if (process.platform !== "win32") {
    return resolved;
  }

  return resolved.startsWith("\\\\?\\") ? resolved : `\\\\?\\${resolved}`;
}

function normalizeImportedMessage(message) {
  const content = extractContent(message);
  if (!content) {
    return null;
  }

  const role = extractRole(message);
  if (role === "user" || role === "assistant") {
    return {
      role,
      content,
      createdAt: message.createdAt ?? new Date().toISOString()
    };
  }

  const label = role === "system" ? "SYSTEM" : role === "tool" ? "TOOL" : role.toUpperCase();
  return {
    role: "assistant",
    content: `[${label}]\n${content}`,
    createdAt: message.createdAt ?? new Date().toISOString()
  };
}

function getImportedMessages(bundle) {
  return dedupeTranscriptMessages(
    (Array.isArray(bundle?.messages) ? bundle.messages : []).map(normalizeImportedMessage).filter(Boolean)
  );
}

function buildImportedThreadName(bundle) {
  return (
    bundle?.userGoal ??
    bundle?.latestUserMessage ??
    bundle?.source?.title ??
    `Imported ${bundle?.source?.platform ?? "session"} session`
  )
    .slice(0, 120)
    .trim();
}

function dedupeTranscriptMessages(messages) {
  const deduped = [];

  for (const message of messages) {
    const previous = deduped.at(-1);
    if (
      previous &&
      previous.role === message.role &&
      previous.content === message.content
    ) {
      continue;
    }

    deduped.push(message);
  }

  return deduped;
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

export function getDocsPath(cwd = process.cwd()) {
  return path.resolve(cwd, "README.md");
}

export function getCodexHome(options = {}, env = process.env) {
  const configuredHome = options["codex-home"] ?? options.codexHome ?? env.CODEX_HOME;
  return path.resolve(configuredHome ?? path.join(os.homedir(), ".codex"));
}

export function getClaudeHome(options = {}, env = process.env) {
  const configuredHome = options["claude-home"] ?? options.claudeHome ?? env.CLAUDE_HOME;
  return path.resolve(configuredHome ?? path.join(os.homedir(), ".claude"));
}

export function getGeminiHome(options = {}, env = process.env) {
  const configuredHome = options["gemini-home"] ?? options.geminiHome ?? env.GEMINI_HOME;
  return path.resolve(configuredHome ?? path.join(os.homedir(), ".gemini"));
}

function encodeClaudeProjectPath(cwd) {
  return String(cwd || process.cwd()).replace(/[^A-Za-z0-9]/g, "-");
}

async function detectClaudeSessionVersion(claudeHome) {
  const projectsRoot = path.join(claudeHome, "projects");
  const stat = await statSafe(projectsRoot);
  if (!stat?.isDirectory()) {
    return "2.1.50";
  }

  const candidates = (await listFilesRecursive(projectsRoot))
    .filter((filePath) => filePath.toLowerCase().endsWith(".jsonl") && !filePath.toLowerCase().includes("\\subagents\\"))
    .sort();

  for (const filePath of candidates.reverse()) {
    const raw = await readTextFile(filePath);
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const item = JSON.parse(line);
        if (typeof item.version === "string" && item.version.trim()) {
          return item.version.trim();
        }
      } catch {
        continue;
      }
    }
  }

  return "2.1.50";
}

async function detectCodexCliVersion(codexHome) {
  const template = await detectCodexSessionTemplate(codexHome);
  if (template?.cliVersion) {
    return template.cliVersion;
  }

  const versionPayload = await readJsonFile(path.join(codexHome, "version.json"), null);
  if (versionPayload && typeof versionPayload.version === "string" && versionPayload.version.trim()) {
    return versionPayload.version.trim();
  }

  return "0.112.0";
}

async function detectCodexSessionTemplate(codexHome) {
  const sessionsRoot = path.join(codexHome, "sessions");
  const stat = await statSafe(sessionsRoot);
  if (!stat?.isDirectory()) {
    return null;
  }

  const candidates = (await listFilesRecursive(sessionsRoot)).filter((filePath) => filePath.toLowerCase().endsWith(".jsonl")).sort();

  for (const filePath of candidates.reverse()) {
    const raw = await readTextFile(filePath);
    const records = parseJsonLines(raw);
    const sessionMeta = records.find((item) => item?.type === "session_meta" && item?.payload);
    const payload = sessionMeta?.payload ?? {};
    if (payload.anyfork_imported === true || isAnyForkOriginator(payload.originator)) {
      continue;
    }

    if (!isNativeCodexSource(payload.source)) {
      continue;
    }

    const cliVersion = String(payload.cli_version ?? "").trim();
    if (cliVersion) {
      const turnContext = records.find((item) => item?.type === "turn_context" && item?.payload)?.payload ?? null;
      return {
        cliVersion,
        originator: String(payload.originator ?? "").trim() || "codex_cli_rs",
        source: String(payload.source ?? "").trim() || "cli",
        modelProvider: String(payload.model_provider ?? "").trim() || "crs",
        baseInstructions: payload.base_instructions ?? null,
        turnContext
      };
    }
  }

  return null;
}

function detectCodexThreadTemplate(codexHome, cwd) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const threadCwd = formatCodexThreadCwd(cwd);

  try {
    const db = new DatabaseSync(dbPath);
    try {
      const selectTemplate = (cwdValue) => {
        const params = cwdValue ? [cwdValue] : [];
        const predicate = cwdValue
          ? "archived = 0 AND cwd = ? AND source IN ('cli', 'vscode')"
          : "archived = 0 AND source IN ('cli', 'vscode')";
        return db
          .prepare(
            `SELECT source, model_provider, sandbox_policy, approval_mode, cli_version, memory_mode, git_sha, git_branch, git_origin_url
             FROM threads
             WHERE ${predicate}
             ORDER BY updated_at DESC
             LIMIT 1`
          )
          .get(...params);
      };

      return selectTemplate(threadCwd) ?? selectTemplate(null) ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function upsertCodexThreadIndex({
  codexHome,
  sessionId,
  sessionPath,
  cwd,
  title,
  importedAt,
  metaSource,
  metaModelProvider,
  cliVersion,
  sandboxPolicy,
  approvalMode,
  firstUserMessage,
  memoryMode,
  gitSha,
  gitBranch,
  gitOriginUrl
}) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const stat = await statSafe(dbPath);
  if (!stat?.isFile()) {
    return null;
  }

  const epochSeconds = toUnixSeconds(importedAt);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 2000");
      try {
        db.prepare(
          `INSERT INTO threads (
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?)
          ON CONFLICT(id) DO UPDATE SET
            rollout_path = excluded.rollout_path,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            source = excluded.source,
            model_provider = excluded.model_provider,
            cwd = excluded.cwd,
            title = excluded.title,
            sandbox_policy = excluded.sandbox_policy,
            approval_mode = excluded.approval_mode,
            git_sha = excluded.git_sha,
            git_branch = excluded.git_branch,
            git_origin_url = excluded.git_origin_url,
            cli_version = excluded.cli_version,
            first_user_message = excluded.first_user_message,
            memory_mode = excluded.memory_mode`
        ).run(
          sessionId,
          path.resolve(sessionPath),
          epochSeconds,
          epochSeconds,
          metaSource,
          metaModelProvider,
          formatCodexThreadCwd(cwd),
          title,
          JSON.stringify(sandboxPolicy),
          approvalMode,
          gitSha ?? null,
          gitBranch ?? null,
          gitOriginUrl ?? null,
          cliVersion,
          firstUserMessage,
          memoryMode
        );
        return dbPath;
      } catch (error) {
        const message = String(error?.message ?? "");
        if (message.includes("no such table: threads")) {
          return null;
        }

        if (message.includes("database is locked") && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }

        throw error;
      }
    } finally {
      db.close();
    }
  }

  return null;
}

function buildCodexResponseItem(message) {
  const isUser = message.role === "user";
  return {
    type: "response_item",
    payload: {
      type: "message",
      role: isUser ? "user" : "assistant",
      content: [
        {
          type: isUser ? "input_text" : "output_text",
          text: message.content
        }
      ]
    }
  };
}

function buildCodexEventMirror(message) {
  const isUser = message.role === "user";
  return {
    type: "event_msg",
    payload: isUser
      ? {
          type: "user_message",
          message: message.content,
          images: [],
          local_images: [],
          text_elements: []
        }
      : {
          type: "agent_message",
          message: message.content,
          phase: "final_answer"
        }
  };
}

function buildCodexTurnContext({ cwd, importedAt, template }) {
  const base = cloneJsonValue(template) ?? {};
  const timeZone = String(base.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC").trim() || "UTC";

  return {
    turn_id: createUuid(),
    cwd,
    current_date: formatIsoDate(new Date(importedAt)),
    timezone: timeZone,
    approval_policy: base.approval_policy ?? "never",
    sandbox_policy: cloneJsonValue(base.sandbox_policy) ?? {
      type: "danger-full-access"
    },
    model: base.model ?? "gpt-5-codex",
    personality: base.personality ?? "friendly",
    summary: base.summary ?? "none",
    effort: base.effort ?? "high",
    collaboration_mode: cloneJsonValue(base.collaboration_mode) ?? {
      mode: "default"
    },
    realtime_active: base.realtime_active ?? false,
    developer_instructions:
      base.developer_instructions ?? `Imported cross-platform session from ${cwd}.`,
    user_instructions:
      base.user_instructions ??
      "Imported conversation history. Continue from the restored context without repeating prior messages."
  };
}

async function seedClaudeResumeSession({ bundle, cwd, options }) {
  const claudeHome = getClaudeHome(options);
  const sessionId = createSessionId();
  const messageId = createSessionId();
  const timestamp = new Date().toISOString();
  const version = await detectClaudeSessionVersion(claudeHome);
  const projectDir = path.join(claudeHome, "projects", encodeClaudeProjectPath(cwd));
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
  const importedMessages = getImportedMessages(bundle);
  const records = [
    {
      type: "file-history-snapshot",
      messageId,
      snapshot: {
        messageId,
        trackedFileBackups: {},
        timestamp
      },
      isSnapshotUpdate: false
    }
  ];

  let parentUuid = null;
  for (const message of importedMessages) {
    const uuid = createSessionId();
    const record = {
      parentUuid,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId,
      version,
      gitBranch: "HEAD",
      type: message.role,
      message:
        message.role === "assistant"
          ? {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: message.content
                }
              ]
            }
          : {
              role: "user",
              content: message.content
            },
      uuid,
      timestamp: message.createdAt
    };

    if (message.role === "user") {
      record.todos = [];
      record.permissionMode = options["permission-mode"] ?? options.permissionMode ?? "default";
    }

    records.push(record);
    parentUuid = uuid;
  }

  await ensureDir(projectDir);
  await writeTextFile(sessionPath, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`);

  return {
    sessionId,
    sessionPath,
    claudeHome,
    importedMessages: importedMessages.length
  };
}

async function updateCodexSessionIndex({ codexHome, sessionId, threadName, updatedAt }) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const existing = parseJsonLines(await readTextFile(indexPath).catch(() => ""));
  const filtered = existing.filter((item) => item?.id !== sessionId);
  filtered.push({
    id: sessionId,
    thread_name: threadName,
    updated_at: updatedAt
  });

  await writeTextFile(indexPath, `${filtered.map((item) => JSON.stringify(item)).join("\n")}\n`);

  return indexPath;
}

async function seedCodexResumeSession({ bundle, cwd, options }) {
  const codexHome = getCodexHome(options);
  const sessionId = createSessionId();
  const importedAt = new Date().toISOString();
  const template = await detectCodexSessionTemplate(codexHome);
  const threadTemplate = detectCodexThreadTemplate(codexHome, cwd);
  const cliVersion = template?.cliVersion ?? threadTemplate?.cli_version ?? await detectCodexCliVersion(codexHome);
  const metaOriginator = template?.originator ?? "codex_cli_rs";
  const metaSource = template?.source ?? threadTemplate?.source ?? "cli";
  const metaModelProvider = template?.modelProvider ?? threadTemplate?.model_provider ?? "crs";
  const metaBaseInstructions = template?.baseInstructions ?? {
    text: `Imported cross-platform session from ${bundle.source.platform}.`
  };
  const dateDir = path.join(
    new Date(importedAt).getUTCFullYear().toString().padStart(4, "0"),
    String(new Date(importedAt).getUTCMonth() + 1).padStart(2, "0"),
    String(new Date(importedAt).getUTCDate()).padStart(2, "0")
  );
  const sessionPath = path.join(codexHome, "sessions", dateDir, `rollout-${formatIsoCompact(new Date(importedAt))}-${sessionId}.jsonl`);
  const importedMessages = getImportedMessages(bundle);
  const threadName = buildImportedThreadName(bundle);
  const firstUserMessage = importedMessages.find((message) => message.role === "user")?.content ?? threadName;
  const importedBaseTime = new Date(importedAt).valueOf();
  const turnContext = buildCodexTurnContext({
    cwd,
    importedAt,
    template: template?.turnContext
  });
  const records = [
    {
      timestamp: importedAt,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: importedAt,
        cwd,
        originator: metaOriginator,
        anyfork_imported: true,
        cli_version: cliVersion,
        source: metaSource,
        model_provider: metaModelProvider,
        base_instructions: metaBaseInstructions
      }
    },
    {
      timestamp: new Date(importedBaseTime + 1).toISOString(),
      type: "turn_context",
      payload: turnContext
    },
    ...importedMessages.flatMap((message, index) => {
      const baseTime = importedBaseTime + (index + 1) * 1000;
      return [
        {
          timestamp: new Date(baseTime).toISOString(),
          ...buildCodexResponseItem(message)
        },
        {
          timestamp: new Date(baseTime + 1).toISOString(),
          ...buildCodexEventMirror(message)
        }
      ];
    })
  ];

  await writeTextFile(sessionPath, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`);
  const indexPath = await updateCodexSessionIndex({
    codexHome,
    sessionId,
    threadName,
    updatedAt: importedAt
  });
  const sqliteIndexPath = await upsertCodexThreadIndex({
    codexHome,
    sessionId,
    sessionPath,
    cwd,
    title: threadName,
    importedAt,
    metaSource,
    metaModelProvider,
    cliVersion,
    sandboxPolicy: threadTemplate?.sandbox_policy ? JSON.parse(threadTemplate.sandbox_policy) : (turnContext.sandbox_policy ?? { type: "workspace-write" }),
    approvalMode: threadTemplate?.approval_mode ?? "on-request",
    firstUserMessage,
    memoryMode: threadTemplate?.memory_mode ?? "enabled",
    gitSha: threadTemplate?.git_sha ?? null,
    gitBranch: threadTemplate?.git_branch ?? null,
    gitOriginUrl: threadTemplate?.git_origin_url ?? null
  });

  return {
    sessionId,
    sessionPath,
    codexHome,
    indexPath,
    sqliteIndexPath,
    importedMessages: importedMessages.length
  };
}

async function resolveGeminiProjectDirectory(geminiHome, cwd) {
  const tmpRoot = path.join(geminiHome, "tmp");
  const historyRoot = path.join(geminiHome, "history");
  const registryPath = path.join(geminiHome, "projects.json");
  await ensureDir(tmpRoot);
  await ensureDir(historyRoot);
  const normalizedCwd = normalizeGeminiProjectPath(cwd);
  const registry = await readJsonFile(registryPath, { projects: {} });
  const registryProjects = registry && typeof registry === "object" && registry.projects && typeof registry.projects === "object"
    ? registry.projects
    : {};
  const registeredProjectDir = typeof registryProjects[normalizedCwd] === "string" ? registryProjects[normalizedCwd].trim() : "";

  if (registeredProjectDir) {
    return registeredProjectDir;
  }

  const entries = await fs.readdir(tmpRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectRootPath = path.join(tmpRoot, entry.name, ".project_root");
    const projectRoot = await readTextFile(projectRootPath).catch(() => "");
    if (projectRoot && normalizeGeminiProjectPath(projectRoot.trim()) === normalizedCwd) {
      registryProjects[normalizedCwd] = entry.name;
      await writeJsonFile(registryPath, { projects: registryProjects });
      return entry.name;
    }
  }

  const existingProjectIds = new Set(Object.values(registryProjects).map((value) => String(value)));
  const baseSlug = slugifyGeminiProjectName(path.basename(cwd));
  let counter = 0;

  while (true) {
    const candidate = counter === 0 ? baseSlug : `${baseSlug}-${counter}`;
    counter += 1;

    if (existingProjectIds.has(candidate)) {
      continue;
    }

    const collisionRoots = [tmpRoot, historyRoot];
    let hasCollision = false;

    for (const root of collisionRoots) {
      const markerPath = path.join(root, candidate, ".project_root");
      const owner = await readTextFile(markerPath).catch(() => "");
      if (owner && normalizeGeminiProjectPath(owner.trim()) !== normalizedCwd) {
        hasCollision = true;
        break;
      }
    }

    if (hasCollision) {
      continue;
    }

    registryProjects[normalizedCwd] = candidate;
    await writeJsonFile(registryPath, { projects: registryProjects });
    return candidate;
  }
}

async function seedGeminiResumeSession({ bundle, cwd, options }) {
  const geminiHome = getGeminiHome(options);
  const sessionId = createSessionId();
  const projectDirName = await resolveGeminiProjectDirectory(geminiHome, cwd);
  const projectDir = path.join(geminiHome, "tmp", projectDirName);
  const chatsDir = path.join(projectDir, "chats");
  const sessionPath = path.join(chatsDir, `session-${formatIsoCompact()}-${sessionId.slice(0, 8)}.json`);
  const importedMessages = getImportedMessages(bundle);
  const fallbackTimestamp = new Date().toISOString();
  const resolvedCwd = path.resolve(cwd);
  const normalizedProjectRoot = normalizeGeminiProjectPath(resolvedCwd);
  const threadName = buildImportedThreadName(bundle);
  const payload = {
    sessionId,
    projectHash: projectDirName,
    title: threadName,
    summary: threadName,
    kind: "main",
    directories: [resolvedCwd],
    startTime: importedMessages[0]?.createdAt ?? fallbackTimestamp,
    lastUpdated: importedMessages.at(-1)?.createdAt ?? fallbackTimestamp,
    messages: importedMessages.map((message) => ({
      id: createSessionId(),
      timestamp: message.createdAt,
      type: message.role === "user" ? "user" : "gemini",
      role: message.role === "user" ? "user" : "model",
      content: message.content,
      parts: [
        {
          text: message.content
        }
      ]
    }))
  };

  await writeTextFile(path.join(projectDir, ".project_root"), normalizedProjectRoot);
  await writeTextFile(path.join(geminiHome, "history", projectDirName, ".project_root"), normalizedProjectRoot);
  await writeJsonFile(sessionPath, payload);

  return {
    sessionId,
    sessionPath,
    geminiHome,
    projectDirName,
    importedMessages: importedMessages.length,
    resumeHint: "latest"
  };
}

async function readCodexRolloutMetadata(filePath) {
  const raw = await readTextFile(filePath);
  const records = parseJsonLines(raw).slice(0, 50);
  let sessionId = extractSessionIdFromPath(filePath);
  let cwd = "";
  let firstPrompt = "";
  let startedAt = "";

  for (const record of records) {
    if (!startedAt && typeof record.timestamp === "string") {
      startedAt = record.timestamp;
    }

    if (record.type === "session_meta" && record.payload && typeof record.payload === "object") {
      sessionId = String(record.payload.id ?? sessionId).toLowerCase();
      cwd = typeof record.payload.cwd === "string" ? record.payload.cwd : cwd;
    }

    const candidate = record.payload && typeof record.payload === "object" ? record.payload : record;
    const role = extractRole(candidate);
    const content = extractContent(candidate);

    if (!firstPrompt && role === "user" && content) {
      firstPrompt = content.slice(0, 160);
    }
  }

  return {
    sessionId,
    cwd,
    firstPrompt,
    startedAt
  };
}

async function readClaudeSessionMetadata(filePath) {
  const raw = await readTextFile(filePath);
  const records = parseJsonLines(raw).slice(0, 50);
  let sessionId = path.basename(filePath, path.extname(filePath)).toLowerCase();
  let firstPrompt = "";
  let startedAt = "";
  let cwd = "";

  for (const record of records) {
    if (!startedAt && typeof record.timestamp === "string") {
      startedAt = record.timestamp;
    }

    if (!cwd && typeof record.cwd === "string" && record.cwd.trim()) {
      cwd = record.cwd.trim();
    }

    const candidate = record.message && typeof record.message === "object" ? record.message : record;
    const role = extractRole(candidate);
    const content = extractContent(candidate);

    if (!firstPrompt && role === "user" && content) {
      firstPrompt = content.slice(0, 160);
    }

    if (typeof record.sessionId === "string" && record.sessionId) {
      sessionId = record.sessionId.toLowerCase();
    }
  }

  return {
    sessionId,
    firstPrompt,
    startedAt,
    cwd
  };
}

async function readGeminiSessionMetadata(filePath) {
  const payload = await readJsonFile(filePath, {});
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const firstUserMessage = messages.find((message) => extractRole(message) === "user" && extractContent(message));

  return {
    sessionId: String(payload.sessionId ?? path.basename(filePath, path.extname(filePath))).toLowerCase(),
    firstPrompt: firstUserMessage ? extractContent(firstUserMessage).slice(0, 160) : "",
    startedAt: payload.startTime ?? "",
    updatedAt: payload.lastUpdated ?? "",
    threadName: payload.title ?? ""
  };
}

async function scanCodexSessionFiles(codexHome) {
  const directories = [
    { root: path.join(codexHome, "sessions"), archived: false },
    { root: path.join(codexHome, "archived_sessions"), archived: true }
  ];
  const items = new Map();

  for (const directory of directories) {
    const stat = await statSafe(directory.root);
    if (!stat || !stat.isDirectory()) {
      continue;
    }

    const files = (await listFilesRecursive(directory.root)).filter((filePath) => filePath.toLowerCase().endsWith(".jsonl"));
    for (const filePath of files) {
      const fileStat = await statSafe(filePath);
      const metadata = await readCodexRolloutMetadata(filePath);
      const sessionId = metadata.sessionId || extractSessionIdFromPath(filePath);

      if (!sessionId) {
        continue;
      }

      items.set(sessionId, {
        id: sessionId,
        cwd: metadata.cwd,
        firstPrompt: metadata.firstPrompt,
        startedAt: metadata.startedAt,
        archived: directory.archived,
        filePath,
        updatedAt: fileStat?.mtime?.toISOString() ?? null
      });
    }
  }

  return items;
}

async function scanClaudeSessionFiles(claudeHome) {
  const projectsRoot = path.join(claudeHome, "projects");
  const stat = await statSafe(projectsRoot);
  const items = new Map();

  if (!stat || !stat.isDirectory()) {
    return items;
  }

  const files = (await listFilesRecursive(projectsRoot)).filter((filePath) => {
    const normalized = filePath.replaceAll("\\", "/").toLowerCase();
    return normalized.endsWith(".jsonl") && !normalized.includes("/subagents/") && !normalized.includes("/tool-results/");
  });

  for (const filePath of files) {
    const fileStat = await statSafe(filePath);
    const metadata = await readClaudeSessionMetadata(filePath);

    items.set(metadata.sessionId, {
      id: metadata.sessionId,
      threadName: metadata.firstPrompt || path.basename(filePath, path.extname(filePath)),
      firstPrompt: metadata.firstPrompt,
      startedAt: metadata.startedAt,
      archived: false,
      filePath,
      cwd: metadata.cwd,
      updatedAt: fileStat?.mtime?.toISOString() ?? null
    });
  }

  return items;
}

async function scanGeminiSessionFiles(geminiHome) {
  const chatsRoot = path.join(geminiHome, "tmp");
  const stat = await statSafe(chatsRoot);
  const items = new Map();

  if (!stat || !stat.isDirectory()) {
    return items;
  }

  const files = (await listFilesRecursive(chatsRoot)).filter((filePath) => {
    const normalized = filePath.replaceAll("\\", "/").toLowerCase();
    return normalized.includes("/chats/") && path.basename(normalized).startsWith("session-") && normalized.endsWith(".json");
  });

  for (const filePath of files) {
    const fileStat = await statSafe(filePath);
    const metadata = await readGeminiSessionMetadata(filePath);
    const projectRootPath = path.join(path.dirname(path.dirname(filePath)), ".project_root");
    const projectRoot = (await readTextFile(projectRootPath).catch(() => "")).trim();

    items.set(metadata.sessionId, {
      id: metadata.sessionId,
      threadName: metadata.threadName || metadata.firstPrompt || path.basename(filePath, path.extname(filePath)),
      firstPrompt: metadata.firstPrompt,
      startedAt: metadata.startedAt,
      archived: false,
      filePath,
      cwd: projectRoot,
      updatedAt: metadata.updatedAt || fileStat?.mtime?.toISOString() || null
    });
  }

  return items;
}

async function getLocalSessionMap(platform, options = {}) {
  if (platform === "codex") {
    return scanCodexSessionFiles(getCodexHome(options));
  }

  if (platform === "claude") {
    return scanClaudeSessionFiles(getClaudeHome(options));
  }

  if (platform === "gemini") {
    return scanGeminiSessionFiles(getGeminiHome(options));
  }

  throw new Error(`Unsupported fork platform: ${platform}`);
}

async function listLocalSessions(platform, options = {}) {
  return [...(await getLocalSessionMap(platform, options)).values()].sort((left, right) =>
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""))
  );
}

async function resolveLocalSession(platform, options = {}) {
  const sessions = await listLocalSessions(platform, options);
  const requestedId = options.id ?? options["session-id"] ?? options.sessionId ?? options.session;

  if (requestedId) {
    if (platform === "gemini" && /^\d+$/.test(String(requestedId))) {
      const index = Number.parseInt(String(requestedId), 10) - 1;
      const byIndex = sessions[index];
      if (!byIndex) {
        throw new Error(`Gemini session index out of range: ${requestedId}`);
      }

      return {
        ...byIndex,
        resumeHint: index + 1
      };
    }

    const match = sessions.find((item) => item.id === String(requestedId).toLowerCase());
    if (!match) {
      throw new Error(`Session not found for platform "${platform}": ${requestedId}`);
    }

    return match;
  }

  if (parseCliBool(options.last)) {
    if (!sessions[0]) {
      throw new Error(`No sessions found for platform "${platform}".`);
    }

    return platform === "gemini"
      ? {
          ...sessions[0],
          resumeHint: 1
        }
      : sessions[0];
  }

  throw new Error(`Please pass --id or --last for platform "${platform}".`);
}

function buildBridgeOutputDir({ launchCwd, from, to, sessionId, outputDir }) {
  if (outputDir) {
    return path.resolve(outputDir);
  }

  const safeSessionId = sessionId.replaceAll(/[^a-zA-Z0-9-]/g, "_");
  return path.join(launchCwd, ".anyfork", "bridges", `${from}-to-${to}-${safeSessionId}-${formatTimestampForPath()}`);
}

function buildBridgePrompt({ from, to, handoffPath, bundlePath, extraPrompt }) {
  const lines = [
    `You are continuing a cross-platform session handoff from ${from} to ${to}.`,
    "Read the following files before taking action:",
    `1. ${formatPathForPrompt(handoffPath)}`,
    `2. ${formatPathForPrompt(bundlePath)}`,
    "After reading them, summarize the current goal, constraints, and recommended next step, then continue the task."
  ];

  if (extraPrompt) {
    lines.push(`Additional instruction: ${extraPrompt}`);
  }

  return lines.join("\n");
}

function renderBridgeHandoff(bundle) {
  const lines = [
    "# Cross-Agent Handoff",
    "",
    `- Source platform: ${bundle.source.platform}`,
    `- Source session id: ${bundle.source.sessionId}`,
    `- Exported at: ${bundle.exportedAt}`,
    `- Included messages: ${bundle.stats.includedMessages}`,
    `- Truncated: ${bundle.stats.truncated ? "yes" : "no"}`
  ];

  if (bundle.source.cwd) {
    lines.push(`- Source cwd: ${bundle.source.cwd}`);
  }

  if (bundle.latestUserMessage) {
    lines.push("", "## Latest User Intent", "", bundle.latestUserMessage);
  }

  if (bundle.userGoal) {
    lines.push("", "## Working Goal", "", bundle.userGoal);
  }

  lines.push("", "## Transcript", "");

  for (const message of bundle.messages) {
    lines.push(`### ${message.role} @ ${message.createdAt}`);
    lines.push("");
    lines.push(message.content || "(empty)");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function exportSessionBundleInternal(options = {}) {
  const from = requiredOption(options.from, "from");
  const session = await resolveLocalSession(from, options);
  const invocationCwd = path.resolve(options.cwd ?? process.cwd());
  const sourceProjectCwd = session.cwd ? path.resolve(session.cwd) : invocationCwd;
  const workspaceId = path.basename(sourceProjectCwd);
  const collected = await collectPlatformConversations({
    platform: from,
    workspaceId,
    inputPath: session.filePath
  });
  const conversation = collected.conversations[0];

  if (!conversation) {
    throw new Error(`Unable to parse session conversation for "${from}" from ${session.filePath}`);
  }

  const maxMessages = parseOptionalPositiveInt(options["max-messages"] ?? options.maxMessages);
  const dedupedMessages = dedupeTranscriptMessages(conversation.messages);
  const includedMessages = maxMessages ? dedupedMessages.slice(-maxMessages) : dedupedMessages;
  const truncated = Boolean(maxMessages) && includedMessages.length < dedupedMessages.length;
  const latestUserMessage = [...includedMessages].reverse().find((message) => message.role === "user")?.content ?? "";
  const latestAssistantMessage = [...includedMessages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const userGoal = options.prompt ?? latestUserMessage ?? "";
  const to = options.to ?? "bundle";
  const outputDir = buildBridgeOutputDir({
    launchCwd: invocationCwd,
    from,
    to,
    sessionId: session.id,
    outputDir: options["output-dir"] ?? options.outputDir
  });
  const bundlePath = path.join(outputDir, "bundle.json");
  const handoffPath = path.join(outputDir, "handoff.md");
  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: {
      platform: from,
      sessionId: session.id,
      filePath: session.filePath,
      startedAt: session.startedAt ?? null,
      updatedAt: session.updatedAt ?? null,
      cwd: session.cwd ?? "",
      title: conversation.title
    },
    stats: {
      messageCount: conversation.messageCount,
      includedMessages: includedMessages.length,
      truncated
    },
    latestUserMessage,
    latestAssistantMessage,
    userGoal,
    messages: includedMessages,
    conversation
  };

  await ensureDir(outputDir);
  await writeJsonFile(bundlePath, bundle);
  await writeTextFile(handoffPath, renderBridgeHandoff(bundle));

  return {
    outputDir,
    bundlePath,
    handoffPath,
    bundle,
    session,
    invocationCwd,
    sourceProjectCwd
  };
}

function buildCodexCommandArgs(options = {}) {
  const args = ["fork"];
  const sessionId = options.id ?? options["session-id"] ?? options.sessionId ?? options.session;
  const prompt = options.prompt ?? "";
  const cwd = options.cwd ?? options.cd;

  if (sessionId) {
    args.push(sessionId);
  } else if (parseCliBool(options.last)) {
    args.push("--last");
  }

  if (parseCliBool(options.all)) {
    args.push("--all");
  }

  if (parseCliBool(options.search)) {
    args.push("--search");
  }

  if (parseCliBool(options["full-auto"] ?? options.fullAuto)) {
    args.push("--full-auto");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.profile) {
    args.push("--profile", options.profile);
  }

  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }

  if (options["ask-for-approval"] ?? options.askForApproval) {
    args.push("--ask-for-approval", options["ask-for-approval"] ?? options.askForApproval);
  }

  if (cwd) {
    args.push("--cd", path.resolve(cwd));
  }

  for (const image of parseOptionalList(options.image)) {
    args.push("--image", image);
  }

  for (const writableDir of parseOptionalList(options["add-dir"] ?? options.addDir)) {
    args.push("--add-dir", path.resolve(writableDir));
  }

  if (prompt) {
    args.push(prompt);
  }

  return args;
}

function buildClaudeCommandArgs(options = {}) {
  const args = [];
  const sessionId = options.id ?? options["session-id"] ?? options.sessionId ?? options.session;
  const prompt = options.prompt ?? "";

  if (sessionId) {
    args.push("--resume", String(sessionId));
  } else if (parseCliBool(options.last)) {
    args.push("--continue");
  } else {
    throw new Error("Claude fork requires --id or --last.");
  }

  args.push("--fork-session");

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options["permission-mode"] ?? options.permissionMode) {
    args.push("--permission-mode", options["permission-mode"] ?? options.permissionMode);
  }

  if (parseCliBool(options["dangerously-skip-permissions"] ?? options.dangerouslySkipPermissions)) {
    args.push("--dangerously-skip-permissions");
  }

  for (const extraDir of parseOptionalList(options["add-dir"] ?? options.addDir)) {
    args.push("--add-dir", path.resolve(extraDir));
  }

  if (prompt) {
    args.push(prompt);
  }

  return args;
}

function buildGeminiCommandArgs(options = {}) {
  const args = [];
  const sessionId = options.id ?? options["session-id"] ?? options.sessionId ?? options.session;
  const prompt = options.prompt ?? "";

  if (sessionId) {
    args.push("--resume", String(sessionId));
  } else if (parseCliBool(options.last)) {
    args.push("--resume", "latest");
  } else {
    throw new Error("Gemini fork requires --id <index|latest> or --last.");
  }

  if (prompt) {
    args.push("--prompt-interactive", prompt);
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options["approval-mode"] ?? options.approvalMode) {
    args.push("--approval-mode", options["approval-mode"] ?? options.approvalMode);
  }

  if (parseCliBool(options.yolo)) {
    args.push("--yolo");
  }

  for (const extraDir of parseOptionalList(options["include-directories"] ?? options.includeDirectories)) {
    args.push("--include-directories", path.resolve(extraDir));
  }

  return args;
}

function buildCodexStartArgs(options = {}, prompt) {
  const args = [];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.profile) {
    args.push("--profile", options.profile);
  }

  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }

  if (options["ask-for-approval"] ?? options.askForApproval) {
    args.push("--ask-for-approval", options["ask-for-approval"] ?? options.askForApproval);
  }

  if (parseCliBool(options.search)) {
    args.push("--search");
  }

  if (parseCliBool(options["full-auto"] ?? options.fullAuto)) {
    args.push("--full-auto");
  }

  if (options.cwd ?? options.cd) {
    args.push("--cd", path.resolve(options.cwd ?? options.cd));
  }

  for (const writableDir of parseOptionalList(options["add-dir"] ?? options.addDir)) {
    args.push("--add-dir", path.resolve(writableDir));
  }

  if (prompt) {
    args.push(prompt);
  }

  return args;
}

function buildClaudeStartArgs(options = {}, prompt) {
  const args = [];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options["permission-mode"] ?? options.permissionMode) {
    args.push("--permission-mode", options["permission-mode"] ?? options.permissionMode);
  }

  if (parseCliBool(options["dangerously-skip-permissions"] ?? options.dangerouslySkipPermissions)) {
    args.push("--dangerously-skip-permissions");
  }

  for (const extraDir of parseOptionalList(options["add-dir"] ?? options.addDir)) {
    args.push("--add-dir", path.resolve(extraDir));
  }

  if (prompt) {
    args.push(prompt);
  }

  return args;
}

function buildClaudeResumeArgs(options = {}, sessionId) {
  const args = ["--resume", sessionId];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options["permission-mode"] ?? options.permissionMode) {
    args.push("--permission-mode", options["permission-mode"] ?? options.permissionMode);
  }

  if (parseCliBool(options["dangerously-skip-permissions"] ?? options.dangerouslySkipPermissions)) {
    args.push("--dangerously-skip-permissions");
  }

  for (const extraDir of parseOptionalList(options["add-dir"] ?? options.addDir)) {
    args.push("--add-dir", path.resolve(extraDir));
  }

  return args;
}

function buildCodexResumeArgs(options = {}, sessionId) {
  const args = ["resume", sessionId];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.profile) {
    args.push("--profile", options.profile);
  }

  if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }

  if (options["ask-for-approval"] ?? options.askForApproval) {
    args.push("--ask-for-approval", options["ask-for-approval"] ?? options.askForApproval);
  }

  if (parseCliBool(options.search)) {
    args.push("--search");
  }

  if (parseCliBool(options["full-auto"] ?? options.fullAuto)) {
    args.push("--full-auto");
  }

  if (options.cwd ?? options.cd) {
    args.push("--cd", path.resolve(options.cwd ?? options.cd));
  }

  for (const writableDir of parseOptionalList(options["add-dir"] ?? options.addDir)) {
    args.push("--add-dir", path.resolve(writableDir));
  }

  return args;
}

function buildGeminiStartArgs(options = {}, prompt) {
  const args = [];

  if (prompt) {
    args.push("--prompt-interactive", prompt);
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options["approval-mode"] ?? options.approvalMode) {
    args.push("--approval-mode", options["approval-mode"] ?? options.approvalMode);
  }

  if (parseCliBool(options.yolo)) {
    args.push("--yolo");
  }

  for (const extraDir of parseOptionalList(options["include-directories"] ?? options.includeDirectories)) {
    args.push("--include-directories", path.resolve(extraDir));
  }

  return args;
}

function buildGeminiResumeArgs(options = {}, resumeHint = "latest") {
  const args = ["--resume", String(resumeHint)];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options["approval-mode"] ?? options.approvalMode) {
    args.push("--approval-mode", options["approval-mode"] ?? options.approvalMode);
  }

  if (parseCliBool(options.yolo)) {
    args.push("--yolo");
  }

  for (const extraDir of parseOptionalList(options["include-directories"] ?? options.includeDirectories)) {
    args.push("--include-directories", path.resolve(extraDir));
  }

  return args;
}

export function buildCliSpawnInvocation(command, args, { cwd } = {}) {
  if (process.platform === "win32") {
    return {
      command,
      args,
      options: {
        cwd,
        stdio: "inherit",
        shell: true
      }
    };
  }

  return {
    command,
    args,
    options: {
      cwd,
      stdio: "inherit"
    }
  };
}

async function spawnCliCommand(command, args, { cwd } = {}) {
  const invocation = buildCliSpawnInvocation(command, args, { cwd });

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, invocation.options);

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

export async function platformsCommand() {
  return {
    ok: true,
    platforms: Object.values(PLATFORM_DEFINITIONS).map((platform) => ({
      id: platform.id,
      label: platform.label,
      defaultRoots: platform.defaultRoots
    }))
  };
}

export async function helpCommand() {
  return {
    ok: true,
    docsPath: getDocsPath(),
    commands: [
      "help",
      "platforms",
      "fork"
    ],
    quickStart: [
      "Install the CLI from npm",
      "Run anyfork fork <from> <to> <session|last>",
      "Inspect .anyfork/bridges if you want to review the generated handoff"
    ],
    examples: {
      forkFromCodexToClaude: "anyfork fork codex claude last",
      forkFromClaudeToGemini: "anyfork fork claude gemini <session-id>"
    }
  };
}

export async function codexSessionsCommand(options = {}) {
  const codexHome = getCodexHome(options);
  const fileMetadata = await scanCodexSessionFiles(codexHome);
  const cwdFilter = options.cwd ? path.resolve(options.cwd) : "";
  const includeArchivedOnly = parseCliBool(options.archived);
  const limit = parseLimit(options.limit);
  const items = [...fileMetadata.values()]
    .filter((item) => {
      if (includeArchivedOnly && !item.archived) {
        return false;
      }

      if (!cwdFilter) {
        return true;
      }

      return Boolean(item.cwd) && sameResolvedPath(item.cwd, cwdFilter);
    })
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, limit);

  return {
    ok: true,
    codexHome,
    total: items.length,
    items,
    latestSessionId: items[0]?.id ?? null
  };
}

async function listClaudeSessions(options = {}) {
  const claudeHome = getClaudeHome(options);
  const limit = parseLimit(options.limit);
  const items = [...(await scanClaudeSessionFiles(claudeHome)).values()]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, limit);

  return {
    ok: true,
    platform: "claude",
    home: claudeHome,
    total: items.length,
    items,
    latestSessionId: items[0]?.id ?? null
  };
}

async function listGeminiSessions(options = {}) {
  const geminiHome = getGeminiHome(options);
  const limit = parseLimit(options.limit);
  const items = [...(await scanGeminiSessionFiles(geminiHome)).values()]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      resumeHint: index + 1
    }));

  return {
    ok: true,
    platform: "gemini",
    home: geminiHome,
    total: items.length,
    items,
    latestSessionId: items[0]?.id ?? null,
    note: "Gemini native resume uses latest or index-like hints. AnyFork exposes resumeHint as a best-effort helper."
  };
}

export async function agentSessionsCommand(options = {}) {
  const platform = options.platform ?? "codex";

  if (platform === "codex") {
    const payload = await codexSessionsCommand(options);
    return {
      ...payload,
      platform: "codex",
      home: payload.codexHome
    };
  }

  if (platform === "claude") {
    return listClaudeSessions(options);
  }

  if (platform === "gemini") {
    return listGeminiSessions(options);
  }

  throw new Error(`Unsupported fork platform: ${platform}`);
}

export async function agentBridgeExportCommand(options = {}) {
  const payload = await exportSessionBundleInternal(options);

  return {
    ok: true,
    from: options.from,
    sessionId: payload.session.id,
    outputDir: payload.outputDir,
    bundlePath: payload.bundlePath,
    handoffPath: payload.handoffPath,
    includedMessages: payload.bundle.stats.includedMessages,
    truncated: payload.bundle.stats.truncated
  };
}

export async function codexForkCommand(options = {}, runtime = {}) {
  const command = runtime.command ?? "codex";
  const args = buildCodexCommandArgs(options);
  const launchCwd = runtime.cwd ?? process.cwd();

  if (parseCliBool(options["dry-run"] ?? options.dryRun)) {
    return {
      ok: true,
      dryRun: true,
      command,
      args,
      launchCwd
    };
  }

  const spawnCommand = runtime.spawnCommand ?? spawnCliCommand;
  const exitCode = await spawnCommand(command, args, { cwd: launchCwd });

  return {
    ok: exitCode === 0,
    command,
    args,
    exitCode,
    launchCwd,
    silent: true
  };
}

export async function agentForkCommand(options = {}, runtime = {}) {
  const platform = options.platform ?? "codex";
  const launchCwd = path.resolve(runtime.cwd ?? options.cwd ?? process.cwd());
  let command = "";
  let args = [];

  if (platform === "codex") {
    command = runtime.command ?? "codex";
    args = buildCodexCommandArgs(options);
  } else if (platform === "claude") {
    command = runtime.command ?? "claude";
    args = buildClaudeCommandArgs(options);
  } else if (platform === "gemini") {
    command = runtime.command ?? "gemini";
    args = buildGeminiCommandArgs(options);
  } else {
    throw new Error(`Unsupported fork platform: ${platform}`);
  }

  if (parseCliBool(options["dry-run"] ?? options.dryRun)) {
    return {
      ok: true,
      dryRun: true,
      platform,
      command,
      args,
      launchCwd
    };
  }

  const spawnCommand = runtime.spawnCommand ?? spawnCliCommand;
  const exitCode = await spawnCommand(command, args, { cwd: launchCwd });

  return {
    ok: exitCode === 0,
    silent: true,
    platform,
    command,
    args,
    exitCode,
    launchCwd
  };
}

export async function agentBridgeForkCommand(options = {}, runtime = {}) {
  const from = requiredOption(options.from, "from");
  const to = requiredOption(options.to, "to");

  if (from === to) {
    throw new Error("Cross-platform fork requires --from and --to to be different.");
  }

  const invocationCwd = path.resolve(runtime.cwd ?? process.cwd());
  const exportPayload = await exportSessionBundleInternal({
    ...options,
    from,
    to,
    cwd: invocationCwd
  });
  const targetCwd = path.resolve(options.cwd ?? invocationCwd);
  let seededSession = null;
  let command = "";
  let args = [];

  if (to === "claude") {
    seededSession = await seedClaudeResumeSession({
      bundle: exportPayload.bundle,
      cwd: targetCwd,
      options
    });
    command = "claude";
    args = buildClaudeResumeArgs(options, seededSession.sessionId);
  } else if (to === "codex") {
    seededSession = await seedCodexResumeSession({
      bundle: exportPayload.bundle,
      cwd: targetCwd,
      options
    });
    command = "codex";
    args = buildCodexResumeArgs({ ...options, cwd: targetCwd }, seededSession.sessionId);
  } else if (to === "gemini") {
    seededSession = await seedGeminiResumeSession({
      bundle: exportPayload.bundle,
      cwd: targetCwd,
      options
    });
    command = "gemini";
    args = buildGeminiResumeArgs(options, seededSession.resumeHint);
  } else {
    throw new Error(`Unsupported bridge target: ${to}`);
  }

  if (parseCliBool(options["dry-run"] ?? options.dryRun)) {
    return {
      ok: true,
      dryRun: true,
      from,
      to,
      command,
      args,
      launchCwd: invocationCwd,
      targetCwd,
      outputDir: exportPayload.outputDir,
      bundlePath: exportPayload.bundlePath,
      handoffPath: exportPayload.handoffPath,
      seededSession
    };
  }

  const spawnCommand = runtime.spawnCommand ?? spawnCliCommand;
  const exitCode = await spawnCommand(command, args, { cwd: targetCwd });

  return {
    ok: exitCode === 0,
    silent: true,
    from,
    to,
    command,
    args,
    exitCode,
    launchCwd: invocationCwd,
    targetCwd,
    outputDir: exportPayload.outputDir,
    bundlePath: exportPayload.bundlePath,
    handoffPath: exportPayload.handoffPath,
    seededSession
  };
}
