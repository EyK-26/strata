type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

class Logger {
  constructor(private readonly channel = "app") {}

  private write(level: LogLevel, message: string, context: LogContext = {}): void {
    const entry = {
      level,
      channel: this.channel,
      message,
      timestamp: new Date().toISOString(),
      ...context,
    };

    const line = JSON.stringify(entry);

    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }
}

const appLogger = new Logger("app");

export { Logger, appLogger };
export type { LogContext, LogLevel };
