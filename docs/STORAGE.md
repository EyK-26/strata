# Storage

Application dependencies and `CORE_STORAGE_TOKEN` expose the structural `Storage`
consumer interface (`put`, `get`, `delete`). Custom adapters need no manager internals.
Missing reads return `null`; deletion is idempotent; other failures reject.

Native local and Bun S3 drivers also implement `StreamingStorage`. Narrow the consumer
when a transfer needs streams:

```ts
import { requireStreamingStorage } from "@getstrata/core/storage/storage";

const storage = requireStreamingStorage(context.dependencies.storage);
await storage.writeStream("reports/export.csv", exportStream);
const download = await storage.readStream("reports/export.csv");
// Consume download, or cancel it if it is no longer needed.
```

`writeStream` accepts a single-use `ReadableStream<Uint8Array>` or a `Blob`, including
a Bun file. Local writes use `Bun.write`; S3 stream writes await the native multipart
writer for each chunk. `readStream` returns a byte stream, or `null` for a missing
object. It primes one chunk to classify native missing errors without buffering the
whole object. Further errors reject the reader; cancelling the returned stream
cancels the native source. Upload sink failures cancel the input stream.

A legacy buffered adapter still works with `StorageManager`. Requesting its streaming
capability throws when its driver does not implement both stream methods. Streams
carry no HTTP response behavior or headers. Failed writes may leave partial local
files; overwrite atomicity and concurrent-reader isolation are not promised. Native
S3 multipart buffering and limits follow the installed Bun runtime. The focused
contract tests do not qualify production S3 providers or establish throughput or
memory benchmarks.
