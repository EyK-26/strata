import { fileURLToPath } from 'node:url';

import stylistic from '@stylistic/eslint-plugin';
import * as oxcParser from 'eslint-parser-oxc';
import { globalIgnores, includeIgnoreFile } from 'eslint/config';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

const declarations = [
	'const',
	'let',
	'var',
	'using',
	'function',
	'class',
	'type',
	'interface',
	'enum',
	{ selector: 'ExportNamedDeclaration[declaration]' },
	{ selector: 'ExportDefaultDeclaration[declaration.type=/Declaration$/]' },
];

export default [
	includeIgnoreFile(gitignorePath, { gitignoreResolution: true }),
	globalIgnores([
		'**/docs/openapi.json',
		'**/sdk/typescript/client.ts',
		'**/htmx.min.js',
		'packages/*/templates/',
		'templates/',
		'tests/fixtures/',
	]),
	{
		files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
		languageOptions: { parser: oxcParser },
		plugins: { '@stylistic': stylistic },
		rules: {
			curly: 'error',
			'@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
			'@stylistic/curly-newline': [
				'error',
				{
					consistent: true,
					IfStatementConsequent: { minElements: 1, consistent: true },
					IfStatementAlternative: { minElements: 1, consistent: true },
					ForStatement: { minElements: 1, consistent: true },
					ForInStatement: { minElements: 1, consistent: true },
					ForOfStatement: { minElements: 1, consistent: true },
				},
			],
			'@stylistic/padding-line-between-statements': [
				'error',
				{ blankLine: 'always', prev: 'import', next: '*' },
				{ blankLine: 'any', prev: 'import', next: 'import' },
				{ blankLine: 'always', prev: declarations, next: '*' },
				{ blankLine: 'always', prev: 'function', next: '*' },
				{ blankLine: 'always', prev: ['for', 'while', 'do'], next: '*' },
				{ blankLine: 'always', prev: '*', next: 'if' },
				{ blankLine: 'always', prev: 'if', next: '*' },
				{ blankLine: 'always', prev: '*', next: 'return' },
			],
		},
	},
];
