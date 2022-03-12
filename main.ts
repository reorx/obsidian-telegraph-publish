/* TODO
 * - [x] delete page (by submiting a "Deleted at" in content)
 * - [ ] upload images
 * - [x] handle internal links
 * - [x] handle code blocks
 */
import {
	App, Plugin, PluginSettingTab, Setting,
	MarkdownView,
	Modal,
	WorkspaceLeaf,
} from 'obsidian';
import $ from 'cash-dom';
import { Cash } from 'cash-dom';
import TelegraphClient from './telegraph';
import { elementToContentNodes } from './telegraph/utils'
import { updateKeyInFrontMatter } from 'updateKeyInFrontMatter';
import matter from 'gray-matter'

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
	username: 'obsidian'
}

const DEBUG = true

enum Action {
	create = 'create',
	update = 'update',
	clear = 'clear',
}

export default class TelegraphPublishPlugin extends Plugin {
	settings: PluginSettings
	debugModal: PublishModal|null

	async onload() {
		await this.loadSettings();
		console.log('telegraph publish plugin loaded')

		// add settings tab
		this.addSettingTab(new SettingTab(this.app, this));

		// add sidebar button
		this.addRibbonIcon('paper-plane', "Publish to Telegraph", async (evt: MouseEvent) => {
			await this.confirmPublish()
		});

		// add command
		this.addCommand({
			id: 'publish-to-telegraph',
			name: "Publish to Telegraph",
			callback: async () => {
				await this.confirmPublish()
			}
		});
		// add command
		this.addCommand({
			id: 'clear-published-content-on-telegraph',
			name: "Clear published content on Telegraph",
			callback: async () => {
				await this.confirmClearPublished()
			}
		});

		// debug code
		if (DEBUG) {
			this.addCommand({
				id: 'get-telegraph-page',
				name: "Get telegraph page",
				callback: async () => {
					await this.getActiveFilePage()
				}
			});

			// this.debugModal = new PublishModal(this.app, this, 'confirm', {
			// 	fileTitle: 'test'
			// })
			// this.debugModal.open()
		}
	}

	async getActiveFilePage() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		let content = await this.app.vault.read(view.file)
		const { data } = matter(content)
		const pagePath = data[FRONTMATTER_KEY.telegraph_page_path]
		if (!pagePath)
			return
		const page = await this.getClient().getPage(pagePath)
		console.log('get page', page)
	}

	async getActiveFileContent(view: MarkdownView): Promise<[string|null, string|null]> {
		let content = await this.app.vault.read(view.file)
		const { data } = matter(content)
		return [content, data[FRONTMATTER_KEY.telegraph_page_path]]
	}

	async confirmPublish() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			new PublishModal(this).invalidOperation(`Cannot get active markdown view`).open()
			return
		}
		const [, pagePath] = await this.getActiveFileContent(view)
		new PublishModal(this).confirm(pagePath ? Action.update : Action.create, view.file.basename, this.publishActiveFile.bind(this)).open()
	}

	async confirmClearPublished() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			new PublishModal(this).invalidOperation(`Cannot get active markdown view`).open()
			return
		}
		const [, pagePath] = await this.getActiveFileContent(view)
		if (!pagePath) {
			new PublishModal(this).invalidOperation(`This file has not been published yet`).open()
			return
		}
		new PublishModal(this).confirm(Action.clear, view.file.basename, this.clearPublished.bind(this)).open()
	}

	async publishActiveFile() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view.file

		// change to preview mode
		await view.leaf.setViewState({
			...view.leaf.getViewState(),
			state: {
				...view.getState(),
				mode: 'preview',
			},
		})
		// waiht for html to update
		await new Promise(resolve => setTimeout(resolve, 500));

		// Convert html to telegraph nodes
		// div.markdown-reading-view
		const containerEl = view.previewMode.containerEl
		const contentContainerEl = containerEl.children[0].children[1]

		/*
		// clone and preprocess (this causes innerText behaves like textContent, which is bad for table)
		const $contentContainer = $(contentContainerEl).clone()
		$contentContainer.find('.frontmatter').remove()
		$contentContainer.find('.frontmatter-container').remove()
		const nodes = elementToContentNodes($contentContainer[0])
		*/
		const nodes = elementToContentNodes(contentContainerEl as HTMLElement)
		console.log('nodes', nodes)
		// return

		// get file content and frontmatter
		const [content, pagePath] = await this.getActiveFileContent(view)
		let page, action: Action
		if (pagePath) {
			action = Action.update
			// console.log('update telegraph page')
			// already published
			page = await this.getClient().editPage({
				path: pagePath,
				title: file.basename,
				// title: '',
				content: nodes,
			}).catch(e => {
				new PublishModal(this).error(action, e, file.basename).open()
				throw e
			})
		} else {
			action = Action.create
			// console.log('create telegraph page')
			// not published yet
			page = await this.getClient().createPage({
				title: file.basename,
				author_name: this.settings.username,
				content: nodes,
			}).catch(e => {
				new PublishModal(this).error(action, e, file.basename).open()
				throw e
			})

			// update frontmatter
			let newContent = updateKeyInFrontMatter(content, FRONTMATTER_KEY.telegraph_page_url, page.url)
			newContent = updateKeyInFrontMatter(newContent, FRONTMATTER_KEY.telegraph_page_path, page.path)
			await this.app.vault.modify(file, newContent)
		}

		// show modal
		console.log('page', page.url, page)
		new PublishModal(this).success(action, file.basename, page.url).open()
	}

	async clearPublished() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		const file = view.file

		// get file content and frontmatter
		const [, pagePath] = await this.getActiveFileContent(view)
		const page = await this.getClient().editPage({
			path: pagePath,
			title: file.basename,
			// title: '',
			content: ["Deleted"],
		}).catch(e => {
			new PublishModal(this).error(Action.clear, e, file.basename).open()
			throw e
		})

		// show modal
		console.log('page', page.url, page)
		new PublishModal(this).success(Action.clear, file.basename, page.url).open()
	}

	onunload() {
		this.debugModal?.close()
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getClient(): TelegraphClient {
		return new TelegraphClient(this.settings.accessToken)
	}
}

class PublishModal extends Modal {
	plugin: TelegraphPublishPlugin
	action: Action
	data: any

	constructor(plugin: TelegraphPublishPlugin) {
		super(plugin.app);
		this.plugin = plugin
	}

	confirm(action: Action, fileTitle: string, func: () => {}): PublishModal {
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

	error(action: Action, error: Error, fileTitle: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Publish failed - ${action}`
		$(`<div class=".message">
			<p>Failed to publish <b>${fileTitle}</b>, error:</p>
			<pre><code>${error}</pre></code>
		</div>`).appendTo(contentEl)
		return this
	}

	invalidOperation(message: string): PublishModal {
		const { contentEl, titleEl } = this
		titleEl.innerText = `Invalid Operation`
		$(`<div class=".message">
			<p>${message}</p>
		</div>`).appendTo(contentEl)
		return this
	}

	onClose() {
		this.contentEl.empty();
	}
}

const accountInfoHTML = `<div id="telegraph-account-info">
	<div class="title">Account Info:</div>
</div>`

class SettingTab extends PluginSettingTab {
	plugin: TelegraphPublishPlugin;
	accountInfoEl: Cash
	errorEl: Cash

	constructor(app: App, plugin: TelegraphPublishPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async renderAccountInfo() {
		const el = this.accountInfoEl
		const client = this.plugin.getClient()
		if (client.accessToken) {
			let account
			try {
				account = await client.getAccountInfo() as any
			} catch(e) {
				this.renderError(e)
				throw e
			}
			console.log('get account', account)
			const ul = $(`<ul>
				<li><code>short_name</code>: ${account.short_name}</li>
				<li><code>auth_url</code>: <a href="${account.auth_url}">${account.auth_url}</a></li>
			</ul>`)
			el.append(ul)
		} else {
			el.append($(`<div>No access token</div>`))
		}
	}

	renderError(err: Error) {
		this.errorEl.text(err.message)
	}

	display(): void {
		const { containerEl } = this;
		const plugin = this.plugin
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Account'});

		new Setting(containerEl)
			.setName('Username')
			.setDesc(`The username for creating telegraph account`)
			.addText(text => text
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					plugin.settings.username = value;
					await plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Access token')
			.setDesc(`Telegraph access token. You can also leave it empty and click "Create new account"`)
			.addText(text => text
				.setValue(this.plugin.settings.accessToken)
				.onChange(async (value) => {
					plugin.settings.accessToken = value;
					await plugin.saveSettings();
					this.renderAccountInfo()
				}
			))

		new Setting(containerEl)
			.setName('Create new account')
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
						console.log('account created', account)

						plugin.settings.accessToken = account.access_token
						plugin.saveSettings()
						// TODO change access token input?

						this.renderAccountInfo()
					})
				button.buttonEl.setAttribute('style', `margin-right: 0`)
				return button
			})

		this.accountInfoEl = $(accountInfoHTML).appendTo(containerEl)
		this.errorEl = $(`<div class="error"></div>`).appendTo(containerEl)
		this.renderAccountInfo()
	}
}
