import { BadRequestError, PayloadTooLargeError } from '@getstrata/core/errors/http';

import { parseMultipartUploadStream } from './streamingUpload';
import { assertUploadContentType, uploadTextDecoder, validateUploadText } from './uploadContent';
import { DEFAULT_UPLOAD_POLICY, isAllowedMimeType, type UploadPolicy } from './uploads';

function normalizeMimeType(mimeType: string): string {
	return mimeType.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
}

interface ParsedUpload {
	fileName: string;
	mimeType: string;
	size: number;
	contents: Uint8Array;
}

function sanitizeUploadFileName(name: string): string {
	const base = name.split(/[/\\]/).pop()?.trim() ?? 'upload';

	const sanitized = base.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 200);

	return sanitized.length > 0 ? sanitized : 'upload';
}

async function validateUploadFile(
	file: File,
	fieldName = 'file',
	policy: UploadPolicy = DEFAULT_UPLOAD_POLICY,
): Promise<ParsedUpload> {
	if (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes <= 0) {
		throw new RangeError('Upload limit must be a positive safe integer.');
	}

	if (typeof policy.allowUnknownMime !== 'boolean') {
		throw new TypeError('Upload allowUnknownMime must be a boolean.');
	}

	if (!(file instanceof File)) {
		throw new BadRequestError(`Missing upload field "${fieldName}".`);
	}

	if (file.size <= 0) {
		throw new BadRequestError('Uploaded file is empty.');
	}

	const maxBytes = policy.maxBytes;

	if (file.size > maxBytes) {
		throw new PayloadTooLargeError(`Upload exceeds the ${maxBytes} byte limit.`);
	}

	const mimeType = normalizeMimeType(file.type.trim() || 'application/octet-stream');

	if (!isAllowedMimeType(mimeType, policy.allowUnknownMime)) {
		throw new BadRequestError(`File type "${mimeType}" is not allowed.`);
	}

	const contents = new Uint8Array(await file.arrayBuffer());

	assertUploadContentType(contents.subarray(0, 12), mimeType);
	const decoder = uploadTextDecoder(mimeType);

	validateUploadText(decoder, contents);
	validateUploadText(decoder);

	return {
		fileName: sanitizeUploadFileName(file.name),
		mimeType,
		size: file.size,
		contents,
	};
}

async function parseMultipartUpload(
	request: Request,
	fieldName = 'file',
	policy: UploadPolicy = DEFAULT_UPLOAD_POLICY,
): Promise<ParsedUpload> {
	const file = await parseMultipartUploadStream(request, fieldName, policy);

	const contents = await file.bytes();

	return { fileName: file.fileName, mimeType: file.mimeType, size: contents.byteLength, contents };
}

export { parseMultipartUploadStream, UploadedFile } from './streamingUpload';
export type { ParsedUpload };
export { parseMultipartUpload, sanitizeUploadFileName, validateUploadFile };
