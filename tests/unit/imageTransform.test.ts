import { describe, expect, test } from 'bun:test';

import {
	type ImageTransformOptions,
	isImageMimeType,
	parseThumbnailWidth,
	resizeImageContents,
	transformImageContents,
} from '@getstrata/core/media/imageTransform';

const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

describe('imageTransform', () => {
	test('isImageMimeType recognizes supported image types', () => {
		expect(isImageMimeType('image/png')).toBe(true);
		expect(isImageMimeType('image/jpeg; charset=binary')).toBe(true);
		expect(isImageMimeType('text/plain')).toBe(false);
	});

	test('parseThumbnailWidth clamps and defaults', () => {
		expect(parseThumbnailWidth(undefined)).toBe(200);
		expect(parseThumbnailWidth('abc')).toBe(200);
		expect(parseThumbnailWidth('12')).toBe(16);
		expect(parseThumbnailWidth('9999')).toBe(800);
		expect(parseThumbnailWidth('320')).toBe(320);
	});

	test('resizeImageContents returns png bytes for png input', async () => {
		const source = decodeBase64(PNG_BASE64);

		const result = await resizeImageContents(source, 64, 'image/png');

		expect(result.contentType).toBe('image/png');
		expect(result.body.byteLength).toBeGreaterThan(0);
	});

	test('resizeImageContents returns webp bytes for webp input', async () => {
		const source = decodeBase64(PNG_BASE64);

		const webpSource = await new Bun.Image(source).webp().bytes();

		const result = await resizeImageContents(webpSource, 64, 'image/webp');

		expect(result.contentType).toBe('image/webp');
		expect(result.body.byteLength).toBeGreaterThan(0);
	});

	test('resizeImageContents rejects oversized payloads', async () => {
		const huge = new Uint8Array(8 * 1024 * 1024 + 1);

		await expect(resizeImageContents(huge, 64, 'image/png')).rejects.toThrow(
			'maximum allowed size',
		);
	});

	test('resizeImageContents rejects images with too many pixels', async () => {
		const source = decodeBase64(PNG_BASE64);

		const inflated = await new Bun.Image(source).resize(4097, 4097).jpeg().bytes();

		expect(inflated.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
		await expect(resizeImageContents(inflated, 64, 'image/jpeg')).rejects.toThrow(
			'maximum allowed dimensions',
		);
	});

	test('resizeImageContents returns jpeg bytes for other image types', async () => {
		const source = decodeBase64(PNG_BASE64);

		const result = await resizeImageContents(source, 64, 'image/jpeg');

		expect(result.contentType).toBe('image/jpeg');
		expect(result.body.byteLength).toBeGreaterThan(0);
	});
});

function bitmap(width: number, height: number, noise = false): Uint8Array {
	const stride = Math.ceil((width * 3) / 4) * 4;

	const body = new Uint8Array(54 + stride * height);

	const header = new DataView(body.buffer);

	body.set([0x42, 0x4d]);
	header.setUint32(2, body.byteLength, true);
	header.setUint32(10, 54, true);
	header.setUint32(14, 40, true);
	header.setInt32(18, width, true);
	header.setInt32(22, height, true);
	header.setUint16(26, 1, true);
	header.setUint16(28, 24, true);
	header.setUint32(34, stride * height, true);
	let state = 123456789;

	for (let index = 54; index < body.length; index++) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		body[index] = noise ? state & 255 : 120;
	}

	return body;
}

async function rectangle(): Promise<Uint8Array> {
	return new Bun.Image(decodeBase64(PNG_BASE64)).resize(80, 40).png().bytes();
}

describe('native image transforms', () => {
	test('defaults preserve format, aspect ratio, and small images without upscaling', async () => {
		const input = await rectangle();

		const unchanged = await transformImageContents(input);

		expect(unchanged).toMatchObject({ width: 80, height: 40, contentType: 'image/png' });
		const small = await transformImageContents(input, { width: 160, height: 160 });

		expect(small).toMatchObject({ width: 80, height: 40 });
		expect(await new Bun.Image(small.body).metadata()).toEqual({
			width: 80,
			height: 40,
			format: 'png',
		});
		const thumbnail = await transformImageContents(input, { width: 20, height: 20 });

		expect(thumbnail).toMatchObject({ width: 20, height: 10 });
	});

	test('supports width or height, explicit stretching, and opt-in enlargement', async () => {
		const input = await rectangle();

		expect(await transformImageContents(input, { width: 20 })).toMatchObject({
			width: 20,
			height: 10,
		});
		expect(await transformImageContents(input, { height: 10 })).toMatchObject({
			width: 20,
			height: 10,
		});
		const stretched = await transformImageContents(input, { width: 20, height: 20, fit: 'fill' });

		expect(stretched).toMatchObject({ width: 20, height: 20 });
		const enlarged = await transformImageContents(input, { width: 160, withoutEnlargement: false });

		expect(enlarged).toMatchObject({ width: 160, height: 80 });
		const legacy = await resizeImageContents(decodeBase64(PNG_BASE64), 64, 'image/png');

		expect(await new Bun.Image(legacy.body).metadata()).toMatchObject({ width: 64, height: 64 });
	});

	test('encodes jpeg/webp with explicit quality and verifies declared input MIME', async () => {
		const input = await rectangle();

		for (const format of ['jpeg', 'webp'] as const) {
			const result = await transformImageContents(input, {
				format,
				quality: 73,
				contentType: ' IMAGE/PNG; charset=binary ',
			});

			expect(result.contentType).toBe(`image/${format}`);
			expect(await new Bun.Image(result.body).metadata()).toEqual({
				width: 80,
				height: 40,
				format,
			});
		}

		const jpeg = await new Bun.Image(input).jpeg().bytes();

		expect((await transformImageContents(jpeg)).contentType).toBe('image/jpeg');
		const webp = await new Bun.Image(input).webp().bytes();

		expect((await transformImageContents(webp)).contentType).toBe('image/webp');
		await expect(transformImageContents(input, { contentType: 'image/jpeg' })).rejects.toThrow(
			'does not match',
		);
		await expect(transformImageContents(input, { quality: 80 })).rejects.toThrow(
			'only for jpeg and webp',
		);
		// The legacy MIME argument remains an output selector, so transcoding PNG to JPEG still works.
		expect((await resizeImageContents(input, 20, 'image/jpeg')).contentType).toBe('image/jpeg');
	});

	test("decodes GIF's first frame into a portable output format", async () => {
		const gif = decodeBase64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

		const result = await transformImageContents(gif, { contentType: 'image/gif' });

		expect(result).toMatchObject({ width: 1, height: 1, contentType: 'image/jpeg' });
		expect(await new Bun.Image(result.body).metadata()).toMatchObject({ format: 'jpeg' });
	});

	test('rejects empty, oversized, unrecognized, corrupt, and unsupported image contents', async () => {
		await expect(transformImageContents(new Uint8Array())).rejects.toThrow('nonempty Uint8Array');
		await expect(transformImageContents('image' as unknown as Uint8Array)).rejects.toThrow(
			'nonempty Uint8Array',
		);
		await expect(transformImageContents(new Uint8Array(8 * 1024 * 1024 + 1))).rejects.toThrow(
			'maximum allowed size',
		);
		await expect(transformImageContents(new TextEncoder().encode('not an image'))).rejects.toThrow(
			'Invalid or unsupported image contents',
		);
		await expect(transformImageContents(decodeBase64(PNG_BASE64).slice(0, 24))).rejects.toThrow(
			'Invalid or unsupported image contents',
		);
		const bmp = bitmap(1, 1);

		expect((await new Bun.Image(bmp).metadata()).format).toBe('bmp');
		await expect(transformImageContents(bmp)).rejects.toThrow('Unsupported image input format');
	});

	test('rejects invalid runtime options before native work', async () => {
		const input = decodeBase64(PNG_BASE64);

		for (const options of [
			null,
			[],
			new Date(),
			{ width: 0 },
			{ width: 4097 },
			{ height: -1 },
			{ width: 1.5 },
			{ height: Number.NaN },
			{ width: Number.POSITIVE_INFINITY },
			{ fit: 'cover' },
			{ format: 'gif' },
			{ quality: 0 },
			{ quality: 101 },
			{ quality: 50.5 },
			{ withoutEnlargement: 'true' },
			{ contentType: 'text/plain' },
			{ contentType: 42 },
			{ crop: true },
			{ [Symbol('unsupported')]: true },
			{
				get width() {
					throw new Error('metadata getter must not execute');
				},
			},
		]) {
			await expect(
				transformImageContents(input, options as unknown as ImageTransformOptions),
			).rejects.toThrow(TypeError);
		}
	});

	test('bounds derived output dimensions and native pre-decode pixel work', async () => {
		const wide = await new Bun.Image(decodeBase64(PNG_BASE64)).resize(5000, 1).png().bytes();

		await expect(transformImageContents(wide)).rejects.toThrow('dimensions');
		await expect(transformImageContents(wide, { height: 2 })).rejects.toThrow('dimensions');
		const thin = await new Bun.Image(decodeBase64(PNG_BASE64)).resize(1, 5000).png().bytes();

		await expect(transformImageContents(thin, { width: 2 })).rejects.toThrow('dimensions');
		const header = decodeBase64(PNG_BASE64);

		new DataView(header.buffer).setUint32(16, 100000);
		new DataView(header.buffer).setUint32(20, 100000);
		await expect(transformImageContents(header, { width: 1 })).rejects.toThrow(
			'maximum allowed dimensions',
		);
	});

	test('rejects encoded output larger than the hard byte limit', async () => {
		const input = await new Bun.Image(bitmap(2048, 1536, true)).jpeg({ quality: 95 }).bytes();

		expect(input.byteLength).toBeLessThan(8 * 1024 * 1024);
		await expect(transformImageContents(input, { format: 'png' })).rejects.toThrow(
			'Image output exceeds the maximum allowed size',
		);
	});
});
