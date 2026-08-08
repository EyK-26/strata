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

  private metricKey(labels: MetricLabels): string {
    return `method="${labels.method}",path="${labels.path}",status="${labels.status}"`;
  }
}

const prometheusRegistry = new PrometheusRegistry();

export type { MetricLabels };
export { PrometheusRegistry, prometheusRegistry };
