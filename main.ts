/* TODO
 * - [x] delete page (by submiting a "Deleted at" in content)
 * - [ ] upload images (as images on telegra.ph embedding directly from external website, use '![](url)' to embed image)
 * - [x] handle internal links
 * - [x] handle code blocks
 * - [x] copy url to clipboard button
 */
import matter from 'gray-matter'
import {
	App, MarkdownRenderer, MarkdownView, Modal, Plugin, PluginSettingTab, Setting,
	TFile,
} from 'obsidian'
import { updateKeyInFrontMatter } from 'updateKeyInFrontMatter'

import TelegraphClient from './telegraph'
import { Account, Page } from './telegraph/types'
import { elementToContentNodes } from './telegraph/utils'


const FRONTMATTER_KEY = {
	telegraph_page_url: 'telegraph_page_url',
	telegraph_page_path: 'telegraph_page_path',
}

interface PluginSettings {
	accessToken: string
	username: string
}

const DEFAULT_SETTINGS: PluginSettings = {
	accessToken: '',
	username: 'obsidian',
}

enum Action {
	create = 'create',
	update = 'update',
	clear = 'clear',
}

const DEBUG = !(process.env.BUILD_ENV === 'production')

function debugLog(...args: any[]) {
	if (DEBUG) {
		console.log(...args)
	}
}

export default class TelegraphPublishPlugin extends Plugin {
	settings: PluginSettings
	debugModal: PublishModal|null

	async onload() {
		const pkg = require('package.json')
		console.log(`Plugin loading: ${pkg.name} ${pkg.version}`, `DEBUG = ${DEBUG}`)
		await this.loadSettings()

		// add settings tab
		this.addSettingTab(new SettingTab(this.app, this))

		// add sidebar button
		this.addRibbonIcon('paper-plane', 'Publish to Telegraph', async (evt: MouseEvent) => {
			await this.confirmPublish()
		})

		// add command
		this.addCommand({
			id: 'publish-to-telegraph',
			name: 'Publish to Telegraph',
			callback: async () => {
				await this.confirmPublish()
			}
		})
		// add command
		this.addCommand({
			id: 'clear-published-content-on-telegraph',
			name: 'Clear published content on Telegraph',
			callback: async () => {
				await this.confirmClearPublished()
			}
		})

		// debug code
		if (DEBUG) {
			this.addCommand({
				id: 'get-telegraph-page',
				name: 'Get telegraph page',
				callback: async () => {
					await this.getActiveFilePage()
				}
			})
		}
	}

	async getActiveFilePage() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const content = await this.app.vault.read(view.file)
		const { data } = matter(content)
		const pagePath = data[FRONTMATTER_KEY.telegraph_page_path]
		if (!pagePath)
			return
		const page = await this.getClient().getPage(pagePath)
		debugLog('get page', page)
	}

	async getActiveFileContent(view: MarkdownView): Promise<[string|null, string|null]> {
		const content = await this.app.vault.read(view.file)
		const { data } = matter(content)
		return [content, data[FRONTMATTER_KEY.telegraph_page_path]]
	}
	
	/**
	 * Convert Obsidian internal links (e.g. [[Some note]]) to Telegraph URLs if the
	 * target note has `telegraph_page_url` in its frontmatter.
	 *
	 * Notes:
	 * - We only touch links that point to *other* files.
	 * - Links to headings inside the current file (e.g. [[#Heading]]) are left as-is.
	 * - If the target note doesn't have `telegraph_page_url`, we fall back to '#'
	 */
	private async rewriteInternalLinks(containerEl: HTMLElement, sourceFile: TFile): Promise<void> {
		const linkEls = Array.from(containerEl.querySelectorAll('a.internal-link')) as HTMLAnchorElement[]
		if (linkEls.length === 0) return

		// Cache per target file path to avoid repeated metadata lookups.
		const urlByPath = new Map<string, string | null>()

		for (const a of linkEls) {
			// In reading mode Obsidian typically stores the wikilink target in data-href.
			// Fallback to href if data-href is missing.
			const raw = (a.getAttribute('data-href') ?? a.getAttribute('href') ?? '').trim()
			if (!raw) continue

			// Keep in-file heading links like [[#Heading]] untouched.
			if (raw.startsWith('#')) continue

			// Remove any heading part (e.g. "Note#Heading"). Telegraph doesn't reliably
			// support heading anchors, so we link to the page itself.
			const linkPath = raw.split('#')[0].trim()
			if (!linkPath) continue

			const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path)
			if (!dest) {
				// unresolved internal link
				a.setAttribute('href', '#')
				continue
			}

			let telegraphUrl: string | null
			if (urlByPath.has(dest.path)) {
				telegraphUrl = urlByPath.get(dest.path)!
			} else {
				const cache = this.app.metadataCache.getFileCache(dest)
				telegraphUrl = (cache?.frontmatter?.[FRONTMATTER_KEY.telegraph_page_url] as string | undefined) ?? null
				urlByPath.set(dest.path, telegraphUrl)
			}

			a.setAttribute('href', telegraphUrl ?? '#')
		}
	}

	ensureAccessToken(): boolean {
		if (!this.settings.accessToken) {
			new PublishModal(this).invalidOperation('Please set access token or create new account in settings').open()
			return false
		}
		return true
	}

	async confirmPublish() {
		if (!this.ensureAccessToken())
			return
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			new PublishModal(this).invalidOperation('Cannot get active markdown view').open()
			return
		}
		const [, pagePath] = await this.getActiveFileContent(view)
		new PublishModal(this).confirm(pagePath ? Action.update : Action.create, view.file.basename, this.publishActiveFileSafe.bind(this)).open()
	}

	async confirmClearPublished() {
		if (!this.ensureAccessToken())
			return
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			new PublishModal(this).invalidOperation('Cannot get active markdown view').open()
			return
		}
		const [, pagePath] = await this.getActiveFileContent(view)
		if (!pagePath) {
			new PublishModal(this).invalidOperation('This file has not been published yet').open()
			return
		}
		new PublishModal(this).confirm(Action.clear, view.file.basename, this.clearPublished.bind(this)).open()
	}

	async publishActiveFileSafe() {
		const cleanups: (() => void)[] = []
		const context: ErrorContext = {}
		try {
			await this.publishActiveFile(context, cleanups)
		} catch (err) {
			new PublishModal(this).error(context.action, err, context.file?.basename).open()
			throw err
		} finally {
			debugLog('run cleanups for publishActiveFile() call')
			cleanups.forEach(func => func())
		}
	}

	async publishActiveFile(context: ErrorContext, cleanups: (() => void)[]) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view.file
		if (!file) {
			// normally this should not happen because view has been checked in `confirmPublish()`
			throw new Error('Cannot get file from active markdown view')
		}
		context.file = file

		// Get HTML from rendering source markdown
		const markdown = await this.app.vault.cachedRead(file)
		const contentEl = view.containerEl.createDiv({
			cls: 'tmp-markdown-preview',
			attr: {
				style: 'display: none;'
			}
		})
		cleanups.push(() => {
			debugLog('cleanup: remove tmp-markdown-preview')
			contentEl.remove()
		})
		await MarkdownRenderer.renderMarkdown(markdown, contentEl, '', null)
		/* DEBUG test error
		context.action = Action.create
		throw 'test err'
		*/
		
		// Rewrite Obsidian internal links before converting HTML -> Telegraph nodes.
		// This lets us turn [[Some note]] into a link to that note's `telegraph_page_url`
		// (if present in its frontmatter), instead of linking to "#" (self).
		await this.rewriteInternalLinks(contentEl, file)

		// Convert html to telegraph nodes
		const nodes = elementToContentNodes(contentEl)
		debugLog('nodes', nodes)
		// return

		// get file content and frontmatter
		const [content, pagePath] = await this.getActiveFileContent(view)
		let page, action: Action
		if (pagePath) {
			action = Action.update
			context.action = action
			// debugLog('update telegraph page')
			// already published
			page = await this.getClient().editPage({
				path: pagePath,
				title: file.basename,
				// title: '',
				content: nodes,
			})
		} else {
			action = Action.create
			context.action = action
			// debugLog('create telegraph page')
			// not published yet
			page = await this.getClient().createPage({
				title: file.basename,
				author_name: this.settings.username,
				content: nodes,
			})

			// update frontmatter
			let newContent = updateKeyInFrontMatter(content, FRONTMATTER_KEY.telegraph_page_url, page.url)
			newContent = updateKeyInFrontMatter(newContent, FRONTMATTER_KEY.telegraph_page_path, page.path)
			await this.app.vault.modify(file, newContent)
		}

		// show modal
		debugLog('page', page.url, page)
		new PublishModal(this).success(action, file.basename, page.url).open()
	}

	async clearPublished() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view.file

		// get file content and frontmatter
		const [, pagePath] = await this.getActiveFileContent(view)
		let page: Page
		try {
			page = await this.getClient().editPage({
				path: pagePath,
				title: file.basename,
				// title: '',
				content: ['Deleted'],
			})
		} catch (err) {
			new PublishModal(this).error(Action.clear, err, file.basename).open()
			throw err
		}

		// show modal
		debugLog('page', page.url, page)
		new PublishModal(this).success(Action.clear, file.basename, page.url).open()
	}

	onunload() {
		this.debugModal?.close()
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	getClient(): TelegraphClient {
		return new TelegraphClient(this.settings.accessToken)
	}
}

interface ErrorContext {
	file?: TFile
	action?: Action
}

class PublishModal extends Modal {
	plugin: TelegraphPublishPlugin
	action: Action
	data: object

	constructor(plugin: TelegraphPublishPlugin) {
		super(plugin.app)
		this.plugin = plugin
	}

	confirm(action: Action, fileTitle: string, func: () => void): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Confirm publish - ${action}`
		switch (action) {
		case Action.create:
		case Action.update:
			contentEl.createEl('p', {
				text: `Are you sure you want to publish "${fileTitle}" to Telegraph?`,
			})
			break
		case Action.clear:
			contentEl.createEl('p', {
				text: `Are you sure you want to clear published content of "${fileTitle}" on Telegraph?`,
			})
			contentEl.createEl('p', {
				text: 'Note that Telegraph does not provide a delete API, the clear action just replaces the content with "Deleted" to achieve a similar result.'
			})
			break
		}
		new Setting(contentEl)
			.addButton(button => {
				button
					.setButtonText('Yes')
					.onClick(() => {
						this.close()
						func()
					})
			})
			.addButton(button => {
				button
					.setButtonText('No')
					.onClick(() => { this.close() })
			})
		return this
	}

	success(action: Action, fileTitle: string, pageUrl: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Publish success - ${action}`
		switch (action) {
		case Action.create:
		case Action.update:
			contentEl.createEl('p', {
				text: `Your article has been published (${action}) to Telegraph.`
			})
			contentEl.createEl('p')
				.createEl('a', {
					text: fileTitle,
					attr: {
						href: pageUrl,
						target: '_blank',
					}
				})
			contentEl.createEl('p', {
				text: 'To edit the article, please open settings and open "auth_url" to login to Telegraph first'
			})
			new Setting(contentEl)
				.addButton(button => {
					button
						.setButtonText('Copy URL')
						.onClick(() => {
							navigator.clipboard.writeText(pageUrl)
							button.setButtonText('Copied')
						})
				})
			break
		case Action.clear:
			contentEl.createEl('p', {
				text: 'Your published article has been cleared.',
			})
			contentEl.createEl('p')
				.createEl('a', {
					text: fileTitle,
					attr: {
						href: pageUrl,
						target: '_blank',
					}
				})
			break
		}
		return this
	}

	error(action: Action|null, error: Error, fileTitle: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Publish failed - ${action || 'unknown'}`
		contentEl.createEl('p', {
			text: `Failed to publish "${fileTitle}", error:`
		})
		contentEl.createEl('pre')
			.createEl('code', {
				text: error.toString()
			})
		return this
	}

	invalidOperation(message: string): PublishModal {
		const { contentEl, titleEl } = this
		contentEl.createEl('p', {
			text: message,
		})
		titleEl.innerText = 'Invalid operation'
		return this
	}

	onClose() {
		this.contentEl.empty()
	}
}

class SettingTab extends PluginSettingTab {
	plugin: TelegraphPublishPlugin
	accountInfoEl: HTMLElement
	errorEl: HTMLElement

	constructor(app: App, plugin: TelegraphPublishPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	async renderAccountInfo() {
		const el = this.accountInfoEl
		el.innerHTML = ''

		const client = this.plugin.getClient()
		if (client.accessToken) {
			let account: Account
			try {
				account = await client.getAccountInfo()
			} catch(e) {
				this.renderError(e)
				throw e
			}
			debugLog('get account', account)
			const ul = el.createEl('ul')
			ul.createEl('li', {
				text: `short_name: ${account.short_name}`,
			})
			const authUrlLi = ul.createEl('li', {
			})
			authUrlLi.createEl('span', {
				text: 'auth_url: ',
			})
			authUrlLi.createEl('a', {
				text: account.auth_url,
				href: account.auth_url,
			})
		} else {
			el.createEl('p', {
				text: 'No access token'
			})
		}
	}

	renderError(err: Error) {
		this.errorEl.innerText = err.toString()
	}

	display(): void {
		const { containerEl } = this
		const plugin = this.plugin
		containerEl.empty()
		containerEl.addClass('telegraph-publish-setting')
		containerEl.createEl('h2', {text: 'Telegraph Account'})

		new Setting(containerEl)
			.setName('Username')
			.setDesc('The username for creating Telegraph account')
			.addText(text => text
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					plugin.settings.username = value
					await plugin.saveSettings()
				}
				))

		new Setting(containerEl)
			.setName('Access token')
			.setDesc('Telegraph access token. You can also leave it empty and click "Create new account"')
			.addText(text => text
				.setValue(this.plugin.settings.accessToken)
				.onChange(async (value) => {
					plugin.settings.accessToken = value
					await plugin.saveSettings()
					this.renderAccountInfo()
				}
				))

		new Setting(containerEl)
			.setName('Create new account')
			.setDesc('When new account is created, access token will be replaced with the new one, please backup your old access token before creating new account')
			.addButton(button => {
				button
					.setButtonText('Create new account')
					.onClick(async () => {
						let account
						try {
							account = await plugin.getClient().createAccount(plugin.settings.username, plugin.settings.username)
						} catch(e) {
							this.renderError(e)
							throw e
						}
						debugLog('account created', account)
						plugin.settings.accessToken = account.access_token
						await plugin.saveSettings()
						this.display()
					})
				return button
			})

		const accountInfoWrapper = containerEl.createDiv({cls: 'account-info'})
		accountInfoWrapper.createDiv({
			cls: 'title',
			text: 'Account Info:',
		})
		this.accountInfoEl = accountInfoWrapper.createDiv()

		this.errorEl = containerEl.createDiv({cls: 'error'})

		this.renderAccountInfo()
	}
}
