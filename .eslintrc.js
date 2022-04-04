module.exports = {
	'env': {
		'node': true,
	},
	'extends': [
		'eslint:recommended',
		'plugin:@typescript-eslint/eslint-recommended',
		'plugin:@typescript-eslint/recommended'
	],
	'parser': '@typescript-eslint/parser',
	'parserOptions': {
		'ecmaVersion': 'latest',
		'sourceType': 'module'
	},
	'plugins': [
		'@typescript-eslint'
	],
	'rules': {
		// only for special libraries, normally you should remove this rule and configure indent by editor or editorconfig
		'indent': [
			'error',
			'tab',
		],
		'linebreak-style': [
			'error',
			'unix'
		],
		'quotes': [
			'error',
			'single'
		],
		'semi': [
			'error',
			'never'
		],
		'no-unused-vars': 'off',
		'no-prototype-builtins': 'off',
		'@typescript-eslint/no-unused-vars': ['error', { 'args': 'none' }],
		'@typescript-eslint/ban-ts-comment': 'off',
		'@typescript-eslint/no-empty-function': 'off',
		'@typescript-eslint/no-explicit-any': ['warn', { 'ignoreRestArgs': true }]
	}
}
