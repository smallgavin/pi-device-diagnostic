const CASE_COPY = {
  thermal: { title: "推理延迟升高", subtitle: "LATENCY SPIKE", mark: "01" },
  memory: { title: "内存持续增长", subtitle: "RESOURCE PRESSURE", mark: "02" },
  disk: { title: "写入出现异常", subtitle: "STORAGE ALERT", mark: "03" },
  regression: { title: "更新后变慢", subtitle: "AFTER UPDATE", mark: "04" },
  healthy: { title: "日常健康检查", subtitle: "BASELINE CHECK", mark: "05" },
};
const DIAGNOSIS_COPY = {
  thermal_throttling: "高温降频", memory_pressure: "内存压力 / OOM", disk_full: "磁盘空间不足",
  software_regression: "软件或固件变更相关", healthy: "未发现明显异常", undetermined: "暂无法确定原因",
};
const TOOL_COPY = {
  get_device_info: "读取设备信息", get_device_metrics: "读取遥测指标", get_top_processes: "查看进程",
  search_device_logs: "检索设备日志", get_change_history: "查看变更记录", get_device_runbook: "查询排障手册",
};
const $ = (id) => document.getElementById(id);
const state = { cases: [], selected: "thermal", mode: "offline", live: null, sessionId: null, busy: false };

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function setText(id, value) { $(id).textContent = String(value); }
function clear(node) { node.replaceChildren(); }
function selectedCase() { return state.cases.find((item) => item.id === state.selected); }

async function getJson(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { throw new Error("服务返回了无法解析的响应"); }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.trace = data.trace;
    throw error;
  }
  return data;
}

function renderCases() {
  const container = $("case-list");
  clear(container);
  for (const item of state.cases) {
    const copy = CASE_COPY[item.id];
    const button = el("button", `case-item${item.id === state.selected ? " active" : ""}`);
    button.type = "button";
    button.setAttribute("aria-current", item.id === state.selected ? "true" : "false");
    button.append(el("span", "case-number", copy.mark));
    const words = el("span", "case-words");
    words.append(el("b", "", copy.title), el("small", "", copy.subtitle));
    button.append(words, el("span", "case-chevron", "↗"));
    button.addEventListener("click", () => {
      if (state.busy || item.id === state.selected) return;
      state.selected = item.id;
      resetSession();
      setText("question", item.prompt);
      updateCount();
      renderCases();
      renderDevice();
    });
    container.append(button);
  }
}

function renderDevice() {
  const item = selectedCase();
  if (!item) return;
  setText("breadcrumb-case", `CASE ${String(item.number).padStart(2, "0")}`);
  setText("device-id", item.device.deviceId.toUpperCase());
  setText("device-model", item.device.model);
  setText("device-version", `L4T ${item.device.l4tVersion} · FW ${item.device.firmwareVersion}`);
  setText("device-power", `POWER ${item.device.powerMode}`);
  setText("metric-latency", `${item.latest.inferenceP95Ms} ms`);
  setText("metric-latency-foot", `起点 ${item.first.inferenceP95Ms} ms`);
  setText("metric-temp", `${item.latest.gpuTemperatureC} °C`);
  setText("metric-memory", `${Math.round(item.latest.memoryUsedMb / item.latest.memoryTotalMb * 100)}%`);
  setText("metric-memory-foot", `${item.latest.memoryUsedMb} / ${item.latest.memoryTotalMb} MB`);
  setText("metric-disk", `${item.latest.diskUsedPct}%`);
  setText("metric-disk-foot", `剩余 ${item.latest.diskFreeGb} GB`);
  setText("trend-range", `${item.first.inferenceP95Ms} → ${item.latest.inferenceP95Ms} MS`);
  const bars = $("trend-bars");
  clear(bars);
  const values = item.latencySeries;
  const max = Math.max(...values, 100);
  for (const [index, value] of values.entries()) {
    const bar = el("div", `trend-bar${index === values.length - 1 ? " last" : ""}`);
    bar.style.height = `${Math.max(12, value / max * 100)}%`;
    bar.title = `${value} ms`;
    bars.append(bar);
  }
}

function renderMode() {
  const available = Boolean(state.live?.available);
  if (!available && state.mode === "live") state.mode = "offline";
  $("mode-live").disabled = !available;
  $("mode-offline").classList.toggle("selected", state.mode === "offline");
  $("mode-live").classList.toggle("selected", state.mode === "live");
  setText("live-model-name", available ? `${state.live.provider} · ${state.live.model}` : "启动时配置模型密钥");
  setText("mode-help", available ? "模型已就绪" : "实时模式暂不可用");
  setText("connection-text", available ? "MODEL READY" : "LOCAL SERVER");
}

function setMode(mode) {
  if (state.busy || (mode === "live" && !state.live?.available) || mode === state.mode) return;
  state.mode = mode;
  resetSession();
  renderMode();
}

function updateCount() { setText("char-count", `${$("question").value.length} / 500`); }
function setBusy(busy) {
  state.busy = busy;
  $("run-button").disabled = busy;
  $("reset-button").disabled = busy;
  $("mode-offline").disabled = busy;
  $("mode-live").disabled = busy || !state.live?.available;
  $("question").disabled = busy;
  setText("run-button", busy ? "诊断进行中…" : state.sessionId ? "继续追问 ↗" : "运行诊断 ↗");
  if (busy) $("result-empty").hidden = true;
  $("result-loading").hidden = !busy;
  if (busy) {
    $("result-content").hidden = true;
    $("result-error").hidden = true;
    setText("result-status", "INVESTIGATING");
  }
}

function resetSession() {
  if (state.busy) return;
  state.sessionId = null;
  $("result-empty").hidden = false;
  $("result-loading").hidden = true;
  $("result-content").hidden = true;
  $("result-error").hidden = true;
  $("trace-empty").hidden = false;
  $("trace-list").hidden = true;
  clear($("trace-list"));
  setText("result-status", "WAITING");
  setText("tool-count", "0 CALLS");
  setText("run-button", "运行诊断 ↗");
}

function renderTrace(trace) {
  const list = $("trace-list");
  clear(list);
  setText("tool-count", `${trace.length} ${trace.length === 1 ? "CALL" : "CALLS"}`);
  $("trace-empty").hidden = trace.length > 0;
  list.hidden = trace.length === 0;
  trace.forEach((step, index) => {
    const row = el("li", "trace-step");
    row.append(el("span", "trace-index", String(index + 1).padStart(2, "0")));
    const body = el("div", "trace-body");
    const heading = el("div", "trace-heading");
    heading.append(el("b", "", TOOL_COPY[step.tool] || step.tool), el("code", "", step.tool));
    body.append(heading, el("p", "", step.observationSummary));
    if (step.args && Object.keys(step.args).length) body.append(el("small", "trace-args", `ARGS  ${JSON.stringify(step.args)}`));
    row.append(body, el("span", `trace-state ${step.status === "ok" ? "ok" : "error"}`, step.status === "ok" ? "OK" : "ERROR"));
    list.append(row);
  });
}

function renderList(id, values) {
  const list = $(id);
  clear(list);
  for (const value of values) list.append(el("li", "", value));
}

function renderResult(result) {
  state.sessionId = result.sessionId;
  const report = result.report;
  const healthy = report.diagnosis === "healthy";
  const verdict = $("result-content").querySelector(".verdict");
  verdict.classList.toggle("healthy", healthy);
  setText("diagnosis-title", DIAGNOSIS_COPY[report.diagnosis] || report.diagnosis);
  setText("fault-judgment", report.faultJudgment);
  setText("confidence", `${({ high: "HIGH", medium: "MEDIUM", low: "LOW" })[report.confidence]} CONFIDENCE`);
  setText("human-check", report.needsHumanCheck ? "需要人工进一步检查" : "无需立即人工介入");
  setText("session-short", `SESSION ${result.sessionId.slice(0, 8)}`);
  setText("evidence-count", String(report.evidence.length).padStart(2, "0"));
  setText("observation-summary", report.observationSummary);
  renderList("evidence-list", report.evidence);
  renderList("recommendation-list", report.recommendations);
  renderTrace(result.trace);
  $("result-empty").hidden = true;
  $("result-loading").hidden = true;
  $("result-error").hidden = true;
  $("result-content").hidden = false;
  setText("result-status", "COMPLETE");
}

async function diagnose() {
  if (state.busy) return;
  const question = $("question").value.trim();
  if (!question) { $("question").focus(); return; }
  setBusy(true);
  renderTrace([]);
  try {
    const { result } = await getJson("/api/diagnose", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: state.selected, mode: state.mode, question, ...(state.sessionId ? { sessionId: state.sessionId } : {}) }),
    });
    renderResult(result);
  } catch (error) {
    state.sessionId = null;
    $("result-empty").hidden = true;
    $("result-loading").hidden = true;
    $("result-content").hidden = true;
    $("result-error").hidden = false;
    setText("result-status", "ERROR");
    setText("error-text", error.message || "请稍后重试");
    renderTrace(Array.isArray(error.trace) ? error.trace : []);
  } finally { setBusy(false); }
}

async function start() {
  $("run-button").addEventListener("click", diagnose);
  $("reset-button").addEventListener("click", resetSession);
  $("mode-offline").addEventListener("click", () => setMode("offline"));
  $("mode-live").addEventListener("click", () => setMode("live"));
  $("question").addEventListener("input", updateCount);
  $("question").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); diagnose(); }
  });
  try {
    const [config, cases] = await Promise.all([getJson("/api/config"), getJson("/api/cases")]);
    state.live = config.live;
    state.cases = cases.cases;
    state.mode = state.live.available ? "live" : "offline";
    setText("question", selectedCase().prompt);
    updateCount();
    renderCases();
    renderDevice();
    renderMode();
  } catch (error) {
    setText("connection-text", "SERVER UNAVAILABLE");
    setText("mode-help", "连接失败");
    setText("result-status", "ERROR");
    $("result-empty").hidden = true;
    $("result-error").hidden = false;
    setText("error-text", error.message || "无法连接到本地服务");
    $("run-button").disabled = true;
  }
}
start();
