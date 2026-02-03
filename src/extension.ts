// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "po-dotnet" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('po-dotnet.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from po-dotnet!');
	});

	// PO manager handles scanning, parsing and watching PO files
	class POManager {
		private cache = new Map<string, Map<string, string>>();
		private watcher?: vscode.FileSystemWatcher;
		private glob: string;
		private initializing = false;
		private initTimer?: ReturnType<typeof setTimeout>;
		constructor(private context: vscode.ExtensionContext) {
			this.glob = vscode.workspace.getConfiguration('poHover').get('poFileGlob', '**/Locales/*.po');
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('poHover.poFileGlob')) {
					const newGlob = vscode.workspace.getConfiguration('poHover').get('poFileGlob', '**/Locales/*.po');
					if (newGlob !== this.glob) {
						this.glob = newGlob;
						this.scheduleInitialize(200);
					}
				}
			}, this, this.context.subscriptions);

			// setup watcher immediately so we observe file changes ASAP (non-blocking)
			this.setupWatcher();
			// schedule initial scan asynchronously with a short delay
			this.scheduleInitialize(200);
		}

		public dispose() {
			if (this.watcher) { this.watcher.dispose(); this.watcher = undefined; }
			if (this.initTimer) { clearTimeout(this.initTimer as any); this.initTimer = undefined; }
		}

		private scheduleInitialize(delay = 200) {
			if (this.initTimer) { clearTimeout(this.initTimer as any); }
			this.initTimer = setTimeout(() => { void this.initialize(); }, delay);
		}

		public ensureInitialized() {
			if (!this.initializing && this.cache.size === 0) {
				this.scheduleInitialize(0);
			}
		}

		private async initialize() {
			if (this.initializing) return;
			this.initializing = true;
			console.log('po-dotnet: starting PO scan (async)...');
			try {
				await this.scanFiles();
			} catch (e) {
				console.error('Error scanning PO files', e);
			} finally {
				this.initializing = false;
				console.log('po-dotnet: PO scan finished');
			}
		}

		private async scanFiles() {
			this.cache.clear();
			try {
				const uris = await vscode.workspace.findFiles(this.glob);
				for (const uri of uris) {
					await this.readAndParse(uri);
				}
			} catch (e) {
				console.error('Error scanning PO files', e);
			}
		}

		private setupWatcher() {
			if (this.watcher) { this.watcher.dispose(); }
			this.watcher = vscode.workspace.createFileSystemWatcher(this.glob);
			this.context.subscriptions.push(this.watcher);
			this.watcher.onDidCreate(uri => this.readAndParse(uri));
			this.watcher.onDidChange(uri => this.readAndParse(uri));
			this.watcher.onDidDelete(uri => this.cache.delete(uri.toString()));
		}

		private async readAndParse(uri: vscode.Uri) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const content = new TextDecoder('utf-8').decode(bytes);
				const map = parsePo(content);
				this.cache.set(uri.toString(), map);
			} catch (e) {
				console.error('Error reading/parsing PO file', uri.toString(), e);
				this.cache.delete(uri.toString());
			}
		}

		public getTranslations(msgid: string) {
			const results: Array<{uri: vscode.Uri, relativePath: string, translation: string}> = [];
			for (const [uriStr, map] of this.cache) {
				const translation = map.get(msgid);
				if (translation && translation.trim() !== '') {
					const uri = vscode.Uri.parse(uriStr);
					const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
					const relativePath = wsFolder ? path.relative(wsFolder.uri.fsPath, uri.fsPath) : uri.fsPath;
					results.push({ uri, relativePath, translation });
				}
			}
			return results;
		}
	}

	function parsePo(content: string): Map<string, string> {
		const map = new Map<string, string>();
		const lines = content.split(/\r?\n/);
		let state: 'none' | 'msgid' | 'msgstr' = 'none';
		let msgidParts: string[] = [];
		let msgstrParts: string[] = [];

		const flush = () => {
			if (msgidParts.length > 0) {
				const id = msgidParts.join('');
				const str = msgstrParts.join('');
				map.set(unescapePo(id), unescapePo(str));
			}
			msgidParts = [];
			msgstrParts = [];
			state = 'none';
		};

		for (let raw of lines) {
			const line = raw.trim();
			if (line.startsWith('msgid')) {
				if (state !== 'none') flush();
				msgidParts = [extractQuoted(line)];
				state = 'msgid';
			} else if (line.startsWith('msgstr')) {
				msgstrParts = [extractQuoted(line)];
				state = 'msgstr';
			} else {
				const m = line.match(/^"(.*)"$/);
				if (m) {
					if (state === 'msgid') msgidParts.push(m[1]);
					else if (state === 'msgstr') msgstrParts.push(m[1]);
				} else if (line === '') {
					if (state !== 'none') flush();
				}
			}
		}
		if (state !== 'none') flush();
		return map;
	}

	function extractQuoted(line: string) {
		const first = line.indexOf('"');
		const last = line.lastIndexOf('"');
		if (first >= 0 && last > first) return line.substring(first + 1, last);
		return '';
	}

	function unescapePo(s: string) {
		return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
	}

	function extractFirstStringArgument(inside: string) {
		// find first quote; support verbatim @"..." and normal "..."
		let i = 0;
		while (i < inside.length && /\s/.test(inside[i])) i++;
		if (i >= inside.length) return null;
		if (inside[i] === '@' && inside[i+1] === '"') {
			let j = i + 2;
			let out = '';
			while (j < inside.length) {
				if (inside[j] === '"') {
					if (inside[j+1] === '"') { out += '"'; j += 2; continue; }
					return out;
				}
				out += inside[j++];
			}
			return null;
		} else if (inside[i] === '"') {
			let j = i + 1;
			let out = '';
			while (j < inside.length) {
				if (inside[j] === '"' && inside[j-1] !== '\\') return unescapePo(out);
				if (inside[j] === '\\' && j + 1 < inside.length) {
					const esc = inside[j+1];
					if (esc === 'n') out += '\n';
					else if (esc === 't') out += '\t';
					else out += esc;
					j += 2; continue;
				}
				out += inside[j++];
			}
			return null;
		}
		return null;
	}

	const poManager = new POManager(context);
	context.subscriptions.push({ dispose: () => poManager.dispose() } as vscode.Disposable);

	const hoverProvider = vscode.languages.registerHoverProvider('csharp', {
		provideHover(document, position, token) {
			const config = vscode.workspace.getConfiguration('poHover');
			const target = config.get<string>('functionName', 'G');
			if (!target) {
				return undefined;
			}

			const text = document.getText();
			const offset = document.offsetAt(position);

			// escape function name for regex
			const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'g');
			let match: RegExpExecArray | null;
			while ((match = re.exec(text)) !== null) {
				const matchIndex = match.index;
				// find first non-whitespace char after the match
				let i = matchIndex + match[0].length;
				while (i < text.length && /\s/.test(text[i])) i++;
				if (i >= text.length || text[i] !== '(') continue;

				// scan forward to find matching closing paren, supporting nested parens and multi-line
				let depth = 0;
				let j = i;
				for (; j < text.length; j++) {
					const ch = text[j];
					if (ch === '(') depth++;
					else if (ch === ')') {
						depth--;
						if (depth === 0) {
							const startPos = document.positionAt(matchIndex);
							const endPos = document.positionAt(j + 1); // include ')'
							const startOffset = matchIndex;
							const endOffset = j + 1;
							// If hover pos is within the call range, show hover
							if (offset >= startOffset && offset <= endOffset) {
								const inside = text.substring(i + 1, j);
								const msgid = extractFirstStringArgument(inside);
								if (!msgid) return undefined;
								poManager.ensureInitialized();
								const entries = poManager.getTranslations(msgid);
								const hoverLines: string[] = [];
								hoverLines.push('po-dotnet');
							if (entries.length === 0) {
								hoverLines.push('- No entry');
							} else {
								hoverLines.push('');
								for (const e of entries) {
									const fileName = path.basename(e.relativePath);
									const message = e.translation.replace(/`/g, "'");
									const folderPath = path.dirname(e.relativePath) || '.';
									hoverLines.push(`- ${fileName}: \`${message}\` (${folderPath})`);
								}
							}
							const md = new vscode.MarkdownString();
							md.appendMarkdown(hoverLines.join('\n\n'));
								return new vscode.Hover(md, new vscode.Range(startPos, endPos));
							}
							break;
						}
					}
				}
			}

			return undefined;
		}
	});

	context.subscriptions.push(disposable, hoverProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
