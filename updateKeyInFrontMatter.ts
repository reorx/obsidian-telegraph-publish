/*
From: https://github.com/beaussan/update-time-on-edit-obsidian/blob/main/src/updateKeyInFrontMatter.ts
MIT License

Copyright (c) 2021 beaussan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
*/
export const updateKeyInFrontMatter = (
	content: string,
	key: string,
	newValue: string,
) => {
	if (!content.match(new RegExp(/^---[\s\S]*---\n.*/g))) {
		return `---
${key}: ${newValue}
---
${content}`
	}
	const [start, maybeFrontMatter, ...rest] = content.split(new RegExp(/---\n/))

	const oldMatterSplitted = maybeFrontMatter
		.split('\n')
		.map((item) => item.split(/: /, 2))

	const maybeKeyIndex = oldMatterSplitted.findIndex(
		(it) => it[0] === key && it.length === 2,
	)
	// console.log(maybeKeyIndex, oldMatterSplitted);
	if (maybeKeyIndex >= 0) {
		oldMatterSplitted[maybeKeyIndex][1] = newValue
		// console.log(maybeKeyIndex, oldMatterSplitted);
	} else {
		oldMatterSplitted.pop()
		oldMatterSplitted.push([key, newValue])
		oldMatterSplitted.push([''])
	}
	const newMatter = oldMatterSplitted
		.map((item) => {
			// console.log('New value : ', s);
			return item.join(': ')
		})
		.join('\n')

	return [start, newMatter, ...rest].join('---\n')
}
