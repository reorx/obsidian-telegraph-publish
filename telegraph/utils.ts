import { ContentNode, NodeElement } from './types'

const availableAttrs = ['href', 'src']
// From https://telegra.ph/api#NodeElement:
const availableTags = [
	'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure', 'h3', 'h4', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p', 'pre', 's', 'strong', 'u', 'ul', 'video',
	// additional tags
	'table',
]
const availableInlineTags = [
	'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em',
	'i', 's', 'strong', 'u',
]

const elementToNodeElement = (el: HTMLElement): [NodeElement | null, string] => {
	const tag = el.tagName.toLowerCase()
	const nodeElement: NodeElement = {
		tag,
	}

	// convert tag
	switch (nodeElement.tag) {
		case 'h1':
		case 'h2':
			nodeElement.tag = 'h3'
			break
		case 'h3':
			nodeElement.tag = 'h4'
			break
		case 'h4':
		case 'h5':
		case 'h6':
			nodeElement.tag = 'p'
			break
	}

	// classname
	// TODO 'internal-link'

	// only return new node whose tag is in availableTags
	if (availableTags.indexOf(nodeElement.tag) === -1) {
		return [null, tag]
	}

	// set attributes
	const attrs: { [key: string]: string } = {}
	for (let attr of el.attributes) {
		if (availableAttrs.indexOf(attr.name) > -1) {
			attrs[attr.name] = attr.value
		}
	}
	if (Object.keys(attrs).length > 0) {
		nodeElement.attrs = attrs
	}

	return [nodeElement, tag]
}

function trimLineBreak(s: string): string {
	return s.replace(/^\n+|\n+$/g, '')
}

export function elementToContentNodes(el: HTMLElement | Text, unwrapBlock: boolean|null = null, parentTag: string | null = null): Array<ContentNode> {
	if (el instanceof Text) {
		const text = el.data
		if (text.trim().length === 0) {
			return []
		}
		if (parentTag === 'h4' || parentTag === 'h5') {
			return [{
				tag: 'strong',
				children: [text],
			}]
		}
		return [trimLineBreak(text)]
	}
	// drop non HTMLElement node
	if (!(el instanceof HTMLElement)) {
		// console.log('not instance of HTMLElement', el)
		return []
	}
	// drop special classes
	if (el.hasClass('frontmatter'))
		return []
	if (el.hasClass('frontmatter-container'))
		return []

	const [nodeElement, tag] = elementToNodeElement(el)
	let shouldUnwrap = !nodeElement
	if (nodeElement) {
		const isBlock = availableInlineTags.indexOf(nodeElement.tag) === -1
		if (isBlock && unwrapBlock) {
			shouldUnwrap = true
		}
	}
	if (shouldUnwrap) {
		// unwrap the current element
		// console.log('unwrap', el)
		const nodes = []
		for (let childEl of el.childNodes) {
			nodes.push(...elementToContentNodes(childEl as HTMLElement | Text, unwrapBlock, parentTag))
		}
		return nodes
	}

	// handle special tags
	switch (nodeElement.tag) {
		case 'li':
			// because telegraph does not support nested list, all block elements in <li> should be unwrapped
			unwrapBlock = true
			break
		case 'pre':
			nodeElement.children = [(el.children[0] as HTMLElement).innerText.trim()]
			return [nodeElement]
		case 'table':
			nodeElement.tag = 'pre'
			console.log('table content', el, el.innerText, [el.innerText])
			nodeElement.children = [el.outerText.trim()]
			return [nodeElement]
		case 'br':
			// ignore <br> in li, it will cause new list item to be created
			if (parentTag === 'li')
				return []
	}

	// add children
	// console.log('node', el, nodeElement)
	const children: Array<ContentNode> = []
	for (let childEl of el.childNodes) {
		children.push(...elementToContentNodes(childEl as HTMLElement | Text, unwrapBlock, tag))
	}

	// handle special tags for children
	switch (tag) {
		case 'h4':
		case 'h5':
		case 'h6':
			for (let i = 0; i < children.length; i++) {
				const child = children[i]
				if (isString(child)) {
					nodeElement.children[i] = {
						tag: 'strong',
						children: [child],
					}
				}
			}
			break
		case 'li':
			// add LF for continuous text child
			for (let i = 0; i < children.length; i++) {
				const child = children[i]
				let next: ContentNode
				if (i + 1 < children.length)
					next = children[i + 1]
				if (isString(child) && next && isString(next) && child[child.length - 1] !== '\n') {
					children[i] = child + '\n'
				}
			}
	}
	// console.log(el.tagName, 'childNodes', el.childNodes)
	// console.log(el.tagName, 'children', children)
	if (children.length > 0)
		nodeElement.children = children
	return [nodeElement]
}

const isString = (node: ContentNode): node is string => {
	return typeof node === 'string'
}
