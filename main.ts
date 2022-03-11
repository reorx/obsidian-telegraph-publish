/* TODOs:
 * - check name existence when saving
 * - add context menu for renaming the link/file
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

	async confirmPublish() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			new PublishModal(this.app, this, 'error', {
				fileTitle: view.file.basename,
			}).open()
			return
		}
		new PublishModal(this.app, this, 'confirm', {
			fileTitle: view.file.basename,
		}).open()
	}

	async publishActiveFile() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)

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
		// clone and preprocess
		const $contentContainer = $(contentContainerEl).clone()
		$contentContainer.find('.frontmatter').remove()
		$contentContainer.find('.frontmatter-container').remove()
		const nodes = elementToContentNodes($contentContainer[0])
		console.log('nodes', nodes)
		// return

		// get file content and frontmatter
		let content = await this.app.vault.read(view.file)
		const { data } = matter(content)
		let page
		let action = 'create'
		if (FRONTMATTER_KEY.telegraph_page_path in data) {
			action = 'update'
			// console.log('update telegraph page')
			// already published
			page = await this.getClient().editPage({
				path: data[FRONTMATTER_KEY.telegraph_page_path],
				title: view.file.basename,
				// title: '',
				content: nodes,
			}).catch(e => {
				new PublishModal(this.app, this, 'error', {error: e}).open()
				throw e
			})
		} else {
			// console.log('create telegraph page')
			// not published yet
			page = await this.getClient().createPage({
				title: view.file.basename,
				author_name: this.settings.username,
				content: nodes,
			}).catch(e => {
				new PublishModal(this.app, this, 'error', {error: e}).open()
				throw e
			})

			// update frontmatter
			content = updateKeyInFrontMatter(content, FRONTMATTER_KEY.telegraph_page_url, page.url)
			content = updateKeyInFrontMatter(content, FRONTMATTER_KEY.telegraph_page_path, page.path)
			await this.app.vault.modify(view.file, content)
		}

		// show modal
		console.log('page', page.url, page)
		new PublishModal(this.app, this, 'success', {
			fileTitle: view.file.basename,
			pageUrl: page.url,
			action,
		}).open()
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
	name: string
	data: any

	constructor(app: App, plugin: TelegraphPublishPlugin, name: string, data: any) {
		super(app);
		this.plugin = plugin
		this.name = name
		this.data = data
	}

	onOpen() {
		this.containerEl.addClass('telegraph-publish-modal')

		switch (this.name) {
			case 'confirm':
				this.renderConfirm()
				break
			case 'success':
				this.renderSuccess()
				break
			case 'error':
				this.renderError()
				break
		}
	}

	renderConfirm() {
		const { contentEl, titleEl } = this
		titleEl.innerText = 'Confirm publish to Telegraph'
		$(`<div class=".message">
			<p>Are you sure you want to publish ${this.data.fileTitle} to Telegraph?</p>
		</div>`).appendTo(contentEl)
		const inputs = $('<div class=".inputs">').appendTo(contentEl)
		inputs.append($('<button>').text('Yes').on('click', () => {
			this.close()
			this.plugin.publishActiveFile()
		}))
		inputs.append($('<button>').text('No').on('click', () => this.close()))
	}

	renderSuccess() {
		const { contentEl, titleEl } = this
		titleEl.innerText = 'Publish success'
		$(`<div class=".message">
			<p>Your article has been published (${this.data.action}) to Telegraph.</p>
			<p><a href="${this.data.pageUrl}" target="_blank">${this.data.fileTitle}</a></p>
			<p>To edit the article, please open settings and open <code>auth_url</code> to login to Telegraph first</p>
		</div>`).appendTo(contentEl)
	}

	renderError() {
		const { contentEl, titleEl } = this
		titleEl.innerText = 'Publish failed'
		$(`<div class=".message">
			<p>Failed to publish ${this.data.fileTitle}, error:</p>
			<pre><code>${this.data.error}</pre></code>
		</div>`).appendTo(contentEl)
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
