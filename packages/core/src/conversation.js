import crypto from "node:crypto";

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeRole(rawRole) {
  const value = String(rawRole ?? "").trim().toLowerCase();

  if (!value) {
    return "assistant";
  }

  if (["user", "human", "user_message"].includes(value)) {
    return "user";
  }

  if (["assistant", "model", "gemini", "ai", "bot", "agent_message"].includes(value)) {
    return "assistant";
  }

  if (value.includes("tool") || value.includes("function")) {
    return "tool";
  }

  if (value.includes("system") || value.includes("developer")) {
    return "system";
  }

  return value;
}

export function normalizeTimestamp(rawTimestamp) {
  if (!rawTimestamp) {
    return new Date().toISOString();
  }

  if (typeof rawTimestamp === "number") {
    const value = rawTimestamp > 9999999999 ? rawTimestamp : rawTimestamp * 1000;
    return new Date(value).toISOString();
  }

  const parsed = new Date(rawTimestamp);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString();
  }

  return new Date().toISOString();
}

export function extractContent(rawMessage) {
  if (typeof rawMessage === "string") {
    return rawMessage.trim();
  }

  if (!rawMessage || typeof rawMessage !== "object") {
    return "";
  }

  const directCandidates = [
    rawMessage.content,
    rawMessage.text,
    rawMessage.message,
    rawMessage.value,
    rawMessage.body,
    rawMessage.display
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(rawMessage.content)) {
    return rawMessage.content.map((item) => extractContent(item)).filter(Boolean).join("\n").trim();
  }

  if (Array.isArray(rawMessage.parts)) {
    return rawMessage.parts.map((item) => extractContent(item)).filter(Boolean).join("\n").trim();
  }

  if (rawMessage.content && typeof rawMessage.content === "object") {
    return extractContent(rawMessage.content);
  }

  if (rawMessage.message && typeof rawMessage.message === "object") {
    return extractContent(rawMessage.message);
  }

  if (rawMessage.payload && typeof rawMessage.payload === "object") {
    return extractContent(rawMessage.payload);
  }

  if (rawMessage.data && typeof rawMessage.data === "object") {
    return extractContent(rawMessage.data);
  }

  if (typeof rawMessage.delta === "string") {
    return rawMessage.delta.trim();
  }

  return "";
}

export function extractRole(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "object") {
    return "assistant";
  }

  return normalizeRole(
    rawMessage.role ??
      rawMessage.author?.role ??
      rawMessage.author ??
      rawMessage.sender ??
      rawMessage.message?.role ??
      rawMessage.message?.author?.role ??
      rawMessage.message?.author ??
      rawMessage.payload?.role ??
      rawMessage.payload?.author?.role ??
      rawMessage.payload?.author ??
      rawMessage.payload?.sender ??
      rawMessage.payload?.message?.role ??
      rawMessage.payload?.type ??
      rawMessage.type
  );
}

export function extractTimestamp(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "object") {
    return normalizeTimestamp();
  }

  return normalizeTimestamp(
    rawMessage.createdAt ??
      rawMessage.created_at ??
      rawMessage.timestamp ??
      rawMessage.ts ??
      rawMessage.time ??
      rawMessage.date ??
      rawMessage.message?.timestamp ??
      rawMessage.message?.createdAt ??
      rawMessage.payload?.timestamp ??
      rawMessage.payload?.createdAt ??
      rawMessage.payload?.created_at ??
      rawMessage.payload?.ts ??
      rawMessage.payload?.message?.timestamp
  );
}

export function normalizeMessage(rawMessage, index, sourceFile) {
  const content = extractContent(rawMessage);

  if (!content) {
    return null;
  }

  const createdAt = extractTimestamp(rawMessage);
  const role = extractRole(rawMessage);
  const messageId =
    rawMessage?.id ??
    rawMessage?.messageId ??
    rawMessage?.uuid ??
    rawMessage?.payload?.id ??
    rawMessage?.payload?.messageId ??
    sha256(`${sourceFile}:${index}:${role}:${createdAt}:${content}`).slice(0, 20);

  return {
    messageId,
    role,
    content,
    createdAt,
    metadata: {
      sourceFile,
      rawType:
        rawMessage && typeof rawMessage === "object"
          ? String(rawMessage.message?.type ?? rawMessage.payload?.type ?? rawMessage.type ?? "message")
          : "message"
    }
  };
}

export function buildConversationId({ platform, workspaceId, title, originKey }) {
  return sha256(
    JSON.stringify({
      platform,
      workspaceId,
      title,
      originKey
    })
  ).slice(0, 24);
}

export function normalizeConversationEnvelope({
  platform,
  workspaceId,
  title,
  sourceRoot,
  originFiles,
  messages,
  rawMetadata
}) {
  const safeMessages = [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const fingerprint = sha256(
    JSON.stringify({
      platform,
      workspaceId,
      title,
      messages: safeMessages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      }))
    })
  );
  const originKey = originFiles.join("|");
  const conversationId = buildConversationId({
    platform,
    workspaceId,
    title,
    originKey
  });

  return {
    conversationId,
    platform,
    workspaceId,
    title,
    sourceRoot,
    originFiles,
    fingerprint,
    messageCount: safeMessages.length,
    messages: safeMessages,
    rawMetadata,
    exportedAt: new Date().toISOString()
  };
}
