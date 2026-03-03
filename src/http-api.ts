import http, { type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";
import { log } from "./logger.js";
import { handleSetCredentials } from "./tools/set-credentials.js";
import { handleSetSchedule } from "./tools/set-schedule.js";
import { handleAddCategory } from "./tools/add-category.js";
import { handleListCategories } from "./tools/list-categories.js";
import { handleConfigureThread } from "./tools/configure-thread.js";
import { handleRemoveThread } from "./tools/remove-thread.js";
import { handleListThreads } from "./tools/list-threads.js";
import { handleSendNow } from "./tools/send-now.js";
import { handleGetStatus } from "./tools/get-status.js";
import type { ToolResult } from "./types.js";

const DEFAULT_PORT = 8787;

interface JsonResponse {
  status: number;
  body: unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body, null, 2));
}

function toolToJson(result: ToolResult): JsonResponse {
  const text = result.content[0]?.text ?? "{}";
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (result.isError) {
    return {
      status: 400,
      body:
        typeof parsed === "object" && parsed !== null
          ? parsed
          : { error: true, message: "Unknown error" },
    };
  }

  return { status: 200, body: parsed };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const bodyText = Buffer.concat(chunks).toString("utf-8").trim();
  if (!bodyText) return {};

  const parsed = JSON.parse(bodyText) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function badRequest(message: string): JsonResponse {
  return { status: 400, body: { error: true, message } };
}

async function route(req: IncomingMessage, url: URL): Promise<JsonResponse> {
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return { status: 200, body: { ok: true, service: "instagram-bot-api" } };
  }

  if (method === "GET" && path === "/api/status") {
    return toolToJson(await handleGetStatus());
  }

  if (method === "GET" && path === "/api/categories") {
    return toolToJson(await handleListCategories());
  }

  if (method === "POST" && path === "/api/categories") {
    const body = await readJsonBody(req);
    const name = String(body.name ?? "");
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description
        : undefined;

    if (!Array.isArray(body.hashtags)) {
      return badRequest("hashtags must be an array of strings.");
    }

    const hashtags = body.hashtags.map((item) => String(item));
    return toolToJson(await handleAddCategory({ name, hashtags, description }));
  }

  if (method === "GET" && path === "/api/threads") {
    return toolToJson(await handleListThreads());
  }

  if (method === "POST" && path === "/api/threads") {
    const body = await readJsonBody(req);

    if (!Array.isArray(body.categories)) {
      return badRequest("categories must be an array of strings.");
    }

    const categories = body.categories.map((item) => String(item));
    const dailyLimit = Number(body.dailyLimit ?? 0);
    const enabled =
      typeof body.enabled === "boolean" ? body.enabled : undefined;

    return toolToJson(
      await handleConfigureThread({
        threadId: String(body.threadId ?? ""),
        threadName: String(body.threadName ?? ""),
        categories,
        dailyLimit,
        enabled,
      })
    );
  }

  if (method === "DELETE" && path.startsWith("/api/threads/")) {
    const threadId = decodeURIComponent(path.replace("/api/threads/", "")).trim();
    return toolToJson(await handleRemoveThread({ threadId }));
  }

  if (method === "POST" && path === "/api/credentials") {
    const body = await readJsonBody(req);
    return toolToJson(
      await handleSetCredentials({
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
      })
    );
  }

  if (method === "POST" && path === "/api/schedule") {
    const body = await readJsonBody(req);
    return toolToJson(
      await handleSetSchedule({
        cronExpression: String(body.cronExpression ?? ""),
      })
    );
  }

  if (method === "POST" && path === "/api/send-now") {
    const body = await readJsonBody(req);
    const threadId =
      typeof body.threadId === "string" && body.threadId.trim()
        ? body.threadId
        : undefined;
    const reelUrl =
      typeof body.reelUrl === "string" && body.reelUrl.trim()
        ? body.reelUrl
        : undefined;
    return toolToJson(await handleSendNow({ threadId, reelUrl }));
  }

  return { status: 404, body: { error: true, message: "Not found" } };
}

export function startHttpApi(): void {
  const port = Number(process.env.INSTAGRAM_BOT_API_PORT ?? DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    try {
      const host = req.headers.host ?? `localhost:${port}`;
      const url = new URL(req.url ?? "/", `http://${host}`);
      const response = await route(req, url);
      sendJson(res, response.status, response.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: true, message });
    }
  });

  server.listen(port, () => {
    log(`http-api: listening on http://localhost:${port}`);
  });
}
