import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					vars: 'all',
					args: 'after-used',
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'no-console': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-explicit-any': 'warn',
			semi: ['error', 'always'],
			quotes: ['error', 'single', { avoidEscape: true }],
			indent: ['error', 'tab'],
			'no-trailing-spaces': 'error',
			'eol-last': ['error', 'always'],
		},
	},
	{
		ignores: ['dist/**', 'node_modules/**', '**/*.js'],
	},
);
