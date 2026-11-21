import { expect, test } from 'bun:test';

import { buildSmtpPayload } from '../../src/core/mail/smtpMessage';

test('ASCII mailbox display names retain quoted words and escape embedded quotes', () => {
	const payload = buildSmtpPayload('Example "Team" <from@example.test>', {
		to: 'to@example.test',
		subject: 'Subject',
		body: 'Body',
	});

	expect(payload).toContain('From: "Example \\"Team\\"" <from@example.test>\r\n');
	expect(payload).toContain('Body\r\n.\r\n');
});

test('an angle-bracket mailbox without a display name emits the bare address', () => {
	const payload = buildSmtpPayload('<from@example.test>', {
		to: '<to@example.test>',
		subject: 'Subject',
		body: 'Body',
	});

	expect(payload).toContain('From: from@example.test\r\n');
	expect(payload).toContain('To: to@example.test\r\n');
});
