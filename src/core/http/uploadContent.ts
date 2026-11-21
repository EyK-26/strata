import { BadRequestError } from '@getstrata/core/errors/http';

function normalizeMimeType(mimeType: string): string {
	return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Check supported binary signatures. This is type classification, not a malware scan. */
function assertUploadContentType(prefix: Uint8Array, mimeType: string): void {
	const mime = normalizeMimeType(mimeType);

	const starts = (...bytes: number[]) => bytes.every((byte, index) => prefix[index] === byte);

	const ascii = (offset: number, text: string) =>
		[...text].every((char, index) => prefix[offset + index] === char.charCodeAt(0));

	let valid = true;

	switch (mime) {
		case 'image/jpeg':
			valid = starts(0xff, 0xd8, 0xff);
			break;
		case 'image/png':
			valid = starts(137, 80, 78, 71, 13, 10, 26, 10);
			break;
		case 'image/gif':
			valid = ascii(0, 'GIF87a') || ascii(0, 'GIF89a');
			break;
		case 'image/webp':
			valid = ascii(0, 'RIFF') && ascii(8, 'WEBP');
			break;
		case 'application/pdf':
			valid = ascii(0, '%PDF-');
			break;
		case 'application/zip':
		case 'application/x-zip-compressed':
			valid = starts(80, 75, 3, 4) || starts(80, 75, 5, 6) || starts(80, 75, 7, 8);
			break;
	}

	if (!valid) {
		throw new BadRequestError('Uploaded content does not match its declared type.');
	}
}

/** A separate decoder per file preserves UTF-8 sequences split across chunks. */
function uploadTextDecoder(mimeType: string): TextDecoder | undefined {
	return ['text/plain', 'text/csv', 'application/json'].includes(normalizeMimeType(mimeType))
		? new TextDecoder('utf-8', { fatal: true })
		: undefined;
}

function validateUploadText(decoder: TextDecoder | undefined, bytes?: Uint8Array): void {
	if (!decoder) {
		return;
	}

	try {
		const text = decoder.decode(bytes, { stream: bytes !== undefined });

		for (let index = 0; index < text.length; index++) {
			const code = text.charCodeAt(index);

			if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
				throw new Error('Binary text');
			}
		}
	} catch {
		throw new BadRequestError('Uploaded text must contain valid UTF-8 text.');
	}
}

export { assertUploadContentType, uploadTextDecoder, validateUploadText };
