#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  findAndImportSession,
  findRelevantSessions,
  importSession,
  listSessions
} from "./service.js";

const platformEnum = z.enum(["codex", "claude", "gemini"]);

function optionalPlatformsSchema() {
  return z.array(platformEnum).min(1).optional();
}

function asText(value) {
  return JSON.stringify(value, null, 2);
}

export function createServer() {
  const server = new McpServer({
    name: "anyfork-mcp-server",
    version: "0.1.6"
  });

  server.registerTool(
    "anyfork_list_sessions",
    {
      title: "List AnyFork Sessions",
      description: "List local Codex, Claude, and Gemini sessions available for AnyFork bridging. Use this to inspect session ids, projects, and recency before importing.",
      inputSchema: {
        platforms: optionalPlatformsSchema(),
        cwd: z.string().optional().describe("Optional project cwd to filter sessions that belong to the same project."),
        limitPerPlatform: z.number().int().min(1).max(100).default(25).describe("Max sessions to inspect per platform."),
        codexHome: z.string().optional(),
        claudeHome: z.string().optional(),
        geminiHome: z.string().optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await listSessions(input);
      return {
        content: [{ type: "text", text: asText(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "anyfork_find_relevant_sessions",
    {
      title: "Find Relevant AnyFork Sessions",
      description: "Search local sessions by user intent or bug description, score likely matches, and return the best candidates with recent transcript previews.",
      inputSchema: {
        query: z.string().min(2).describe("User intent, task description, bug report, or feature request to match against local sessions."),
        platforms: optionalPlatformsSchema(),
        cwd: z.string().optional().describe("Current project cwd. Matching sessions from the same project are boosted."),
        onlyCurrentCwd: z.boolean().default(false).describe("When true, only search sessions whose cwd exactly matches the provided cwd."),
        limit: z.number().int().min(1).max(20).default(5),
        limitPerPlatform: z.number().int().min(1).max(100).default(25),
        previewCandidates: z.number().int().min(1).max(20).default(8),
        previewMessages: z.number().int().min(1).max(20).default(6),
        codexHome: z.string().optional(),
        claudeHome: z.string().optional(),
        geminiHome: z.string().optional()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await findRelevantSessions(input);
      return {
        content: [{ type: "text", text: asText(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "anyfork_import_session",
    {
      title: "Import AnyFork Session",
      description: "Bridge a known source session into the target platform for the current project. By default this seeds target-native resume data without launching the target CLI.",
      inputSchema: {
        from: platformEnum.describe("Source platform where the session currently exists."),
        to: platformEnum.describe("Target platform to import into."),
        sessionId: z.string().min(1).describe("Source session id to import."),
        cwd: z.string().describe("Current project directory where imported context should belong."),
        prompt: z.string().optional().describe("Optional extra instruction appended to the handoff."),
        maxMessages: z.number().int().min(1).max(500).optional().describe("Optional transcript cap before building the bridge bundle."),
        dryRun: z.boolean().default(false).describe("When true, only export bridge artifacts and do not seed the target-native session."),
        codexHome: z.string().optional(),
        claudeHome: z.string().optional(),
        geminiHome: z.string().optional()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await importSession(input);
      return {
        content: [{ type: "text", text: asText(output) }],
        structuredContent: output
      };
    }
  );

  server.registerTool(
    "anyfork_find_and_import",
    {
      title: "Find And Import AnyFork Session",
      description: "Find the most relevant local session for a user request, then import the top match into the current project. Use when the exact session id is unknown.",
      inputSchema: {
        query: z.string().min(2).describe("Task, bug, or feature description used to find the best matching session."),
        to: platformEnum.describe("Target platform to import into for the current project."),
        cwd: z.string().describe("Current project directory where imported context should belong."),
        platforms: optionalPlatformsSchema(),
        onlyCurrentCwd: z.boolean().default(false),
        limit: z.number().int().min(1).max(10).default(5),
        limitPerPlatform: z.number().int().min(1).max(100).default(25),
        previewCandidates: z.number().int().min(1).max(20).default(8),
        previewMessages: z.number().int().min(1).max(20).default(6),
        prompt: z.string().optional(),
        maxMessages: z.number().int().min(1).max(500).optional(),
        dryRun: z.boolean().default(false),
        codexHome: z.string().optional(),
        claudeHome: z.string().optional(),
        geminiHome: z.string().optional()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input) => {
      const output = await findAndImportSession(input);
      return {
        content: [{ type: "text", text: asText(output) }],
        structuredContent: output
      };
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFilePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
