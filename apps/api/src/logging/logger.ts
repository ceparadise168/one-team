export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  tenantId?: string;
  action?: string;
  latencyMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Logger {
  debug(action: string, metadata?: Record<string, unknown>): void;
  info(action: string, metadata?: Record<string, unknown>): void;
  warn(action: string, metadata?: Record<string, unknown>): void;
  error(action: string, error?: unknown, metadata?: Record<string, unknown>): void;
  child(fields: Partial<Pick<LogEntry, 'tenantId' | 'requestId'>>): Logger;
}

export class JsonLogger implements Logger {
  constructor(
    private readonly fields: Partial<Pick<LogEntry, 'tenantId' | 'requestId'>> = {},
    private readonly now: () => Date = () => new Date()
  ) {}

  debug(action: string, metadata?: Record<string, unknown>): void {
    this.write('DEBUG', action, undefined, metadata);
  }

  info(action: string, metadata?: Record<string, unknown>): void {
    this.write('INFO', action, undefined, metadata);
  }

  warn(action: string, metadata?: Record<string, unknown>): void {
    this.write('WARN', action, undefined, metadata);
  }

  error(action: string, error?: unknown, metadata?: Record<string, unknown>): void {
    this.write('ERROR', action, error, metadata);
  }

  child(fields: Partial<Pick<LogEntry, 'tenantId' | 'requestId'>>): Logger {
    return new JsonLogger({ ...this.fields, ...fields }, this.now);
  }

  private write(level: LogLevel, action: string, error?: unknown, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: this.now().toISOString(),
      level,
      ...this.fields,
      action,
      ...(metadata ? { metadata } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
    };

    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}

export class InMemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  constructor(
    private readonly fields: Partial<Pick<LogEntry, 'tenantId' | 'requestId'>> = {},
    private readonly now: () => Date = () => new Date()
  ) {}

  debug(action: string, metadata?: Record<string, unknown>): void {
    this.record('DEBUG', action, undefined, metadata);
  }

  info(action: string, metadata?: Record<string, unknown>): void {
    this.record('INFO', action, undefined, metadata);
  }

  warn(action: string, metadata?: Record<string, unknown>): void {
    this.record('WARN', action, undefined, metadata);
  }

  error(action: string, error?: unknown, metadata?: Record<string, unknown>): void {
    this.record('ERROR', action, error, metadata);
  }

  child(fields: Partial<Pick<LogEntry, 'tenantId' | 'requestId'>>): Logger {
    const child = new InMemoryLogger({ ...this.fields, ...fields }, this.now);
    child.entries.push(...[]); // child gets its own entries array
    // Share entries array with parent for test observability
    Object.defineProperty(child, 'entries', { value: this.entries });
    return child;
  }

  private record(level: LogLevel, action: string, error?: unknown, metadata?: Record<string, unknown>): void {
    this.entries.push({
      timestamp: this.now().toISOString(),
      level,
      ...this.fields,
      action,
      ...(metadata ? { metadata } : {}),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
    });
  }
}
