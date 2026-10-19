import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import { test } from "node:test";
import { createWebServer } from "../src/web-server.js";

test("local UI serves assets and keeps follow-up diagnosis in one Pi session", async () => {
  const server = createWebServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /设备故障诊断/);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);

    const casesResponse = await fetch(`${base}/api/cases`);
    const cases = await casesResponse.json() as { cases: { id: string; latencySeries: number[] }[] };
    assert.equal(cases.cases.length, 5);
    assert.equal(cases.cases.find((item) => item.id === "thermal")?.latencySeries.length, 3);

    const diagnose = (body: unknown) => fetch(`${base}/api/diagnose`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const firstResponse = await diagnose({ caseId: "healthy", mode: "offline", question: "检查当前健康状态" });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as { result: { sessionId: string; report: { diagnosis: string }; trace: unknown[]; toolCalls: number } };
    assert.equal(first.result.report.diagnosis, "healthy");
    assert.equal(first.result.toolCalls, 1);
    assert.equal(first.result.trace.length, 1);

    const followUpResponse = await diagnose({ caseId: "healthy", mode: "offline", question: "再看一次指标", sessionId: first.result.sessionId });
    assert.equal(followUpResponse.status, 200);
    const followUp = await followUpResponse.json() as typeof first;
    assert.equal(followUp.result.sessionId, first.result.sessionId);
    assert.equal(followUp.result.toolCalls, 1);

    assert.equal((await diagnose({ caseId: "../../secret", mode: "offline", question: "test" })).status, 400);
    assert.equal((await fetch(`${base}/src/agent.ts`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
