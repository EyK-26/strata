# @getstrata/core changelog

## 3.1.4

- Synchronize package versions and dependency pins at 3.1.4 for the corrected starter release validation. No additional runtime changes in this package.

## 3.1.3

- Coordinate package versions at 3.1.3; core runtime behavior is unchanged.

## 3.1.2

- Clarify the npm description around Laravel-inspired Bun and TypeScript application development. Synchronize packages at 3.1.2.

## 3.1.1

- Synchronize the package version for the 3.1.1 application-agent guide release and update public documentation.

## 3.1.0

- Simplify public documentation and consumer guides.
- Add bounded streaming multipart uploads and a single-use `UploadedFile` with explicit storage, cancellation and partial-write cleanup. The buffered helper uses the same bounded parser; both paths validate supported binary signatures and UTF-8 text. Multipart helpers now reject extra files and malformed framing; see docs/MEDIA.md for adoption details.
- Add native Bun image transforms with typed size/fit/format/quality options, input-format verification and decode/output limits. Preserve the existing resize helper's output selection and enlargement behavior.
- Add class-based model authoring with one typed field declaration, inferred record types, instance relationship methods and application-owned default repositories. Preserve low-level definition APIs and explicit session/transaction selection.
- Add typed class relationship results, model-targeted effects and immutable table metadata access without global connection state. Keep neutral definition factories independent of the ORM implementation.

### Adoption

Existing low-level model definitions remain supported. New class models must be registered in the application's model list; package installation does not rewrite app files. Upload helpers now accept one file and validate declared content types against supported signatures/UTF-8 text. Read [upload limits and migration guidance](https://github.com/EyK-26/strata/blob/main/docs/MEDIA.md) before adopting stricter validation.

## 3.0.8

Synchronize packages and correct installed starter template discovery. Both generator entrypoints include their selected templates in published packages.
