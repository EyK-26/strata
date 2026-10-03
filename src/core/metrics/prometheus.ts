interface MetricLabels {
  method: string;
  path: string;
  status: string;
}

const HTTP_DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

type DurationHistogram = {
  cumulative: number[];
  sum: number;
  count: number;
};

function emptyHistogram(): DurationHistogram {
  return {
    cumulative: HTTP_DURATION_BUCKETS_MS.map(() => 0),
    sum: 0,
    count: 0,
  };
}

class PrometheusRegistry {
  private readonly httpRequestsTotal = new Map<string, number>();
  private readonly httpRequestDurationMs = new Map<string, DurationHistogram>();

  incrementHttpRequest(labels: MetricLabels): void {
    const key = this.metricKey(labels);
    this.httpRequestsTotal.set(key, (this.httpRequestsTotal.get(key) ?? 0) + 1);
  }

  observeHttpDuration(labels: MetricLabels, durationMs: number): void {
    const key = this.metricKey(labels);
    const histogram = this.httpRequestDurationMs.get(key) ?? emptyHistogram();
    histogram.count += 1;
    histogram.sum += durationMs;

    for (let index = 0; index < HTTP_DURATION_BUCKETS_MS.length; index += 1) {
      const bound = HTTP_DURATION_BUCKETS_MS[index];
      if (bound !== undefined && durationMs <= bound) {
        const count = histogram.cumulative[index] ?? 0;
        histogram.cumulative[index] = count + 1;
      }
    }

    this.httpRequestDurationMs.set(key, histogram);
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
      "# HELP http_request_duration_ms HTTP request duration in milliseconds.",
      "# TYPE http_request_duration_ms histogram",
    );

    for (const [key, histogram] of this.httpRequestDurationMs) {
      for (let index = 0; index < HTTP_DURATION_BUCKETS_MS.length; index += 1) {
        const bound = HTTP_DURATION_BUCKETS_MS[index];
        lines.push(
          `http_request_duration_ms_bucket{${key},le="${bound}"} ${histogram.cumulative[index] ?? 0}`,
        );
      }
      lines.push(`http_request_duration_ms_bucket{${key},le="+Inf"} ${histogram.count}`);
      lines.push(`http_request_duration_ms_sum{${key}} ${histogram.sum}`);
      lines.push(`http_request_duration_ms_count{${key}} ${histogram.count}`);
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
export { HTTP_DURATION_BUCKETS_MS, PrometheusRegistry, prometheusRegistry };
