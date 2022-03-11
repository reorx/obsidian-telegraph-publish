import { ContentNode, NodeElement } from './types'

const availableAttrs = ['href', 'src']
// From https://telegra.ph/api#NodeElement:
const availableTags = [
  'a', 'aside', 'b', 'blockquote', 'br', 'code', 'em', 'figcaption', 'figure', 'h3', 'h4', 'hr', 'i', 'iframe', 'img', 'li', 'ol', 'p', 'pre', 's', 'strong', 'u', 'ul', 'video',
]

const elementToNodeElement = (el: HTMLElement): [NodeElement|null, string] => {
  const originTag = el.tagName.toLowerCase()
  const nodeElement: NodeElement = {
    tag: originTag,
  }

  // convert tag
  switch (nodeElement.tag) {
    case 'h1':
    case 'h2':
      nodeElement.tag = 'h3'
    case 'h3':
      nodeElement.tag = 'h4'
    case 'h4':
    case 'h5':
    case 'h6':
      nodeElement.tag = 'p'
  }

  // classname
  // 'internal-link'

  // only return new node whose tag is in availableTags
  if (availableTags.indexOf(nodeElement.tag) === -1) {
    return [null, originTag]
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

  return [nodeElement, originTag]
}

export const elementToContentNodes = (el: HTMLElement|Text, parentOriginTag: string|null = null): Array<ContentNode> => {
  if (el instanceof Text) {
    if (parentOriginTag === 'h4' || parentOriginTag === 'h5') {
      return [{
        tag: 'strong',
        children: [el.data as ContentNode],
      }]
    }
    return [el.data as ContentNode]
  }
  // drop non HTMLElement node
  if (!(el instanceof HTMLElement)) {
    // console.log('not instance of HTMLElement', el)
    return []
  }

  const [nodeElement, originTag] = elementToNodeElement(el)
  if (nodeElement) {
    // add children
    for (let childEl of el.childNodes) {
      const children = []
      children.push(...elementToContentNodes(childEl as HTMLElement|Text, originTag))

      // handle special tags
      switch (originTag) {
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
      }
      nodeElement.children = children
    }
    return [nodeElement]
  } else {
    // unwrap the current element
    const nodes = []
    for (let childEl of el.childNodes) {
      nodes.push(...elementToContentNodes(childEl as HTMLElement|Text))
    }
    return nodes
  }
}

const isString = (node: ContentNode): node is string => {
  return typeof node  === 'string'
}
