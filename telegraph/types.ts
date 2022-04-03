
export interface Account {
  access_token: string
  short_name: string
  author_name: string
  author_url: string
  auth_url: string
  page_count: string
}

export interface Page {
  path: string
  url: string
  title: string
  description: string
  author_name: string
  author_url: string
  image_url: string
  content: ContentNode[]
  views: number
  can_edit: boolean
}

export interface PageList {
  total_count: number
  pages: Array<Page>
}

export interface CreatePageData {
  title: string
  author_name?: string
  author_url?: string
  content: ContentNode[]
  return_content?: boolean
}

export interface EditPageData {
  path: string
  title: string
  author_name?: string
  author_url?: string
  content: ContentNode[]
  return_content?: boolean
}

export type ContentNode = NodeElement | string

export interface NodeElement {
  tag: string
  attrs?: { [key: string]: string }
  children?: Array<ContentNode>
}
