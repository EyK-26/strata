# Uploads and images

Keep upload actions in controllers and their authorization in the route/request
boundary. Storage is an injected capability; applications do not need a media
repository, a global disk facade or a new base controller.

## Store a file without buffering it

```ts
import { parseMultipartUploadStream } from "@getstrata/core/http/parseMultipartUpload";
import { requireStreamingStorage } from "@getstrata/core/storage/storage";

// Run authentication, CSRF (for browser sessions), authorization and tenant checks first.
const upload = await parseMultipartUploadStream(request, "document", {
  maxBytes: 20 * 1024 * 1024,
  allowUnknownMime: false,
});
const storage = requireStreamingStorage(dependencies.storage);
const path = await upload.store(storage, "documents");
// Save path + upload.fileName + upload.mimeType with the authorized application record.
```

`UploadedFile` provides `fileName`, `mimeType`, `stream()`, `bytes()`, `store()` and
`discard()`. A file can be consumed only once. `stream()` transfers ownership to
the caller, who must consume or cancel it. `bytes()` deliberately buffers the
bounded file for operations that need its entire contents. Call `discard()` if
an accepted upload is no longer needed.

`store()` creates a random key under the supplied relative directory. It does not
use the client filename as a storage path or overwrite a caller-selected key.
It waits for complete file and multipart validation before reporting success.
If transfer or validation fails, it cancels the source and deletes its partial
object. If deletion also fails, an `AggregateError` contains both failures; the
application must arrange cleanup. The storage implementation must honor the
streaming contract and consume the stream before resolving its write.

Keys have no filename extension. Keep the returned MIME type and sanitized display
name in your application record; use an explicit safe Content-Type and
Content-Disposition when serving a download. Do not expose the object until the
store operation succeeds. Authorization and record creation remain application
responsibilities; storage and SQL writes are not a distributed transaction.

The parser reads incrementally from the native request body with downstream
backpressure. It does not call `request.formData()` or collect the full file.
There is no background drain while an application holds an unconsumed file.
Retained framing data is bounded by headers/boundary lookahead plus the upstream
chunk; an upstream producer may itself provide a large chunk.

This is deliberately a **single-file multipart contract**: one file in the named
field, with optional text fields before/after it. Extra files, duplicate files,
malformed/truncated framing, transfer-encoded parts and nonempty epilogues reject.
Text fields are discarded, not returned as validated form input. Limits are:

- The configured file-byte limit (5 MiB by default).
- At most 32 parts and 16 KiB of headers per part.
- 64 KiB of discarded field data; total request bytes may not exceed the file
  limit plus 64 KiB for framing, headers and fields together.
- A boundary no longer than 70 characters.

Validation can fail during consumption, including in fields after the file.
Obtaining an `UploadedFile` is not proof that all content has passed validation.
For multiple uploads, use separate requests; this helper is not a general MIME
message parser. The HTTP server/middleware body limit must also permit the intended
upload size plus framing. This helper does not loosen that outer limit.

`parseMultipartUpload()` remains the buffered convenience API and returns
`{ fileName, mimeType, size, contents }`. It now consumes the same bounded parser.
`validateUploadFile()` validates an existing native `File`, including byte-content
classification, and intentionally buffers it.

## Content validation

Both upload paths check supported JPEG, PNG, GIF, WebP, PDF and ZIP signatures
against the declared MIME type. Plain text, CSV and JSON must be valid UTF-8 text
without binary control characters. UTF-8 sequences can cross stream chunks.
Unknown binary content requires the existing explicit `allowUnknownMime` opt-in.

These checks classify bytes; they do not establish document safety, validate an
entire PDF/archive, parse JSON/CSV semantics, detect polyglots or scan malware.
Apply domain validation after upload. Images passed through the transform API
also undergo native image decoding and input-format verification.

Compared with the older helpers, mislabeled binary content and invalid text now
reject. Use correct MIME declarations and real file bytes in tests. Existing
multipart callers that sent multiple files must select the single-file contract
or keep their own explicit multi-file handling.

## Transform an image with Bun

```ts
import { transformImageContents } from "@getstrata/core/media/imageTransform";

const image = await transformImageContents(await upload.bytes(), {
  contentType: upload.mimeType,
  width: 800,
  height: 600,
  fit: "inside",
  format: "webp",
  quality: 80,
});
const key = `thumbnails/${crypto.randomUUID()}.webp`;
await dependencies.storage.put(key, image.body);
// image.contentType, image.width and image.height describe the output.
```

This is an alternative consumption of `upload`; it cannot follow `upload.store()`
on the same object. The example uses the caller's already authorized storage
capability. The transform is independent of HTTP, storage and database code, so
it can also run inside an application job with explicitly supplied input.

`transformImageContents(contents, options)` uses `Bun.Image` directly:

- Width-only or height-only resizing preserves aspect ratio. With both dimensions,
  `inside` fits within the box and `fill` stretches to it. `fill` does not crop.
- Enlargement is disabled by default; opt in with `withoutEnlargement: false`.
- JPEG, PNG and WebP output are supported. `quality` is an integer from 1 to 100
  for JPEG/WebP; PNG is lossless and rejects a quality option.
- Output defaults to the detected input format; GIF becomes a first-frame JPEG.
  Animation preservation is not provided.
- `contentType`, when supplied, asserts the actual input format. `format` selects
  output independently. Invalid/unsupported data rejects through the native decoder.
- Encoded input/output are limited to 8 MiB, decoded input to 16,777,216 pixels,
  and requested/computed output dimensions to 4096 per edge. Native decode limits
  apply before pixel decoding. Caller-provided input bytes are snapshotted.

The existing `resizeImageContents(contents, width, mimeType)` remains available:
its third argument selects output format and its width-only resize permits
enlargement, as before. Prefer the options API for new application code.

Crop, watermark, animation and format support beyond Bun's supported operations
are not emulated. There is no additional image library or external service.
Transforms intentionally decode bounded images in memory; concurrent workloads
still need application-level scheduling. No production S3 qualification or
end-to-end throughput/memory performance claim is implied by the contract tests.
