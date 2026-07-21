/**
 * File Explorer - browse files from any session, then download or edit them.
 *
 * Available everywhere (global extension):
 *   /files [path]   - open the explorer modal (optionally starting at path)
 *   ctrl+o          - keyboard shortcut to open it
 *
 * In the modal:
 *   up/down     navigate        enter  open dir / pick file
 *   left/bksp   parent dir      .      toggle hidden files
 *   esc         close
 *
 * Picking a file offers: Edit (in-TUI editor, saved back) or
 * Download (copies the file to ~/Downloads).
 */

import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

interface Entry {
	name: string;
	isDir: boolean;
}

class FileExplorer {
	private dir: string;
	private entries: Entry[] = [];
	private selected = 0;
	private scroll = 0;
	private showHidden = false;
	private error?: string;
	private readonly maxRows = 15;

	constructor(
		startDir: string,
		private theme: any,
		private tui: any,
		private done: (result: { path: string } | null) => void,
	) {
		this.dir = startDir;
		void this.load();
	}

	private async load(): Promise<void> {
		try {
			const names = await readdir(this.dir, { withFileTypes: true });
			const list = names
				.filter((d) => this.showHidden || !d.name.startsWith("."))
				.map((d) => ({ name: d.name, isDir: d.isDirectory() }))
				.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
			this.entries = [{ name: "..", isDir: true }, ...list];
			this.error = undefined;
		} catch (err: any) {
			this.entries = [{ name: "..", isDir: true }];
			this.error = String(err?.message ?? err);
		}
		this.selected = 0;
		this.scroll = 0;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.done(null);
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.selected = Math.max(0, this.selected - 1);
		} else if (matchesKey(data, Key.down)) {
			this.selected = Math.min(this.entries.length - 1, this.selected + 1);
		} else if (matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) {
			this.dir = dirname(this.dir);
			void this.load();
			return;
		} else if (data === ".") {
			this.showHidden = !this.showHidden;
			void this.load();
			return;
		} else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
			const entry = this.entries[this.selected];
			if (!entry) return;
			if (entry.name === "..") {
				this.dir = dirname(this.dir);
				void this.load();
				return;
			}
			const full = join(this.dir, entry.name);
			if (entry.isDir) {
				this.dir = full;
				void this.load();
				return;
			}
			this.done({ path: full });
			return;
		}
		// keep selection visible
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + this.maxRows) this.scroll = this.selected - this.maxRows + 1;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const t = this.theme;
		const border = new DynamicBorder((s: string) => t.fg("borderAccent", s)).render(width);
		const lines: string[] = [...border];
		lines.push(truncateToWidth(" " + t.fg("accent", t.bold("File Explorer ")) + t.fg("muted", this.dir), width));
		if (this.error) lines.push(truncateToWidth(" " + t.fg("error", this.error), width));

		const visible = this.entries.slice(this.scroll, this.scroll + this.maxRows);
		for (let i = 0; i < visible.length; i++) {
			const idx = this.scroll + i;
			const e = visible[i]!;
			const icon = e.isDir ? "📁 " : "📄 ";
			const name = e.isDir && e.name !== ".." ? e.name + "/" : e.name;
			const sel = idx === this.selected;
			const prefix = sel ? t.fg("accent", "❯ ") : "  ";
			const label = sel ? t.fg("accent", icon + name) : icon + t.fg(e.isDir ? "text" : "muted", name);
			lines.push(truncateToWidth(" " + prefix + label, width));
		}
		if (this.entries.length > this.scroll + this.maxRows) {
			lines.push(truncateToWidth(t.fg("dim", `   … ${this.entries.length - this.scroll - this.maxRows} more`), width));
		}
		lines.push(
			truncateToWidth(
				" " + t.fg("dim", "↑↓ navigate • enter open/pick • ←/bksp up • . hidden • esc close"),
				width,
			),
		);
		lines.push(...new DynamicBorder((s: string) => t.fg("borderAccent", s)).render(width));
		return lines;
	}

	invalidate(): void {}
}

async function downloadFile(path: string, ctx: ExtensionCommandContext): Promise<void> {
	const downloads = join(homedir(), "Downloads");
	await mkdir(downloads, { recursive: true });
	const ext = extname(path);
	const base = basename(path, ext);
	let target = join(downloads, basename(path));
	for (let i = 1; ; i++) {
		try {
			await stat(target);
			target = join(downloads, `${base} (${i})${ext}`);
		} catch {
			break; // does not exist -> use it
		}
	}
	await copyFile(path, target);
	ctx.ui.notify(`Downloaded to ${target}`, "info");
}

async function editFile(path: string, ctx: ExtensionCommandContext): Promise<void> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (err: any) {
		ctx.ui.notify(`Cannot read file: ${err?.message ?? err}`, "error");
		return;
	}
	const edited = await ctx.ui.editor(`Edit ${basename(path)}`, content);
	if (edited === undefined || edited === content) {
		ctx.ui.notify("No changes saved", "info");
		return;
	}
	await writeFile(path, edited, "utf8");
	ctx.ui.notify(`Saved ${path}`, "info");
}

async function openExplorer(startPath: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("File explorer requires interactive (TUI) mode", "warning");
		return;
	}
	let dir = resolve(ctx.cwd, startPath?.trim() || ".");
	try {
		if (!(await stat(dir)).isDirectory()) dir = dirname(dir);
	} catch {
		dir = ctx.cwd;
	}

	// Loop so "back/cancel" from the action menu returns to the explorer.
	for (;;) {
		const picked = await ctx.ui.custom<{ path: string } | null>(
			(tui, theme, _kb, done) => new FileExplorer(dir, theme, tui, done),
			{ overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 50 } },
		);
		if (!picked) return;

		dir = dirname(picked.path); // reopen where we left off
		const action = await ctx.ui.select(basename(picked.path), [
			"Edit file",
			"Download (copy to ~/Downloads)",
			"Back to explorer",
		]);
		try {
			if (action === "Edit file") {
				await editFile(picked.path, ctx);
				return;
			}
			if (action?.startsWith("Download")) {
				await downloadFile(picked.path, ctx);
				return;
			}
		} catch (err: any) {
			ctx.ui.notify(`Error: ${err?.message ?? err}`, "error");
			return;
		}
		if (action === undefined) return; // esc from menu closes everything
		// "Back to explorer" -> loop again
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("files", {
		description: "Open the file explorer modal (download or edit any file)",
		handler: async (args, ctx) => {
			await openExplorer(args, ctx);
		},
	});

	pi.registerShortcut("ctrl+o", {
		description: "Open file explorer",
		handler: async (ctx) => {
			await openExplorer(undefined, ctx as ExtensionCommandContext);
		},
	});
}
