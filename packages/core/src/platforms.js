import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeConversationEnvelope, normalizeMessage } from "./conversation.js";
import { fileExists, listDirectoriesRecursive, listFilesRecursive, readJsonFile, readTextFile, statSafe } from "./files.js";

const JSON_EXTENSIONS = new Set([".json", ".jsonl"]);
const HOME = os.homedir();

export const PLATFORM_DEFINITIONS = {
  codex: {
    id: "codex",
    label: "Codex",
    defaultRoots: [path.join(HOME, ".codex")],
    preferredFiles: ["history.jsonl", "conversation.json", "messages.json", "chat.jsonl"]
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    defaultRoots: [path.join(HOME, ".claude", "projects"), path.join(HOME, ".claude")],
    preferredFiles: ["conversation.json", "messages.json", "history.jsonl", "chat.jsonl"]
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    defaultRoots: [path.join(HOME, ".gemini"), path.join(HOME, ".config", "gemini")],
    preferredFiles: ["history.jsonl", "messages.json", "conversation.json", "chat.json"]
  }
};

export function getPlatformDefinition(platformId) {
  const definition = PLATFORM_DEFINITIONS[platformId];

  if (!definition) {
    throw new Error(`Unsupported platform: ${platformId}`);
  }

  return definition;
}

function normalizePathForMatch(filePath) {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

function parseJsonLines(raw) {
  return raw
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

function findMessageArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const objectCandidates = [
    value.messages,
    value.items,
    value.events,
    value.history,
    value.chat_history,
    value.conversation?.messages,
    value.data?.messages
  ];

  for (const candidate of objectCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function pickConversationTitle(value, fallbackTitle) {
  if (!value || typeof value !== "object") {
    return fallbackTitle;
  }

  return (
    value.title ??
    value.name ??
    value.subject ??
    value.sessionId ??
    value.session_id ??
    value.conversationId ??
    value.conversation_id ??
    value.projectHash ??
    value.conversation?.title ??
    fallbackTitle
  );
}

function pickJsonlTitle(messages, fallbackTitle) {
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const candidate =
      message.title ??
      message.name ??
      message.sessionId ??
      message.session_id ??
      message.conversationId ??
      message.conversation_id ??
      message.payload?.title ??
      message.payload?.id ??
      message.payload?.sessionId ??
      message.payload?.session_id;

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallbackTitle;
}

function isCodexSessionFile(filePath) {
  const normalized = normalizePathForMatch(filePath);
  return normalized.includes("/sessions/") || normalized.includes("/archived_sessions/");
}

function isClaudeSessionFile(filePath) {
  const normalized = normalizePathForMatch(filePath);
  return (
    normalized.includes("/projects/") &&
    normalized.endsWith(".jsonl") &&
    !normalized.includes("/subagents/") &&
    !normalized.includes("/tool-results/")
  );
}

function isGeminiSessionFile(filePath) {
  const normalized = normalizePathForMatch(filePath);
  return normalized.includes("/chats/") && path.basename(normalized).startsWith("session-");
}

async function parseMessageFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (!JSON_EXTENSIONS.has(extension)) {
    return { title: path.basename(filePath, extension), messages: [] };
  }

  if (extension === ".jsonl") {
    const raw = await readTextFile(filePath);
    const messages = parseJsonLines(raw);
    return {
      title: pickJsonlTitle(messages, path.basename(filePath, extension)),
      messages
    };
  }

  const json = await readJsonFile(filePath, {});
  return {
    title: pickConversationTitle(json, path.basename(filePath, extension)),
    messages: findMessageArray(json),
    metadata: json
  };
}

async function detectDefaultRoot(platform) {
  const definition = getPlatformDefinition(platform);

  for (const candidate of definition.defaultRoots) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function discoverConversationDirs(rootPath, preferredFiles) {
  const directories = await listDirectoriesRecursive(rootPath);
  const matched = [];

  for (const directory of directories) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const entryNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const hasPreferredFile = preferredFiles.some((fileName) => entryNames.has(fileName));

    if (hasPreferredFile) {
      matched.push(directory);
    }
  }

  return matched;
}

async function parseDirectoryConversation({ directoryPath, platform, workspaceId, sourceRoot }) {
  const definition = getPlatformDefinition(platform);
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter((filePath) => JSON_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  const preferredFiles = [];
  const otherFiles = [];

  for (const filePath of files) {
    if (definition.preferredFiles.includes(path.basename(filePath))) {
      preferredFiles.push(filePath);
    } else {
      otherFiles.push(filePath);
    }
  }

  const orderedFiles = preferredFiles.length > 0 ? [...preferredFiles, ...otherFiles] : files;
  const allMessages = [];
  let title = path.basename(directoryPath);
  const rawMetadata = {
    platform,
    directoryPath
  };

  for (const filePath of orderedFiles) {
    const parsed = await parseMessageFile(filePath);
    if (parsed.title && parsed.title !== path.basename(filePath, path.extname(filePath))) {
      title = parsed.title;
    }

    parsed.messages.forEach((message, index) => {
      const normalized = normalizeMessage(message, index, path.basename(filePath));
      if (normalized) {
        allMessages.push(normalized);
      }
    });
  }

  if (allMessages.length === 0) {
    return null;
  }

  return normalizeConversationEnvelope({
    platform,
    workspaceId,
    title,
    sourceRoot,
    originFiles: orderedFiles.map((filePath) => path.relative(sourceRoot, filePath)),
    messages: allMessages,
    rawMetadata
  });
}

async function parseSingleFileConversation({ filePath, platform, workspaceId, sourceRoot }) {
  const parsed = await parseMessageFile(filePath);
  const messages = parsed.messages
    .map((message, index) => normalizeMessage(message, index, path.basename(filePath)))
    .filter(Boolean);

  if (messages.length === 0) {
    return null;
  }

  return normalizeConversationEnvelope({
    platform,
    workspaceId,
    title: parsed.title || path.basename(filePath, path.extname(filePath)),
    sourceRoot,
    originFiles: [path.relative(sourceRoot, filePath)],
    messages,
    rawMetadata: {
      platform,
      filePath: path.relative(sourceRoot, filePath)
    }
  });
}

async function parseSelectedFiles({ files, platform, workspaceId, sourceRoot }) {
  const conversations = [];

  for (const filePath of files) {
    const parsed = await parseSingleFileConversation({
      filePath,
      platform,
      workspaceId,
      sourceRoot
    });

    if (parsed) {
      conversations.push(parsed);
    }
  }

  const deduped = new Map();
  for (const conversation of conversations) {
    deduped.set(conversation.conversationId, conversation);
  }

  return [...deduped.values()];
}

function getSpecialFileMatcher(platform) {
  if (platform === "codex") {
    return isCodexSessionFile;
  }

  if (platform === "claude") {
    return isClaudeSessionFile;
  }

  if (platform === "gemini") {
    return isGeminiSessionFile;
  }

  return null;
}

export async function collectPlatformConversations({ platform, workspaceId, inputPath }) {
  const definition = getPlatformDefinition(platform);
  const resolvedInput = inputPath ? path.resolve(inputPath) : await detectDefaultRoot(platform);

  if (!resolvedInput) {
    throw new Error(
      `No input path found for platform "${platform}". Please pass --input or create one of: ${definition.defaultRoots.join(", ")}`
    );
  }

  const stat = await statSafe(resolvedInput);
  if (!stat) {
    throw new Error(`Input path does not exist: ${resolvedInput}`);
  }

  if (stat.isFile()) {
    const conversation = await parseSingleFileConversation({
      filePath: resolvedInput,
      platform,
      workspaceId,
      sourceRoot: path.dirname(resolvedInput)
    });

    return {
      sourceRoot: resolvedInput,
      conversations: conversation ? [conversation] : []
    };
  }

  const allFiles = await listFilesRecursive(resolvedInput);
  const jsonFiles = allFiles.filter((filePath) => JSON_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
  const specialMatcher = getSpecialFileMatcher(platform);

  if (specialMatcher) {
    const matched = jsonFiles.filter((filePath) => specialMatcher(filePath));

    if (matched.length > 0) {
      return {
        sourceRoot: resolvedInput,
        conversations: await parseSelectedFiles({
          files: matched,
          platform,
          workspaceId,
          sourceRoot: resolvedInput
        })
      };
    }
  }

  const conversationDirs = await discoverConversationDirs(resolvedInput, definition.preferredFiles);

  if (conversationDirs.length > 0) {
    const conversations = [];

    for (const directoryPath of conversationDirs) {
      const parsed = await parseDirectoryConversation({
        directoryPath,
        platform,
        workspaceId,
        sourceRoot: resolvedInput
      });

      if (parsed) {
        conversations.push(parsed);
      }
    }

    const deduped = new Map();
    for (const conversation of conversations) {
      deduped.set(conversation.conversationId, conversation);
    }

    return {
      sourceRoot: resolvedInput,
      conversations: [...deduped.values()]
    };
  }

  return {
    sourceRoot: resolvedInput,
    conversations: await parseSelectedFiles({
      files: jsonFiles,
      platform,
      workspaceId,
      sourceRoot: resolvedInput
    })
  };
}
