type Receipt = { cursor: string; version: string };

export function caseActivityVersion(cursor: string, comments: { id: string; created_at: string }[], exchanges: { id: string; created_at: string }[]) {
  const cutoff = Date.parse(cursor);
  const ids = (rows: { id: string; created_at: string }[]) => rows
    .filter(row => Date.parse(row.created_at) < cutoff)
    .map(row => row.id).sort().join(",");
  return `${ids(comments)}|${ids(exchanges)}`;
}

export function createCaseReadReceipt(options: {
  send: (cursor: string) => Promise<unknown>;
  onError: () => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let pending: Receipt | null = null;
  let acknowledgedVersion: string | null = null;
  let running = false;
  let disposed = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush() {
    if (disposed || running || timer !== undefined || !pending) return;
    const receipt = pending;
    running = true;
    try {
      await options.send(receipt.cursor);
      if (disposed) return;
      acknowledgedVersion = receipt.version;
      if (pending === receipt) pending = null;
      failures = 0;
    } catch {
      if (disposed) return;
      failures += 1;
      if (failures < 3) {
        timer = schedule(() => {
          timer = undefined;
          void flush();
        }, failures * 1500);
      } else {
        options.onError();
      }
    } finally {
      running = false;
    }
    if (!disposed && failures === 0 && pending) void flush();
  }

  return {
    loaded(cursor: string, version: string) {
      if (disposed || !Number.isFinite(Date.parse(cursor)) || version === acknowledgedVersion) return;
      if (!pending || Date.parse(cursor) >= Date.parse(pending.cursor)) pending = { cursor, version };
      if (!running && timer === undefined) failures = 0;
      void flush();
    },
    dispose() {
      disposed = true;
      pending = null;
      if (timer !== undefined) cancel(timer);
    },
  };
}
