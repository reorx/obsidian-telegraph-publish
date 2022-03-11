/* TODOs:
 * - check name existence when saving
 * - add context menu for renaming the link/file
 */
import {
	App, Plugin, PluginSettingTab, Setting,
	TFile, MarkdownView,
	Modal,
} from 'obsidian';
import $ from 'cash-dom';
import { Cash } from 'cash-dom';
import TelegraphClient from './telegraph';
import { elementToContentNodes } from './telegraph/utils'


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
			await this.publishActiveFile()
		});

		// add command
		this.addCommand({
			id: 'publish-to-telegraph',
			name: "Publish to Telegraph",
			callback: async () => {
				await this.publishActiveFile()
			}
		});

		// debug code
		// if (DEBUG) {
		// 	this.debugModal = new PublishModal(this.app, imageFile as TFile)
		// 	this.debugModal.open()
		// }
	}

	async publishActiveFile() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!view) {
			// TODO error modal
			return
		}

		// .markdown-reading-view
		const containerEl = view.previewMode.containerEl
		const contentContainerEl = containerEl.children[0].children[1]
		console.log('contentContainerEl', contentContainerEl)

		const nodes = elementToContentNodes(contentContainerEl as HTMLElement)
		console.log('nodes', nodes)
		return
		const page = await this.getClient().createPage({
			title: view.file.basename,
			author_name: this.settings.username,
			content:nodes,
		})
		console.log('page', page.url, page)
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

const modalContent = `<div class="image"><img></div>
<div class="inputs">
	<input type="text" placeholder="title" class="title">
	<input type="button" value="save" class="save">
</div>`

class PublishModal extends Modal {

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		this.containerEl.addClass('image-rename-modal')
		const { contentEl } = this;

		const content = $(modalContent)
		content.find('.image img').attr('src', '')
		$(contentEl).append(content)
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
