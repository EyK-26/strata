interface MetricLabels {
  method: string;
  path: string;
  status: string;
}

class PrometheusRegistry {
  private readonly httpRequestsTotal = new Map<string, number>();
  private readonly httpRequestDurationMs = new Map<string, number[]>();

  incrementHttpRequest(labels: MetricLabels): void {
    const key = this.metricKey(labels);
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) ?? 0) + 1);
  }

  observeHttpDuration(labels: MetricLabels, durationMs: number): void {
    const key = this.metricKey(labels);
    const samples = this.httpRequestDurationMs.get(key) ?? [];
    samples.push(durationMs);
    this.httpRequestDurationMs.set(key, samples);
  }

  renderMetrics(): string {
    const lines: string[] = [
      "# HELP http_requests_total Total HTTP requests processed.",
      "# TYPE http_requests_total counter",
    ];

    for (const [key, value] of this.httpRequestsTotal) {
      lines.push(`http_requests_total{${key}} ${value}`);
    }

    lines.push(
      "# HELP http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.",
      "# TYPE http_request_duration_ms_sum counter",
    );

    for (const [key, samples] of this.httpRequestDurationMs) {
      const sum = samples.reduce((total, sample) => total + sample, 0);
      lines.push(`http_request_duration_ms_sum{${key}} ${sum}`);
    }

    return `${lines.join("\n")}\n`;
  }

  resetForTests(): void {
    this.httpRequestsTotal.clear();
    this.httpRequestDurationMs.clear();
  }

  getHttpRequestSummary(): {
    totalRequests: number;
    byStatus: Record<string, number>;
    topPaths: Array<{ method: string; path: string; count: number }>;
  } {
    const byStatus: Record<string, number> = {};
    const pathCounts = new Map<string, { method: string; path: string; count: number }>();
    let totalRequests = 0;

    for (const [key, count] of this.httpRequestsTotal) {
      totalRequests += count;

      const method = key.match(/method="([^"]+)"/)?.[1] ?? "GET";
      const path = key.match(/path="([^"]+)"/)?.[1] ?? "/";
      const status = key.match(/status="([^"]+)"/)?.[1] ?? "200";

      byStatus[status] = (byStatus[status] ?? 0) + count;

      const pathKey = `${method} ${path}`;
      const existing = pathCounts.get(pathKey);

      if (existing) {
        existing.count += count;
      } else {
        pathCounts.set(pathKey, { method, path, count });
      }
    }

    const topPaths = Array.from(pathCounts.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 10);

    return {
      totalRequests,
      byStatus,
      topPaths,
    };
  }

  private metricKey(labels: MetricLabels): string {
    return `method="${labels.method}",path="${labels.path}",status="${labels.status}"`;
  }
}

const prometheusRegistry = new PrometheusRegistry();

export type { MetricLabels };
export { PrometheusRegistry, prometheusRegistry };
