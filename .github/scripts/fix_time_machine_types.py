from pathlib import Path

p=Path('prototype/vanilla/history.ts')
s=p.read_text()
old="""export type HistoryBindings = {
  HISTORY_DB?: D1Database;
  HISTORY_BUCKET?: R2Bucket;
};
"""
new="""type HistoryD1Statement = {
  bind: (...values: unknown[]) => HistoryD1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};

type HistoryD1Database = {
  prepare: (query: string) => HistoryD1Statement;
};

type HistoryR2Object = {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata: (headers: Headers) => void;
};

type HistoryR2Bucket = {
  put: (key: string, value: ArrayBuffer, options?: unknown) => Promise<unknown>;
  get: (key: string, options?: unknown) => Promise<HistoryR2Object | null>;
  delete: (keys: string | string[]) => Promise<void>;
};

export type HistoryBindings = {
  HISTORY_DB?: HistoryD1Database;
  HISTORY_BUCKET?: HistoryR2Bucket;
};
"""
if old in s:s=s.replace(old,new,1)
p.write_text(s)

p=Path('prototype/vanilla/worker.ts')
s=p.read_text()
s=s.replace('async scheduled(controller: ScheduledController, env: Env & HistoryBindings, ctx: ExecutionContext): Promise<void> {','async scheduled(controller: { scheduledTime: number }, env: Env & HistoryBindings, ctx: { waitUntil(promise: Promise<void>): void }): Promise<void> {',1)
p.write_text(s)
