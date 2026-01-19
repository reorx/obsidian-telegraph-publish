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

	// only return new node whose tag is in availableTags
	if (availableTags.indexOf(nodeElement.tag) === -1) {
		return [null, tag]
	}

	// set attributes
	const attrs: { [key: string]: string } = {}
	for (const attr of el.attributes) {
		if (availableAttrs.indexOf(attr.name) > -1) {
			attrs[attr.name] = attr.value
		}
	}
	if (Object.keys(attrs).length > 0) {
		nodeElement.attrs = attrs
	}
	
	// ensure <img> has a real src ---
	if (nodeElement.tag === 'img') {
	  const src = el.getAttribute('src') || (el as HTMLImageElement).src
	  if (src && src.length > 0) {
		nodeElement.attrs = nodeElement.attrs ?? {}
		nodeElement.attrs.src = src
	  }
	}


	return [nodeElement, tag]
}

function trimLineBreak(s: string): string {
	return s.replace(/^\n+|\n+$/g, '')
}

export function elementToContentNodes(el: HTMLElement | Text, unwrapBlock: boolean|null = null, parentTag: string | null = null): Array<ContentNode> {
	  // --- CONVERT QUOTES ---
	  // > [!quote] 
	  // > Text.
	  // will convert into <aside>Text.</aside> on telegraph
	  if (el instanceof HTMLElement) {
		const tag = el.tagName.toLowerCase()

		// Obsidian callout:
		// <div class="callout" data-callout="quote"> ... <div class="callout-content">...</div> </div>
		if (tag === 'div' && el.classList.contains('callout') && el.getAttribute('data-callout') === 'quote') {
		  const contentEl = el.querySelector(':scope > .callout-content') as HTMLElement | null

		  // If no content wrapper found, fallback to unwrapping children
		  if (!contentEl) {
			const nodes: Array<ContentNode> = []
			for (const child of el.childNodes) {
			  nodes.push(...elementToContentNodes(child as any, true, parentTag))
			}
			return nodes
		  }

		  const children: Array<ContentNode> = []
		  // unwrapBlock=true so that <p> inside callout-content does not become a nested paragraph,
		  // and we get clean inline content inside <aside>.
		  for (const child of contentEl.childNodes) {
			children.push(...elementToContentNodes(child as any, true, null))
		  }

		  return [{
			tag: 'aside',
			children,
		  }]
		}
	  }
	
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
	
	// --- CONVERT IMAGE + ITALIC CAPTION INSIDE SAME <p> INTO <figure><figcaption> ---
	// Rebuilding figure; taking next *itallic text* (if there are no empty line before it) as figure caption.
	if (el.tagName.toLowerCase() === 'p') {
	  const childNodes = Array.from(el.childNodes)

	  // Берем первый IMG и первый EM (важно: в этом же <p>)
	  const imgEl = el.querySelector(':scope > img') as HTMLElement | null
	  const emEl = el.querySelector(':scope > em') as HTMLElement | null

	  if (imgEl && emEl) {
		// Проверим, что кроме IMG/BR/EM нет ничего значимого (кроме пробелов)
		const meaningful = childNodes.filter((n) => {
		  if (n.nodeType === Node.TEXT_NODE) {
			return (n.textContent ?? '').trim().length > 0
		  }
		  if (n.nodeType === Node.ELEMENT_NODE) {
			const t = (n as HTMLElement).tagName.toLowerCase()
			return t !== 'img' && t !== 'br' && t !== 'em'
		  }
		  return true
		})

		if (meaningful.length === 0) {
		  const src =
			  (imgEl as HTMLImageElement).getAttribute('src') ||
			  (imgEl as HTMLImageElement).src

			const imgNodes: Array<ContentNode> = src
			  ? [{ tag: 'img', attrs: { src } }]
			  : []

		  const captionChildren: Array<ContentNode> = []

		  // Возьмем содержимое <em> (сохраняет, например, внутренние ссылки/strong и т.п.)
		  for (const c of Array.from(emEl.childNodes)) {
			captionChildren.push(...elementToContentNodes(c as any, true, null))
		  }

		  // Если подпись оказалась пустой — не мешаем обычному рендеру
		  if (captionChildren.length > 0) {
			return [{
			  tag: 'figure',
			  children: [
				...imgNodes,
				{
				  tag: 'figcaption',
				  children: captionChildren,
				},
			  ],
			}]
		  }
		}
	  }
	}


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
		for (const childEl of el.childNodes) {
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
		nodeElement.children = [el.outerText.trim()]
		return [nodeElement]
	case 'br':
		// ignore <br> in li, it will cause new list item to be created
		if (parentTag === 'li')
			return []
		break
	case 'a':
		// Internal links NOW are rewritten upstream (in main.ts) before we get here.
		// Do not clobber href for <a class="internal-link">.
		
		// Old logic (handle internal links):
		// if (el.hasClass('internal-link')) {
		// 	nodeElement.attrs.href = '#'
		// }
		break
	}

	// add children
	// console.log('node', el, nodeElement)
	const children: Array<ContentNode> = []
	for (const childEl of el.childNodes) {
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
				children[i] = {
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
