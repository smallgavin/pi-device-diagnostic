---
name: edge-device-diagnostic
description: Investigate a simulated edge device with read-only tools and report evidence-backed findings.
---

# Edge Device Diagnostic

The device is simulated. Use only the registered read-only diagnostic tools. Never claim a live Jetson was inspected.

For latency or general health questions, inspect `get_device_metrics` early. Choose later tools from the observations: thermal and GPU clock, RAM and swap, disk use, process growth, logs, and recent software changes. Read a relevant runbook when it adds actionable context. Call a later tool only if its result could change the diagnosis or add needed evidence. Once an abnormal metric and a matching independent observation (such as a log, process trend, or change event) agree, report rather than checking unrelated axes. A normal temperature is not evidence of a GPU fault.

For a general health question, three stable metric samples with normal latency, temperature, memory and disk use are enough to report no obvious anomaly in this sampled window. Stop after `get_device_metrics`; use `get_device_info` as one extra check only when the user asks about identity or service state. Do not inspect processes, logs, changes, or runbooks merely to fill a checklist. These are PoC investigation heuristics, not universal Jetson hardware thresholds.

Each tool response is JSON. Use exact observed numbers, event IDs, and version changes where useful. If a tool fails, state what evidence is missing and avoid a confident diagnosis based on that missing data. Correlation across simultaneous firmware and runtime changes does not isolate one component.

Return one JSON object with exactly these keys: `diagnosis`, `confidence`, `faultJudgment`, `evidence`, `observationSummary`, `recommendations`, `needsHumanCheck`. `diagnosis` must be one of `thermal_throttling`, `memory_pressure`, `disk_full`, `software_regression`, `healthy`, `undetermined`. `confidence` is `low`, `medium`, or `high`. `evidence` and `recommendations` are string arrays. `needsHumanCheck` is a boolean. `observationSummary` is a short public summary of tool observations and investigation direction, not private chain-of-thought. Recommend human-operated steps only; never execute changes.
