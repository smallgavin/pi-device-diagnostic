import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDiagnosticSession, DiagnosticRunError, type Mode } from "./agent.js";
import { CASE_IDS, loadCase } from "./simulator.js";

type Session = Awaited<ReturnType<typeof createDiagnosticSession>>;
type StoredSession = { caseId: string; mode: Mode; session: Session; busy: boolean };

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
} as const;

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "请使用 JSON 请求");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16_384) throw new HttpError(413, "问题太长");
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid shape");
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "请求 JSON 无效"); }
}

function liveConfig() {
  const provider = process.env.PI_PROVIDER ?? "openai";
  const keyName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
  return { provider, model: process.env.PI_MODEL ?? (provider === "deepseek" ? "deepseek-flash" : "gpt-5-mini"),
    available: (provider === "deepseek" || provider === "openai") && Boolean(process.env[keyName]) };
}

/** Browser requests can only select fixed mock cases and the existing read-only Pi session. */
export function createWebServer() {
  const sessions = new Map<string, StoredSession>();
  return createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    try {
      if (req.method === "GET" && pathname === "/api/config") {
        json(res, 200, { live: liveConfig(), maxQuestionLength: 500 });
        return;
      }
      if (req.method === "GET" && pathname === "/api/cases") {
        const cases = await Promise.all(CASE_IDS.map(async (id, index) => {
          const item = await loadCase(id);
          return { id, number: index + 1, prompt: item.prompt, device: item.device,
            first: item.metrics.samples[0], latest: item.metrics.samples.at(-1),
            latencySeries: item.metrics.samples.map((sample) => sample.inferenceP95Ms) };
        }));
        json(res, 200, { cases });
        return;
      }
      if (req.method === "POST" && pathname === "/api/diagnose") {
        const origin = req.headers.origin;
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new HttpError(403, "仅允许本机页面访问");
        const body = await readJson(req);
        const caseId = body.caseId;
        const mode = body.mode;
        const question = typeof body.question === "string" ? body.question.trim() : "";
        const requestedSessionId = body.sessionId;
        if (typeof caseId !== "string" || !CASE_IDS.some((id) => id === caseId)) throw new HttpError(400, "未知模拟案例");
        if (mode !== "offline" && mode !== "live") throw new HttpError(400, "未知运行模式");
        if (!question || question.length > 500) throw new HttpError(400, "请输入 1–500 字的问题");
        if (requestedSessionId !== undefined && typeof requestedSessionId !== "string") throw new HttpError(400, "会话 ID 无效");
        if (mode === "live" && !liveConfig().available) throw new HttpError(400, "当前服务未配置模型密钥，请使用离线演示或设置环境变量后重启");

        let entry = requestedSessionId ? sessions.get(requestedSessionId) : undefined;
        if (requestedSessionId && !entry) throw new HttpError(404, "会话已失效，请开始新会话");
        if (entry && (entry.caseId !== caseId || entry.mode !== mode)) throw new HttpError(409, "案例或模式已变化，请开始新会话");
        if (entry?.busy) throw new HttpError(409, "这段会话正在诊断中");
        if (!entry) {
          const mock = await loadCase(caseId);
          const session = await createDiagnosticSession(mock, mode);
          entry = { caseId, mode, session, busy: false };
          // Sessions exist only in this process. Bound the map without adding persistent storage.
          if (sessions.size >= 24) sessions.delete(sessions.keys().next().value!);
          sessions.set(session.sessionId, entry);
        }
        entry.busy = true;
        try {
          const result = await entry.session.ask(question);
          json(res, 200, { result });
        } catch (error) {
          // A failed Pi turn should not be reused for a follow-up question.
          sessions.delete(entry.session.sessionId);
          if (error instanceof DiagnosticRunError) {
            json(res, 502, { error: "模型诊断未完成，请重试", trace: error.trace });
          } else {
            json(res, 500, { error: "诊断未完成，请重试" });
          }
        } finally { entry.busy = false; }
        return;
      }
      if (req.method === "GET" && pathname in staticFiles) {
        const [name, contentType] = staticFiles[pathname as keyof typeof staticFiles];
        const data = await readFile(join(process.cwd(), "public", name));
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(data);
        return;
      }
      throw new HttpError(404, "页面不存在");
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else json(res, 500, { error: "服务暂时不可用" });
    }
  });
}
