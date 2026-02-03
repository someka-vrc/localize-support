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

	// PO manager handles scanning, parsing and watching PO directories (no globs)
	class POManager {
		private cache = new Map<string, Map<string, string>>(); // uri -> map
		private watchers = new Map<string, vscode.FileSystemWatcher>(); // dir -> watcher
		private _onDidChange = new vscode.EventEmitter<void>();
		public readonly onDidChange = this._onDidChange.event;
		constructor(private context: vscode.ExtensionContext) {
		}

		public dispose() {
			for (const w of this.watchers.values()) { w.dispose(); }
			this.watchers.clear();
		}

		public async ensureDirs(dirs: string[], workspaceFolder: vscode.WorkspaceFolder | null) {
			if (!workspaceFolder) return;
			for (const dir of dirs) {
				if (this.watchers.has(dir)) continue;
				// create watcher for the directory
				try {
					const rel = path.relative(workspaceFolder.uri.fsPath, dir).replace(/\\/g, '/');
					const pattern = new vscode.RelativePattern(workspaceFolder, rel + '/**/*.po');
					const watcher = vscode.workspace.createFileSystemWatcher(pattern);
					this.context.subscriptions.push(watcher);
					watcher.onDidCreate(uri => this.readAndParse(uri));
					watcher.onDidChange(uri => this.readAndParse(uri));
					watcher.onDidDelete(uri => { this.cache.delete(uri.toString()); this._onDidChange.fire(); });
					this.watchers.set(dir, watcher);
					// initial scan
					await this.scanDir(dir, workspaceFolder);
				} catch (e) {
					console.error('po-dotnet: failed to watch/scan dir', dir, e);
				}
			}
		}

		private async scanDir(dir: string, workspaceFolder: vscode.WorkspaceFolder) {
			try {
				const rel = path.relative(workspaceFolder.uri.fsPath, dir).replace(/\\/g, '/');
				const pattern = new vscode.RelativePattern(workspaceFolder, rel + '/**/*.po');
				const uris = await vscode.workspace.findFiles(pattern);
				for (const uri of uris) {
					await this.readAndParse(uri);
				}
			} catch (e) {
				console.error('po-dotnet: error scanning dir', dir, e);
			}
		}

		private async readAndParse(uri: vscode.Uri) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const content = new TextDecoder('utf-8').decode(bytes);
				const map = parsePo(content);
				this.cache.set(uri.toString(), map);
				this._onDidChange.fire();
			} catch (e) {
				console.error('Error reading/parsing PO file', uri.toString(), e);
				this.cache.delete(uri.toString());
				this._onDidChange.fire();
			}
		}

		public getEntryStatus(msgid: string) {
			const results: Array<{uri: vscode.Uri, relativePath: string, hasEntry: boolean, translation: string | undefined}> = [];
			for (const [uriStr, map] of this.cache) {
				const uri = vscode.Uri.parse(uriStr);
				const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
				const relativePath = wsFolder ? path.relative(wsFolder.uri.fsPath, uri.fsPath) : uri.fsPath;
				const has = map.has(msgid);
				const translation = has ? map.get(msgid) : undefined;
				results.push({ uri, relativePath, hasEntry: has, translation });
			}
			return results;
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

	// collect podotnetconfig.json files by walking up from the document dir to workspace root
	async function collectConfigsForDocument(documentUri: vscode.Uri) {
		const ws = vscode.workspace.getWorkspaceFolder(documentUri);
		if (!ws) return { sourceDirs: [] as string[], poDirs: [] as string[], workspaceFolder: null };
		const sourceSet = new Set<string>();
		const poSet = new Set<string>();
		let dir = path.dirname(documentUri.fsPath);
		const wsRoot = ws.uri.fsPath;
		while (true) {
			for (const name of ['podotnetconfig.json', 'podotnetconfig~.json']) {
				const cfgUri = vscode.Uri.file(path.join(dir, name));
				try {
					const bytes = await vscode.workspace.fs.readFile(cfgUri);
					const content = new TextDecoder('utf-8').decode(bytes);
					const parsed = JSON.parse(content);
					if (Array.isArray(parsed.sourceDirs)) {
						for (const s of parsed.sourceDirs) {
							const resolved = path.resolve(dir, s);
							sourceSet.add(resolved);
						}
					}
					if (Array.isArray(parsed.poDirs)) {
						for (const p of parsed.poDirs) {
							const resolved = path.resolve(dir, p);
							poSet.add(resolved);
						}
					}
				} catch (e) {
					// no config here or parse error -- ignore
				}
			}
			if (dir === wsRoot) break;
			const parent = path.dirname(dir);
			if (!parent || parent === dir) break;
			dir = parent;
		}
		return { sourceDirs: Array.from(sourceSet), poDirs: Array.from(poSet), workspaceFolder: ws };
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

	function isInComment(text: string, offset: number): boolean {
		let inComment = false;
		let inString = false;
		let i = 0;
		while (i < offset) {
			if (inString) {
				if (text[i] === '"' && (i === 0 || text[i - 1] !== '\\')) {
					inString = false;
				}
			} else if (inComment) {
				if (text[i] === '*' && i + 1 < text.length && text[i + 1] === '/') {
					inComment = false;
					i += 2;
					continue;
				}
			} else {
				if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '/') {
					// Skip to end of line
					while (i < offset && text[i] !== '\n') i++;
					continue;
				} else if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '*') {
					inComment = true;
					i += 2;
					continue;
				} else if (text[i] === '"') {
					inString = true;
				}
			}
			i++;
		}
		return inComment;
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

	// LocalizationChecker: scans source files and reports missing PO entries as diagnostics
	class LocalizationChecker implements vscode.Disposable {
		private diagnostics = vscode.languages.createDiagnosticCollection('po-dotnet');
		private srcWatchers = new Map<string, vscode.FileSystemWatcher>();
		private disposables: vscode.Disposable[] = [];
		// scan/cache state: scanned documents and found msgid call sites
		private scannedDocs = new Set<string>();
		private scanningDocs = new Set<string>();
		private docMsgids = new Map<string, Array<{range: vscode.Range, msgid: string}>>();

		constructor(private context: vscode.ExtensionContext, private poManager: POManager) {
			this.context.subscriptions.push(this.diagnostics);
			this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('poHover.functionName')) this.triggerScan();
			}));
			const configWatcher = vscode.workspace.createFileSystemWatcher('**/podotnetconfig.json');
			this.context.subscriptions.push(configWatcher);
			configWatcher.onDidCreate(()=>this.triggerScan());
			configWatcher.onDidChange(()=>this.triggerScan());
			configWatcher.onDidDelete(()=>this.triggerScan());
			this.disposables.push(this.poManager.onDidChange(()=>this.triggerScan()));
			this.disposables.push(vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e.document)));
			this.triggerScan();
		}

		dispose() {
			this.diagnostics.dispose();
			for (const w of this.srcWatchers.values()) w.dispose();
			this.srcWatchers.clear();
			for (const d of this.disposables) d.dispose();
		}

		private onDocumentChanged(document: vscode.TextDocument) {
			if (document.languageId !== 'csharp') return;
			this.scanDocument(document);
		}

		public isScanned(document: vscode.TextDocument): boolean {
			return this.scannedDocs.has(document.uri.toString());
		}

		public getMsgidAt(document: vscode.TextDocument, offset: number): {msgid: string, range: vscode.Range} | 'scanning' | null {
			const uriStr = document.uri.toString();
			if (this.scanningDocs.has(uriStr)) return 'scanning';
			const entries = this.docMsgids.get(uriStr);
			if (!entries) return null;
			for (const e of entries) {
				const start = document.offsetAt(e.range.start);
				const end = document.offsetAt(e.range.end);
				if (offset >= start && offset <= end) return { msgid: e.msgid, range: e.range };
			}
			return null;
		}

		public async triggerScan() {
			try {
				await this.scanAll();
			} catch (e) {
				console.error('po-dotnet: error during scanAll', e);
			}
		}

		private async scanAll() {
			const cfgUris = await vscode.workspace.findFiles('**/podotnetconfig.json');
			const cfgUrisTilde = await vscode.workspace.findFiles('**/podotnetconfig~.json');
			const allCfgs = cfgUris.concat(cfgUrisTilde);
			const toScan: vscode.Uri[] = [];
			const cfgsByWorkspace = new Map<string, {sourceDirs:string[], poDirs:string[], workspaceFolder: vscode.WorkspaceFolder}[]>();
			for (const cfgUri of allCfgs) {
				const dir = path.dirname(cfgUri.fsPath);
				try {
					const bytes = await vscode.workspace.fs.readFile(cfgUri);
					const content = new TextDecoder('utf-8').decode(bytes);
					const parsed = JSON.parse(content);
					const sourceDirs: string[] = [];
					const poDirs: string[] = [];
					if (Array.isArray(parsed.sourceDirs)) {
						for (const s of parsed.sourceDirs) sourceDirs.push(path.resolve(dir, s));
					}
					if (Array.isArray(parsed.poDirs)) {
						for (const p of parsed.poDirs) poDirs.push(path.resolve(dir, p));
					}
					const ws = vscode.workspace.getWorkspaceFolder(cfgUri);
					if (!ws) continue;
					if (!cfgsByWorkspace.has(ws.uri.toString())) cfgsByWorkspace.set(ws.uri.toString(), []);
					cfgsByWorkspace.get(ws.uri.toString())!.push({ sourceDirs, poDirs, workspaceFolder: ws });
				} catch (e) {
					// ignore
				}
			}

			// clear previous diagnostics
			this.diagnostics.clear();

			for (const [wsKey, cfgList] of cfgsByWorkspace) {
				for (const cfg of cfgList) {
					await this.poManager.ensureDirs(cfg.poDirs, cfg.workspaceFolder);
					for (const sd of cfg.sourceDirs) {
						const rel = path.relative(cfg.workspaceFolder.uri.fsPath, sd).replace(/\\/g, '/');
						const pattern = new vscode.RelativePattern(cfg.workspaceFolder, rel + '/**/*.cs');
						const uris = await vscode.workspace.findFiles(pattern);
						for (const uri of uris) {
							toScan.push(uri);
							if (!this.srcWatchers.has(sd)) {
								const watcher = vscode.workspace.createFileSystemWatcher(pattern);
								this.context.subscriptions.push(watcher);
								watcher.onDidCreate(u => this.triggerScan());
								watcher.onDidChange(u => this.triggerScan());
								watcher.onDidDelete(u => this.triggerScan());
								this.srcWatchers.set(sd, watcher);
							}
						}
					}
				}
			}

			for (const uri of toScan) {
				try {
					const doc = await vscode.workspace.openTextDocument(uri);
					await this.scanDocument(doc);
				} catch (e) {
					// ignore
				}
			}
		}

		private async scanDocument(document: vscode.TextDocument) {
			if (document.languageId !== 'csharp') return;
			const uriStr = document.uri.toString();
			this.scanningDocs.add(uriStr);
			const text = document.getText();
			const target = vscode.workspace.getConfiguration('poHover').get<string>('functionName', 'G') || 'G';
			const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
			const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'g');
			let match: RegExpExecArray | null;
			const diags: vscode.Diagnostic[] = [];
			const entries: Array<{range: vscode.Range, msgid: string}> = [];
			while ((match = re.exec(text)) !== null) {
				const matchIndex = match.index;
				let i = matchIndex + match[0].length;
				while (i < text.length && /\\s/.test(text[i])) i++;
				if (i >= text.length || text[i] !== '(') continue;
				let depth = 0;
				let j = i;
				for (; j < text.length; j++) {
					const ch = text[j];
					if (ch === '(') depth++;
					else if (ch === ')') {
						depth--;
						if (depth === 0) {
							const inside = text.substring(i + 1, j);
							const msgid = extractFirstStringArgument(inside);
							if (!msgid) break;
							entries.push({ range: new vscode.Range(document.positionAt(matchIndex), document.positionAt(j + 1)), msgid });
							const statuses = this.poManager.getEntryStatus(msgid);
							if (statuses.length === 0) break;
							const missingList = statuses.filter(s => !s.hasEntry || (s.translation !== undefined && s.translation.trim() === '')).map(s => s.relativePath);
							if (missingList.length > 0) {
								const startPos = document.positionAt(matchIndex);
								const endPos = document.positionAt(j + 1);
								const message = `po-dotnet: missing PO entries: ${missingList.join(', ')}`;
								const diag = new vscode.Diagnostic(new vscode.Range(startPos, endPos), message, vscode.DiagnosticSeverity.Warning);
								diag.source = 'po-dotnet';
								diags.push(diag);
							}
							break;
						}
					}
				}
			}
			if (diags.length > 0) this.diagnostics.set(document.uri, diags);
			else this.diagnostics.delete(document.uri);
			this.docMsgids.set(uriStr, entries);
			this.scanningDocs.delete(uriStr);
			this.scannedDocs.add(uriStr);
		}
	}

	const localizationChecker = new LocalizationChecker(context, poManager);
	context.subscriptions.push(localizationChecker);

	const hoverProvider = vscode.languages.registerHoverProvider('csharp', {
		async provideHover(document, position, token) {
			const config = vscode.workspace.getConfiguration('poHover');
			const target = config.get<string>('functionName', 'G');
			if (!target) {
				return undefined;
			}

			const text = document.getText();
			const offset = document.offsetAt(position);

			// Check if the position is inside a comment
			if (isInComment(text, offset)) {
				return undefined;
			}

		// Use cached scan results if available
		const cached = localizationChecker.getMsgidAt(document, offset);
		if (cached === 'scanning') {
			const md = new vscode.MarkdownString();
			md.appendMarkdown('po-dotnet\n\nScanning...');
			return new vscode.Hover(md);
		} else if (cached) {
			const msgid = cached.msgid;
			const startPos = cached.range.start;
			const endPos = cached.range.end;
			const cfg = await collectConfigsForDocument(document.uri);
			if (cfg.sourceDirs.length === 0) return undefined;
			const docPath = document.uri.fsPath;
			const included = cfg.sourceDirs.some(sd => docPath === sd || docPath.startsWith(sd + path.sep));
			if (!included) return undefined;
			await poManager.ensureDirs(cfg.poDirs, cfg.workspaceFolder);
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
		}		const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');			const re = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'g');
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
								const cfg = await collectConfigsForDocument(document.uri);
								if (cfg.sourceDirs.length === 0) return undefined; // no config found
								const docPath = document.uri.fsPath;
								const included = cfg.sourceDirs.some(sd => docPath === sd || docPath.startsWith(sd + path.sep));
								if (!included) return undefined;
								await poManager.ensureDirs(cfg.poDirs, cfg.workspaceFolder);
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
