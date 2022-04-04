/* TODO
 * - [x] delete page (by submiting a "Deleted at" in content)
 * - [ ] upload images
 * - [x] handle internal links
 * - [x] handle code blocks
 * - [ ] copy url to clipboard button
 */
import $, { Cash } from 'cash-dom'
import matter from 'gray-matter'
import {
	App, MarkdownRenderer, MarkdownView, Modal, Plugin, PluginSettingTab,
	Setting, TFile,
} from 'obsidian'
import { updateKeyInFrontMatter } from 'updateKeyInFrontMatter'

import TelegraphClient from './telegraph'
import { Account, Page } from './telegraph/types'
import { elementToContentNodes } from './telegraph/utils'

const FRONTMATTER_KEY = {
	telegraph_page_url: 'telegraph_page_url',
	telegraph_page_path: 'telegraph_page_path',
}

enum HTMLSource {
	Preview = 'Preview',
	MarkdownRenderer = 'MarkdownRenderer',
}

interface PluginSettings {
	accessToken: string
	username: string
	htmlSource: HTMLSource
}

const DEFAULT_SETTINGS: PluginSettings = {
	accessToken: '',
	username: 'obsidian',
	htmlSource: HTMLSource.Preview,
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
		await this.loadSettings()
		console.log('telegraph publish plugin loaded;', `DEBUG = ${DEBUG}`)

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

		// switch view to preview mode
		const viewState = view.leaf.getViewState()
		await view.leaf.setViewState({
			...viewState,
			state: {
				...viewState.state,
				mode: 'preview',
			},
		})
		// waiht for html to update
		await new Promise(resolve => setTimeout(resolve, 500))

		let contentEl: HTMLElement
		// Convert html to telegraph nodes
		if (this.settings.htmlSource === HTMLSource.Preview) {
			// containerEl is div.markdown-reading-view
			const containerEl = view.previewMode.containerEl
			contentEl = $(containerEl).find('.markdown-preview-section')[0]
			if (contentEl === undefined) {
				throw new Error(`Could not get element in preview, try to use "${HTMLSource.MarkdownRenderer}" for "HTML source" in settings`)
			}
		} else {
			const markdown = await this.app.vault.cachedRead(file)
			debugLog(`use ${HTMLSource.MarkdownRenderer}`)
			contentEl = view.containerEl.createDiv({
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
		}

		/*
		// clone and preprocess (this causes innerText behaves like textContent, which is bad for table)
		const $contentContainer = $(contentEl).clone()
		$contentContainer.find('.frontmatter').remove()
		$contentContainer.find('.frontmatter-container').remove()
		const nodes = elementToContentNodes($contentContainer[0])
		*/
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
			$(`<div class=".message">
					<p>Are you sure you want to publish <b>${fileTitle}</b> to Telegraph?</p>
				</div>`).appendTo(contentEl)
			break
		case Action.clear:
			$(`<div class=".message">
					<p>Are you sure you want to clear published content of <b>${fileTitle}</b> on Telegraph?</p>
					<p>Note that Telegraph does not provide a delete API, the clear action just replaces the content with "Deleted" to achieve a similar result.</p>
				</div>`).appendTo(contentEl)
			break
		}
		const inputs = $('<div class=".inputs">').appendTo(contentEl)
		inputs.append($('<button>').text('Yes').on('click', () => {
			this.close()
			func()
		}))
		inputs.append($('<button>').text('No').on('click', () => this.close()))
		return this
	}

	success(action: Action, fileTitle: string, pageUrl: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Publish success - ${action}`
		switch (action) {
		case Action.create:
		case Action.update:
			$(`<div class=".message">
					<p>Your article has been published (${action}) to Telegraph.</p>
					<p><a href="${pageUrl}" target="_blank">${fileTitle}</a></p>
					<p>To edit the article, please open settings and open <code>auth_url</code> to login to Telegraph first</p>
				</div>`).appendTo(contentEl)
			break
		case Action.clear:
			$(`<div class=".message">
					<p>Your published article has been cleared.</p>
					<p><a href="${pageUrl}" target="_blank">${fileTitle}</a></p>
				</div>`).appendTo(contentEl)
			break
		}
		return this
	}

	error(action: Action|null, error: Error, fileTitle: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Publish failed - ${action || 'unknown'}`
		$(`<div class=".message">
			<p>Failed to publish <b>${fileTitle}</b>, error:</p>
			<pre><code>${error}</pre></code>
		</div>`).appendTo(contentEl)
		return this
	}

	invalidOperation(message: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = 'Invalid operation'
		$(`<div class=".message">
			<p>${message}</p>
		</div>`).appendTo(contentEl)
		return this
	}

	onClose() {
		this.contentEl.empty()
	}
}

const accountInfoHTML = `<div class="account-info">
	<div class="title">Account Info:</div>
</div>`

class SettingTab extends PluginSettingTab {
	plugin: TelegraphPublishPlugin
	accountInfoEl: Cash
	errorEl: Cash

	constructor(app: App, plugin: TelegraphPublishPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	async renderAccountInfo() {
		const el = this.accountInfoEl
		el.empty()
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
			const ul = $(`<ul>
				<li><code>short_name</code>: ${account.short_name}</li>
				<li><code>auth_url</code>: <a href="${account.auth_url}">${account.auth_url}</a></li>
			</ul>`)
			el.append(ul)
		} else {
			el.append($('<div>No access token</div>'))
		}
	}

	renderError(err: Error) {
		this.errorEl.text(err.message)
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

		this.accountInfoEl = $(accountInfoHTML).appendTo(containerEl)
		this.errorEl = $('<div class="error"></div>').appendTo(containerEl)

		containerEl.createEl('h2', {text: 'Misc'})

		new Setting(containerEl)
			.setName('HTML Source')
			.setDesc(`Choose how to get HTML for publishing.
				Preview: directly get HTML in preview mode;
				MarkdownRenderer: render HTML from markdown text,
				this option will disable the effects other plugins made to preview mode.`)
			.addDropdown(dropdown => dropdown
				.addOption(HTMLSource.Preview, HTMLSource.Preview)
				.addOption(HTMLSource.MarkdownRenderer, HTMLSource.MarkdownRenderer)
				.setValue(this.plugin.settings.htmlSource)
				.onChange(async (value: HTMLSource) => {
					this.plugin.settings.htmlSource = value
					await this.plugin.saveSettings()
				}
				))

		this.renderAccountInfo()
	}
}
