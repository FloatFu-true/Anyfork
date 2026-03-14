import path from "node:path";

import {
  agentBridgeForkCommand,
  agentSessionsCommand,
  collectPlatformConversations
} from "@floatfu-true/anyfork-core";

const PLATFORM_IDS = ["codex", "claude", "gemini"];
const DEFAULT_PLATFORM_LIMIT = 25;
const DEFAULT_RESULT_LIMIT = 5;
const DEFAULT_PREVIEW_CANDIDATES = 8;
const DEFAULT_PREVIEW_MESSAGES = 6;

function normalizeComparablePath(targetPath) {
  return path.resolve(targetPath).replaceAll("\\", "/").toLowerCase();
}

function sameResolvedPath(leftPath, rightPath) {
  return normalizeComparablePath(leftPath) === normalizeComparablePath(rightPath);
}

function ensurePlatform(platform) {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (!PLATFORM_IDS.includes(normalized)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return normalized;
}

function normalizePlatforms(platforms) {
  if (!platforms || platforms.length === 0) {
    return [...PLATFORM_IDS];
  }

  return [...new Set(platforms.map(ensurePlatform))];
}

function parseOptionalPositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numeric = Number.parseInt(String(value), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function unique(items) {
  return [...new Set(items)];
}

function overlapScore(queryTokens, text, multiplier) {
  if (!text) {
    return 0;
  }

  const haystack = String(text).toLowerCase();
  let score = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += multiplier;
    }
  }

  return score;
}

function buildSessionSummary(session) {
  return [
    session.threadName,
    session.firstPrompt,
    session.cwd,
    session.preview?.latestUserMessage,
    session.preview?.latestAssistantMessage,
    ...(session.preview?.messageSnippets ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreSession(session, { queryTokens, currentProjectCwd }) {
  const reasons = [];
  let score = 0;

  score += overlapScore(queryTokens, session.threadName, 6);
  if (overlapScore(queryTokens, session.threadName, 1) > 0) {
    reasons.push("matched_thread_name");
  }

  score += overlapScore(queryTokens, session.firstPrompt, 5);
  if (overlapScore(queryTokens, session.firstPrompt, 1) > 0) {
    reasons.push("matched_first_prompt");
  }

  score += overlapScore(queryTokens, session.preview?.latestUserMessage, 4);
  score += overlapScore(queryTokens, session.preview?.latestAssistantMessage, 2);
  score += overlapScore(queryTokens, (session.preview?.messageSnippets ?? []).join("\n"), 1);

  if (currentProjectCwd && session.cwd && sameResolvedPath(currentProjectCwd, session.cwd)) {
    score += 20;
    reasons.push("same_project_cwd");
  } else if (currentProjectCwd && session.cwd) {
    const currentBase = path.basename(path.resolve(currentProjectCwd)).toLowerCase();
    const sessionBase = path.basename(path.resolve(session.cwd)).toLowerCase();
    if (currentBase && currentBase === sessionBase) {
      score += 8;
      reasons.push("same_project_name");
    }
  }

  if (session.updatedAt) {
    const ageMs = Date.now() - new Date(session.updatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      if (ageMs < 1000 * 60 * 60 * 6) {
        score += 4;
        reasons.push("recent_session");
      } else if (ageMs < 1000 * 60 * 60 * 24 * 3) {
        score += 2;
      }
    }
  }

  return {
    score,
    reasons: unique(reasons)
  };
}

async function loadSessionPreview(session, options = {}) {
  const workspaceId = path.basename(path.resolve(session.cwd || process.cwd()));
  const collected = await collectPlatformConversations({
    platform: session.platform,
    workspaceId,
    inputPath: session.filePath
  });
  const conversation = collected.conversations[0];
  const previewCount = parseOptionalPositiveInt(options.previewMessages, DEFAULT_PREVIEW_MESSAGES);

  if (!conversation) {
    return {
      title: session.threadName || session.firstPrompt || session.id,
      latestUserMessage: "",
      latestAssistantMessage: "",
      messageSnippets: []
    };
  }

  const recentMessages = conversation.messages.slice(-previewCount);
  const latestUserMessage = [...recentMessages].reverse().find((item) => item.role === "user")?.content ?? "";
  const latestAssistantMessage = [...recentMessages].reverse().find((item) => item.role === "assistant")?.content ?? "";

  return {
    title: conversation.title,
    latestUserMessage,
    latestAssistantMessage,
    messageSnippets: recentMessages.map((item) => `[${item.role}] ${item.content.slice(0, 280)}`)
  };
}

function toSerializableSession(session) {
  return {
    id: session.id,
    platform: session.platform,
    cwd: session.cwd || "",
    updatedAt: session.updatedAt ?? null,
    startedAt: session.startedAt ?? null,
    archived: Boolean(session.archived),
    firstPrompt: session.firstPrompt || "",
    threadName: session.threadName || "",
    filePath: session.filePath,
    score: session.score ?? null,
    reasons: session.reasons ?? [],
    preview: session.preview ?? null
  };
}

export async function listSessions(options = {}) {
  const platforms = normalizePlatforms(options.platforms);
  const limitPerPlatform = parseOptionalPositiveInt(options.limitPerPlatform, DEFAULT_PLATFORM_LIMIT);
  const cwdFilter = options.cwd ? path.resolve(options.cwd) : "";
  const results = [];

  for (const platform of platforms) {
    const response = await agentSessionsCommand({
      platform,
      limit: String(limitPerPlatform),
      "codex-home": options.codexHome,
      "claude-home": options.claudeHome,
      "gemini-home": options.geminiHome
    });

    for (const item of response.items) {
      if (cwdFilter && (!item.cwd || !sameResolvedPath(item.cwd, cwdFilter))) {
        continue;
      }

      results.push({
        ...item,
        platform
      });
    }
  }

  results.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));

  return {
    total: results.length,
    items: results.map(toSerializableSession)
  };
}

export async function findRelevantSessions(options = {}) {
  const query = String(options.query ?? "").trim();
  if (!query) {
    throw new Error("Missing required query.");
  }

  const currentProjectCwd = options.cwd ? path.resolve(options.cwd) : "";
  const platforms = normalizePlatforms(options.platforms);
  const limit = parseOptionalPositiveInt(options.limit, DEFAULT_RESULT_LIMIT);
  const previewCandidates = parseOptionalPositiveInt(options.previewCandidates, DEFAULT_PREVIEW_CANDIDATES);
  const queryTokens = unique(tokenize(query));

  if (queryTokens.length === 0) {
    throw new Error("Query must contain searchable keywords.");
  }

  const listed = await listSessions({
    platforms,
    cwd: options.onlyCurrentCwd ? currentProjectCwd : "",
    limitPerPlatform: options.limitPerPlatform,
    codexHome: options.codexHome,
    claudeHome: options.claudeHome,
    geminiHome: options.geminiHome
  });

  const scored = listed.items
    .map((session) => {
      const initial = scoreSession(session, {
        queryTokens,
        currentProjectCwd
      });
      return {
        ...session,
        score: initial.score,
        reasons: initial.reasons
      };
    })
    .filter((session) => session.score > 0 || (currentProjectCwd && session.cwd && sameResolvedPath(currentProjectCwd, session.cwd)))
    .sort((left, right) => right.score - left.score || String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));

  const previewed = [];
  for (const candidate of scored.slice(0, previewCandidates)) {
    const preview = await loadSessionPreview(candidate, {
      previewMessages: options.previewMessages
    });
    const rescored = scoreSession(
      {
        ...candidate,
        preview,
        threadName: preview.title || candidate.threadName
      },
      {
        queryTokens,
        currentProjectCwd
      }
    );

    previewed.push({
      ...candidate,
      threadName: preview.title || candidate.threadName,
      preview,
      score: rescored.score,
      reasons: rescored.reasons
    });
  }

  const finalItems = [...previewed, ...scored.slice(previewCandidates)]
    .sort((left, right) => right.score - left.score || String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, limit)
    .map(toSerializableSession);

  return {
    query,
    totalCandidates: scored.length,
    items: finalItems
  };
}

export async function importSession(options = {}) {
  const from = ensurePlatform(options.from);
  const to = ensurePlatform(options.to);
  const sessionId = String(options.sessionId ?? "").trim();
  if (!sessionId) {
    throw new Error("Missing required sessionId.");
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const dryRun = options.dryRun === true || options.dryRun === "true";
  const payload = await agentBridgeForkCommand(
    {
      from,
      to,
      id: sessionId,
      cwd,
      prompt: options.prompt,
      "max-messages": options.maxMessages,
      "codex-home": options.codexHome,
      "claude-home": options.claudeHome,
      "gemini-home": options.geminiHome,
      "dry-run": dryRun ? "true" : "false"
    },
    dryRun
      ? { cwd }
      : {
          cwd,
          // MCP should import context without opening an interactive CLI process.
          spawnCommand: async () => 0
        }
  );

  return {
    ...payload,
    imported: !dryRun,
    note:
      dryRun
        ? payload.note ?? "Dry run only exported artifacts."
        : "Session artifacts created and target-native resume data seeded without launching the target CLI."
  };
}

export async function findAndImportSession(options = {}) {
  const matches = await findRelevantSessions(options);
  const bestMatch = matches.items[0];

  if (!bestMatch) {
    throw new Error(`No relevant sessions found for query: ${options.query}`);
  }

  const imported = await importSession({
    ...options,
    from: bestMatch.platform,
    sessionId: bestMatch.id
  });

  return {
    query: String(options.query ?? ""),
    selectedSession: bestMatch,
    importResult: imported
  };
}
