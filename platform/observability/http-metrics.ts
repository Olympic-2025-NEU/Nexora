// SPDX-License-Identifier: AGPL-3.0-only
/** In-process HTTP counters for Prometheus text exposition (demo, single instance). */

const buckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
const counts = new Map<string, number>();
const durations: number[] = [];
const MAX_SAMPLES = 2_000;

function key(method: string, route: string, statusClass: string) {
  return `${method}|${route}|${statusClass}`;
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  seconds: number;
}) {
  const route = input.route.slice(0, 120);
  const statusClass = `${Math.floor(input.status / 100)}xx`;
  const k = key(input.method, route, statusClass);
  counts.set(k, (counts.get(k) ?? 0) + 1);
  durations.push(input.seconds);
  if (durations.length > MAX_SAMPLES) durations.splice(0, durations.length - MAX_SAMPLES);
}

export function httpMetricsText(): string {
  const lines: string[] = [
    "# TYPE http_requests_total counter",
    "# TYPE http_request_duration_seconds_bucket histogram",
    "# TYPE http_request_duration_seconds_sum summary",
    "# TYPE http_request_duration_seconds_count summary",
  ];
  for (const [k, total] of counts) {
    const [method, route, status] = k.split("|");
    lines.push(
      `http_requests_total{method="${method}",route="${route}",status="${status}"} ${total}`,
    );
  }
  const sorted = [...durations].sort((a, b) => a - b);
  let cumulative = 0;
  for (const le of buckets) {
    while (cumulative < sorted.length && sorted[cumulative]! <= le) cumulative += 1;
    lines.push(`http_request_duration_seconds_bucket{le="${le}"} ${cumulative}`);
  }
  lines.push(`http_request_duration_seconds_bucket{le="+Inf"} ${sorted.length}`);
  const sum = sorted.reduce((a, b) => a + b, 0);
  lines.push(`http_request_duration_seconds_sum ${sum}`);
  lines.push(`http_request_duration_seconds_count ${sorted.length}`);
  if (sorted.length) {
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    lines.push(`# TYPE http_request_duration_seconds_p95 gauge`);
    lines.push(`http_request_duration_seconds_p95 ${p95}`);
  }
  return `${lines.join("\n")}\n`;
}
