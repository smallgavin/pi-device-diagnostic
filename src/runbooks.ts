export const runbooks = {
  thermal: {
    title: "Thermal investigation",
    checks: ["Compare temperature, GPU utilization, GPU clock and latency across samples.", "Correlate any thermal throttling log with the same period.", "Check the leading process before attributing heat to a workload."],
    recommendations: ["Ask an operator to inspect airflow, heatsink, fan and ambient temperature.", "Repeat the same inference benchmark after temperatures normalize."],
  },
  memory: {
    title: "Memory pressure investigation",
    checks: ["Compare RAM and swap trend with latency.", "Identify the process with the largest memory usage and growth.", "Look for OOM or memory pressure logs."],
    recommendations: ["Ask an operator to inspect the growing process and workload settings.", "Preserve logs and compare memory use under a repeatable workload."],
  },
  storage: {
    title: "Storage investigation",
    checks: ["Compare free space and utilization trend.", "Search logs for write failures or large log files.", "Separate storage symptoms from normal GPU metrics."],
    recommendations: ["Ask an operator to inspect log retention and free space.", "Plan controlled cleanup outside this read-only agent."],
  },
  regression: {
    title: "Version regression investigation",
    checks: ["Check that thermal, memory and storage do not explain latency.", "Compare latency baseline with change history and logs.", "Treat simultaneous firmware and runtime updates as ambiguous until isolated."],
    recommendations: ["Ask an operator to compare the same benchmark on prior and current versions.", "Review release notes and isolate one change at a time in a test environment."],
  },
  healthy: {
    title: "Healthy baseline",
    checks: ["Confirm latency and resource metrics are stable over the sampled window.", "Stop when no meaningful anomaly is observed."],
    recommendations: ["Continue normal monitoring and retain a baseline for later comparison."],
  },
} as const;
export type RunbookTopic = keyof typeof runbooks;
