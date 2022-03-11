import {Account, PageList, Page, CreatePageData, EditPageData} from './types'
import { requestUrl, RequestUrlParam } from 'obsidian';

const constants = {
  API_URL: 'https://api.telegra.ph/',
}


export default class TelegraphClient {
  accessToken: string;

  constructor(accessToken?: string) {
    this.accessToken = accessToken
  }

  async request(method: string, path: string, data: any = {}): Promise<any> {
	const req: RequestUrlParam = {
		url: `${constants.API_URL}${path}`,
		method,
	}
	if (this.accessToken) {
	data['access_token'] = this.accessToken
	}
	req.body = JSON.stringify(data),
	req.contentType = 'application/json'
	const res = await requestUrl(req)
	console.log('request data', data)

	if (res.status !== 200) {
      	throw new Error(`TelegraphClient.request failed: ${res.status}, ${res.text}`)
	}

	const resData = res.json as any
	if (!resData.ok) {
      	throw new Error(`TelegraphClient.request failed: ${res.status}, ${res.text}`)
	}
	return resData.result
  }

  async createAccount(shortName: string, authorName: string): Promise<Account>  {
    const data = await this.request('POST', `createAccount`, {
      short_name: shortName,
      author_name: authorName,
    })
    return data as Account
  }

  async getAccountInfo(): Promise<Account> {
	const data = await this.request('POST', `getAccountInfo`, {
		fields: ['short_name', 'author_name', 'author_url', 'auth_url', 'page_count'],
	})
	return data as Account
  }

  async getPageList(offset: number = 0, limit: number = 50): Promise<PageList> {
    const data = await this.request('POST', `getPageList`, {
      offset,
      limit,
    })
    return data as PageList
  }

  async createPage(reqData: CreatePageData): Promise<Page> {
    const data = await this.request('POST', `createPage`, reqData)
    return data as Page
  }

  async editPage(reqData: EditPageData): Promise<Page> {
    const data = await this.request('POST', `editPage`, reqData)
    return data as Page
  }

  async getPage(path: string): Promise<Page> {
    const data = await this.request('POST', `getPage`, {
		path,
		return_content: true,
	})
    return data as Page
  }
}
