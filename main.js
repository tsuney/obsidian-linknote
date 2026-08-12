'use strict';

/*
 * Linknote
 * ---------------------------------------------------------------------------
 * Write a side note while reading, save it as its own note, and leave a small
 * link (plus a block ID) at the exact spot in the source note.
 *
 * The only non-trivial part is mapping a selection in Reading view back to a
 * position in the Markdown source. That is done with the public API
 * MarkdownPostProcessorContext.getSectionInfo().
 *
 * No build step: this is plain CommonJS.
 */

const obsidian = require('obsidian');
const {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  Platform,
  TFile,
  normalizePath,
} = obsidian;

/* --------------------------------------------------------------------------
 * Templates
 * ------------------------------------------------------------------------ */

const DEFAULT_NOTE_TEMPLATE = `---
created: {{date}}
source: "{{source}}"
---

# {{title}}

{{embed}}

{{body}}
`;

const QUOTED_NOTE_TEMPLATE = `---
created: {{date}}
source: "{{source}}"
---

# {{title}}

{{embed}}

> [!quote] Selected text
{{selectionQuote}}

{{body}}
`;

const DETAILED_NOTE_TEMPLATE = `---
type: linknote
summary: "{{summary}}"
tags:
  - linknote
created: {{date}}
author:
  - {{author}}
source: "{{source}}"
---

# {{title}}

## 1. Context

{{embed}}

> [!quote] Selected text
{{selectionQuote}}

## 2. Note

{{body}}

## 3. Source

{{source}}, block \`^{{blockId}}\`, as of {{date}}.
`;

/**
 * Starting points offered in the settings tab. They are deliberately plain:
 * pick the closest one and rewrite it in whatever language you write in.
 */
const TEMPLATE_PRESETS = [
  {
    name: 'Minimal — source embed and your note',
    template: DEFAULT_NOTE_TEMPLATE,
  },
  {
    name: 'With the quoted selection',
    template: QUOTED_NOTE_TEMPLATE,
  },
  {
    name: 'Detailed — properties, sections, source line',
    template: DETAILED_NOTE_TEMPLATE,
  },
];

const DEFAULT_SETTINGS = {
  folder: 'Linknotes',
  filenameTemplate: '{{title}}_{{date}}',
  dateFormat: 'YYYY-MM-DD',
  noteTemplate: DEFAULT_NOTE_TEMPLATE,
  marker: '†',
  useBlockId: true,
  useInlineLink: true,
  showFloatingButton: true,
  openAfterCreate: false,
  author: '',
};

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Minimal date formatter. Supports YYYY, YY, MMMM, MMM, MM, DD, dddd, ddd,
 * HH, mm, ss. Longer tokens are matched first so MM inside MMMM is safe.
 */
function formatDate(date, fmt) {
  const p = (n, w) => String(n).padStart(w || 2, '0');
  const map = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTHS[date.getMonth()],
    MMM: MONTHS[date.getMonth()].slice(0, 3),
    MM: p(date.getMonth() + 1),
    DD: p(date.getDate()),
    dddd: WEEKDAYS[date.getDay()],
    ddd: WEEKDAYS[date.getDay()].slice(0, 3),
    HH: p(date.getHours()),
    mm: p(date.getMinutes()),
    ss: p(date.getSeconds()),
  };
  return String(fmt || 'YYYY-MM-DD').replace(
    /YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|HH|mm|ss/g,
    (t) => map[t]
  );
}

/** Replaces {{name}} placeholders. Unknown placeholders are left untouched. */
function renderTemplate(template, vars) {
  return String(template).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
  );
}

/** Collapses the blank runs left behind by empty placeholders. */
function tidy(text) {
  return String(text).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
}

function randomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < (len || 6); i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Strips characters that are illegal in file names or break wikilinks.
 * Length is handled separately: truncating here would cut whatever the
 * filename template puts last, such as the date.
 */
function sanitizeFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
}

/** How much of the title a filename may carry, and how long the name may get. */
const FILENAME_TITLE_MAX_CHARS = 50;
const FILENAME_MAX_BYTES = 180;

/** Cuts to at most `max` characters, backing off to a word boundary. */
function clampChars(text, max) {
  const value = String(text);
  if (value.length <= max) return value;

  const cut = value.slice(0, max);
  // Only back off when the cut landed inside a word.
  if (!/\S/.test(value.charAt(max))) return cut.trim();

  const onBoundary = cut.replace(/\s+\S*$/, '').trim();
  return (onBoundary.length >= max * 0.6 ? onBoundary : cut).trim();
}

function utf8Size(ch) {
  const c = ch.codePointAt(0);
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c < 0x10000) return 3;
  return 4;
}

/**
 * Cuts so the UTF-8 encoding fits in `maxBytes`. File systems limit a path
 * component by bytes, and Japanese runs three bytes per character.
 */
function clampBytes(text, maxBytes) {
  let bytes = 0;
  let out = '';
  for (const ch of String(text)) {
    const size = utf8Size(ch);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += ch;
  }
  return out.trim();
}

/** Stand-in values so the settings tab can show what a filename will look like. */
function sampleFilenameVars(settings, now) {
  return {
    title: 'Quarterly close',
    body: '',
    selection: 'the tenth business day',
    selectionQuote: '> the tenth business day',
    source: '[[Team handbook]]',
    sourceName: 'Team handbook',
    sourcePath: 'Team handbook.md',
    embed: '',
    blockId: 'k3n8v1',
    date: formatDate(now || new Date(), settings.dateFormat),
    time: formatDate(now || new Date(), 'HH:mm'),
    author: settings.author || '',
    summary: 'Team handbook — the tenth business day',
  };
}

/** What the current filename template produces, for display in settings. */
function previewFilename(settings, now) {
  const vars = sampleFilenameVars(settings, now);
  vars.title = clampChars(sanitizeFileName(vars.title), FILENAME_TITLE_MAX_CHARS);
  const name = clampBytes(sanitizeFileName(renderTemplate(settings.filenameTemplate, vars)), FILENAME_MAX_BYTES);
  return (settings.folder ? settings.folder + '/' : '') + (name || 'Untitled') + '.md';
}

const BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;

/* --------------------------------------------------------------------------
 * Anchoring (pure functions — covered by tests)
 * ------------------------------------------------------------------------ */

/**
 * Returns the block source with a link marker and/or block ID appended.
 * Headings, tables, code blocks and math blocks get their anchor on the
 * following line, because appending inline would break the syntax.
 */
function buildAnchoredBlock(blockSrc, link, blockId) {
  const lines = blockSrc.split('\n');

  let last = lines.length - 1;
  while (last > 0 && lines[last].trim() === '') last--;
  const lastLine = lines[last];
  const firstLine = (lines.find((l) => l.trim() !== '') || '').trim();

  const isHeading = /^#{1,6}\s/.test(firstLine);
  const isCodeFence = /^(```|~~~)/.test(firstLine);
  const isMathBlock = /^\$\$/.test(firstLine);
  const isTable = /^\s*\|/.test(lastLine);
  const needsOwnLine = isHeading || isCodeFence || isMathBlock || isTable;

  if (needsOwnLine) {
    const tail = [link, blockId ? '^' + blockId : ''].filter(Boolean).join(' ');
    if (!tail) return blockSrc;
    return blockSrc.replace(/\s*$/, '') + '\n\n' + tail;
  }

  // A block ID already on this line must survive: other notes may reference it.
  const found = lastLine.match(BLOCK_ID_RE);
  const keepId = blockId || (found ? found[1] : '');
  const tail = [link, keepId ? '^' + keepId : ''].filter(Boolean).join(' ');
  if (!tail) return blockSrc;

  const base = lastLine.replace(BLOCK_ID_RE, '');
  lines[last] = base.replace(/\s+$/, '') + ' ' + tail;
  return lines.join('\n');
}

const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Reading view hands back rendered text, which has lost its inline markup:
 * `code`, **bold**, [[wikilinks]] and [text](links) all read differently in
 * the source. Reduce both sides to a comparable form before matching. The
 * result is only ever used for comparison, never written back.
 */
function normalizeInline(text) {
  return String(text)
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX\-\/]\]\s*)?/, '')
    .replace(/`+/g, '')
    .replace(/(\*\*|__|~~|==)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * getSectionInfo() treats a whole list — bullets, numbers, task lines — as one
 * block, so anchoring it verbatim would land on the last item rather than the
 * one that was selected. When exactly one list line contains the selection,
 * narrow the block down to that line.
 */
function narrowToListItem(blockSrc, selection) {
  const lines = blockSrc.split('\n');
  if (lines.length < 2) return blockSrc;

  const matches = listItemMatches(blockSrc, selection);
  return matches.length === 1 ? matches[0] : blockSrc;
}

/** List lines within a block that contain the selection. */
function listItemMatches(blockSrc, selection) {
  const raw = String(selection || '').split('\n')[0].trim();
  if (!raw) return [];
  const needle = normalizeInline(raw);
  if (!needle) return [];
  return blockSrc
    .split('\n')
    .filter((l) => LIST_MARKER_RE.test(l) && normalizeInline(l).indexOf(needle) !== -1);
}

/**
 * Last-resort locator: find the block containing an exact, unique occurrence
 * of the selected text, delimited by blank lines. Returns '' when the text is
 * missing or appears more than once.
 */
function findBlockContaining(content, needle) {
  if (!needle) return '';

  const first = content.indexOf(needle);
  if (first !== -1 && content.indexOf(needle, first + needle.length) === -1) {
    return blockAround(content, first, needle.length);
  }

  // The selection came from rendered text, so inline markup will not match
  // verbatim. Fall back to a normalised, line-by-line search.
  const target = normalizeInline(String(needle).split('\n')[0]);
  if (!target) return '';

  const lines = content.split('\n');
  let hit = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() && normalizeInline(lines[i]).indexOf(target) !== -1) {
      if (hit !== -1) return '';
      hit = i;
    }
  }
  if (hit === -1) return '';
  if (LIST_MARKER_RE.test(lines[hit])) return lines[hit];

  const offset = lines.slice(0, hit).join('\n').length + (hit ? 1 : 0);
  return blockAround(content, offset, lines[hit].length);
}

/** Expands an offset range out to its blank-line-delimited block. */
function blockAround(content, at, len) {
  let start = content.lastIndexOf('\n\n', at);
  start = start === -1 ? 0 : start + 2;
  let end = content.indexOf('\n\n', at + len);
  end = end === -1 ? content.length : end;
  return content.slice(start, end).replace(/\s+$/, '');
}

/** Reads an existing block ID off the end of a block, or null. */
function existingBlockId(blockSrc) {
  const lines = blockSrc.split('\n');
  let last = lines.length - 1;
  while (last > 0 && lines[last].trim() === '') last--;
  const m = lines[last].match(BLOCK_ID_RE);
  return m ? m[1] : null;
}

/* --------------------------------------------------------------------------
 * Plugin
 * ------------------------------------------------------------------------ */

class LinknotePlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    /** rendered element -> MarkdownPostProcessorContext */
    this.ctxMap = new WeakMap();
    this.snapshot = null;
    this.floatBtn = null;
    this.hookedDocs = new WeakSet();

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.ctxMap.set(el, ctx);
    });

    this.addCommand({
      id: 'create-from-selection',
      name: 'Create linknote from selection',
      callback: () => this.openComposer(this.captureSelectionAnywhere() || this.snapshot),
    });

    this.addSettingTab(new LinknoteSettingTab(this.app, this));

    // Popout windows have their own document, so listeners are per window.
    this.hookDocument(document);
    this.app.workspace.onLayoutReady(() => this.hookAllOpenDocuments());

    this.registerEvent(
      this.app.workspace.on('window-open', (workspaceWindow, win) => {
        const doc = (win && win.document) || (workspaceWindow && workspaceWindow.doc);
        if (doc) this.hookDocument(doc);
      })
    );
    this.registerEvent(
      this.app.workspace.on('window-close', (workspaceWindow, win) => {
        const doc = (win && win.document) || (workspaceWindow && workspaceWindow.doc);
        if (this.floatBtn && this.floatBtn.doc === doc) this.floatBtn = null;
      })
    );
    this.registerEvent(this.app.workspace.on('layout-change', () => this.hookAllOpenDocuments()));
  }

  onunload() {
    this.hideFloatingButton();
  }

  /* ------------------------------------------------------------- settings */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) || {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /* -------------------------------------------------- per-window listeners */

  hookAllOpenDocuments() {
    this.hookDocument(document);
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const doc = leaf && leaf.view && leaf.view.containerEl && leaf.view.containerEl.ownerDocument;
        if (doc) this.hookDocument(doc);
      });
    } catch (e) {
      console.error('[Linknote] hookAllOpenDocuments', e);
    }
  }

  hookDocument(doc) {
    if (!doc || this.hookedDocs.has(doc)) return;
    this.hookedDocs.add(doc);

    const onSelectionEnd = () => {
      const win = doc.defaultView || window;
      win.setTimeout(() => this.refreshFloatingButton(doc), 0);
    };
    this.registerDomEvent(doc, 'mouseup', onSelectionEnd);
    this.registerDomEvent(doc, 'touchend', onSelectionEnd);

    this.registerDomEvent(doc, 'mousedown', (evt) => {
      if (this.floatBtn && evt.target !== this.floatBtn.el) this.hideFloatingButton();
    });
    this.registerDomEvent(doc, 'keydown', (evt) => {
      if (evt.key === 'Escape') this.hideFloatingButton();
    });
  }

  /* ------------------------------------------------------------ selection */

  /** Finds a Reading-view selection in the focused window, then any window. */
  captureSelectionAnywhere() {
    const docs = [];
    if (typeof activeDocument !== 'undefined' && activeDocument) docs.push(activeDocument);
    if (docs.indexOf(document) === -1) docs.push(document);
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const d = leaf && leaf.view && leaf.view.containerEl && leaf.view.containerEl.ownerDocument;
        if (d && docs.indexOf(d) === -1) docs.push(d);
      });
    } catch (e) {
      /* ignore */
    }
    for (const doc of docs) {
      const snap = this.captureSelection(doc);
      if (snap) return snap;
    }
    return null;
  }

  captureSelection(doc) {
    const targetDoc = doc || document;
    const win = targetDoc.defaultView;
    if (!win) return null;

    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    const text = sel.toString().trim();
    if (!text) return null;

    const range = sel.getRangeAt(0);
    let el = range.startContainer;
    if (el && el.nodeType === 3) el = el.parentElement; // 3 = TEXT_NODE
    if (!el || !el.closest) return null;
    // Reading view only. Live Preview is already editable.
    if (!el.closest('.markdown-preview-view')) return null;

    let cur = el;
    let ctx = null;
    let ctxEl = null;
    while (cur) {
      if (this.ctxMap.has(cur)) {
        ctx = this.ctxMap.get(cur);
        ctxEl = cur;
        break;
      }
      cur = cur.parentElement;
    }
    if (!ctx || !ctx.sourcePath) return null;

    const snap = {
      text,
      ctx,
      ctxEl,
      doc: targetDoc,
      sourcePath: ctx.sourcePath,
      rect: range.getBoundingClientRect(),
      // Grab the source of the block right now. Reading view re-renders on
      // focus changes and on external file edits, and a recycled element
      // makes getSectionInfo() return null. Since the write-back locates the
      // block by matching this text rather than by line number, capturing it
      // early costs nothing and survives a re-render.
      blockSrc: this.readBlockSource(ctx, ctxEl),
    };
    this.snapshot = snap;
    return snap;
  }

  /** Source text of the block behind a rendered element, or '' if unavailable. */
  readBlockSource(ctx, ctxEl) {
    try {
      const info = ctx.getSectionInfo(ctxEl);
      if (!info || typeof info.text !== 'string') return '';
      return info.text.split('\n').slice(info.lineStart, info.lineEnd + 1).join('\n');
    } catch (e) {
      return '';
    }
  }

  /* ------------------------------------------------------- floating button */

  refreshFloatingButton(doc) {
    if (!this.settings.showFloatingButton) return;
    const snap = this.captureSelection(doc);
    if (!snap) {
      this.hideFloatingButton();
      return;
    }
    this.showFloatingButton(snap.doc, snap.rect);
  }

  showFloatingButton(doc, rect) {
    if (this.floatBtn && this.floatBtn.doc !== doc) this.hideFloatingButton();

    if (!this.floatBtn) {
      const btn = doc.createElement('button');
      btn.className = 'lkn-float-btn';
      btn.textContent = this.settings.marker + ' Linknote';
      // Keep the selection alive when the button is pressed.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const snap = this.snapshot;
        this.hideFloatingButton();
        this.openComposer(snap);
      });
      doc.body.appendChild(btn);
      this.floatBtn = { el: btn, doc };
    }

    const win = doc.defaultView || window;
    const btn = this.floatBtn.el;
    // On mobile the OS selection menu sits above the selection, so stay below.
    const gap = Platform.isMobile ? 12 : 6;
    const top = Math.min(rect.bottom + gap, win.innerHeight - 48);
    const left = Math.min(Math.max(rect.left, 8), win.innerWidth - 120);
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
    btn.style.display = 'block';
  }

  hideFloatingButton() {
    if (this.floatBtn) {
      if (this.floatBtn.el) this.floatBtn.el.remove();
      this.floatBtn = null;
    }
  }

  /* -------------------------------------------------------------- composer */

  openComposer(snap) {
    if (!snap) {
      new Notice('Select some text in Reading view first.');
      return;
    }
    new LinknoteModal(this.app, this, snap, async (values) => {
      try {
        const file = await this.createLinknote(snap, values);
        new Notice('Linknote created: ' + file.basename);
        if (this.settings.openAfterCreate) {
          await this.app.workspace.getLeaf('split').openFile(file);
        }
      } catch (err) {
        console.error('[Linknote]', err);
        new Notice('Could not create the linknote: ' + (err && err.message ? err.message : err));
      }
    }).open();
  }

  /* ------------------------------------------------------------------ core */

  async createLinknote(snap, values) {
    const app = this.app;
    const s = this.settings;

    const sourceFile = app.vault.getAbstractFileByPath(snap.sourcePath);
    if (!(sourceFile instanceof TFile)) {
      throw new Error('the source note could not be resolved');
    }

    const currentContent = await app.vault.read(sourceFile);

    // Prefer the block captured when the selection was made. Fall back to
    // asking again (the element may still be live), then to locating the
    // selected text directly in the file.
    let blockSrc = snap.blockSrc || '';
    if (!blockSrc) blockSrc = this.readBlockSource(snap.ctx, snap.ctxEl);
    if (!blockSrc) blockSrc = findBlockContaining(currentContent, snap.text);
    // Several identical list items would otherwise anchor the last one.
    if (blockSrc.split('\n').length > 1 && listItemMatches(blockSrc, snap.text).length > 1) {
      throw new Error('several list items share this exact text, so the position is ambiguous');
    }
    blockSrc = narrowToListItem(blockSrc, snap.text);
    if (!blockSrc.trim()) {
      throw new Error(
        'the position in the source could not be determined; scroll the passage back into view, reselect it and retry'
      );
    }

    const firstAt = currentContent.indexOf(blockSrc);
    if (firstAt === -1) {
      throw new Error('the source note has changed; refresh the view and retry');
    }
    if (currentContent.indexOf(blockSrc, firstAt + 1) !== -1) {
      throw new Error('several blocks share this exact text, so the position is ambiguous');
    }

    let blockId = existingBlockId(blockSrc);
    const isNewId = !blockId;
    if (s.useBlockId && !blockId) {
      do {
        blockId = randomId(6);
      } while (currentContent.includes('^' + blockId));
    }

    // The note is written first, because the marker needs a link to it.
    const noteFile = await this.writeLinknote(sourceFile, snap, values, s.useBlockId ? blockId : null);

    const link = s.useInlineLink
      ? app.fileManager.generateMarkdownLink(noteFile, sourceFile.path, undefined, s.marker)
      : '';
    const idToWrite = s.useBlockId && isNewId ? blockId : '';
    const anchored = buildAnchoredBlock(blockSrc, link, idToWrite);

    if (anchored !== blockSrc) {
      await this.processFile(sourceFile, (data) => {
        const at = data.indexOf(blockSrc);
        if (at === -1) return data;
        return data.slice(0, at) + anchored + data.slice(at + blockSrc.length);
      });
    }

    return noteFile;
  }

  async writeLinknote(sourceFile, snap, values, blockId) {
    const app = this.app;
    const s = this.settings;
    const now = new Date();

    const rawTitle = (values.title || snap.text).trim().replace(/\s+/g, ' ');

    await this.ensureFolder(s.folder);

    // A provisional path is enough to generate links relative to the folder.
    const provisional = normalizePath(`${s.folder}/tmp.md`);
    const source = app.fileManager.generateMarkdownLink(sourceFile, provisional);
    const embed = blockId
      ? '!' + app.fileManager.generateMarkdownLink(sourceFile, provisional, '#^' + blockId)
      : '';

    const excerpt = snap.text.replace(/\s+/g, ' ').slice(0, 40);
    const vars = {
      title: rawTitle,
      body: (values.body || '').trim(),
      selection: snap.text,
      selectionQuote: snap.text.split('\n').map((l) => '> ' + l).join('\n'),
      source,
      sourceName: sourceFile.basename,
      sourcePath: sourceFile.path,
      embed,
      blockId: blockId || '',
      date: formatDate(now, s.dateFormat),
      time: formatDate(now, 'HH:mm'),
      author: s.author,
      summary: sourceFile.basename + ' — ' + excerpt + (snap.text.length > 40 ? '…' : ''),
    };

    // Shorten the title before the name is assembled, so that whatever the
    // template puts after it — a date, say — survives intact.
    const fileVars = Object.assign({}, vars, {
      title: clampChars(sanitizeFileName(rawTitle), FILENAME_TITLE_MAX_CHARS),
    });
    const fileName =
      clampBytes(sanitizeFileName(renderTemplate(s.filenameTemplate, fileVars)), FILENAME_MAX_BYTES) ||
      clampChars(sanitizeFileName(rawTitle), FILENAME_TITLE_MAX_CHARS) ||
      'Untitled';
    const path = this.uniquePath(normalizePath(`${s.folder}/${fileName}.md`));
    const content = tidy(renderTemplate(s.noteTemplate, vars));

    return await app.vault.create(path, content);
  }

  /* ----------------------------------------------------------------- utils */

  async ensureFolder(folder) {
    const clean = normalizePath(folder);
    if (!clean || clean === '/') return;
    let acc = '';
    for (const part of clean.split('/')) {
      acc = acc ? acc + '/' + part : part;
      if (!this.app.vault.getAbstractFileByPath(acc)) {
        try {
          await this.app.vault.createFolder(acc);
        } catch (e) {
          /* races are fine */
        }
      }
    }
  }

  uniquePath(path) {
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const base = path.replace(/\.md$/, '');
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(`${base}-${n}.md`)) n++;
    return `${base}-${n}.md`;
  }

  async processFile(file, fn) {
    if (typeof this.app.vault.process === 'function') {
      return await this.app.vault.process(file, fn);
    }
    const data = await this.app.vault.read(file);
    const next = fn(data);
    if (next !== data) await this.app.vault.modify(file, next);
    return next;
  }
}

/* --------------------------------------------------------------------------
 * Composer modal
 * ------------------------------------------------------------------------ */

class LinknoteModal extends Modal {
  constructor(app, plugin, snap, onSubmit) {
    super(app);
    this.plugin = plugin;
    this.snap = snap;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('lkn-modal');
    contentEl.empty();

    contentEl.createEl('h3', { text: 'New linknote' });

    const quote = contentEl.createDiv({ cls: 'lkn-quote' });
    quote.setText(this.snap.text.length > 400 ? this.snap.text.slice(0, 400) + '…' : this.snap.text);

    contentEl.createDiv({ cls: 'lkn-label', text: 'Title (optional)' });
    const titleInput = contentEl.createEl('input', { cls: 'lkn-title', type: 'text' });
    titleInput.placeholder = 'Untitled';
    // Prefilled so it is obvious that the title is yours to shorten.
    titleInput.value = clampChars(
      this.snap.text.replace(/\s+/g, ' ').trim(),
      FILENAME_TITLE_MAX_CHARS
    );

    contentEl.createDiv({ cls: 'lkn-label', text: 'Note' });
    const bodyInput = contentEl.createEl('textarea', { cls: 'lkn-body' });
    bodyInput.placeholder = 'Markdown is supported.';

    const buttons = contentEl.createDiv({ cls: 'lkn-buttons' });
    if (!Platform.isMobile) {
      const mod = Platform.isMacOS ? '⌘' : 'Ctrl';
      buttons.createDiv({ cls: 'lkn-hint', text: `Save with ${mod} + Enter` });
    } else {
      buttons.createDiv({ cls: 'lkn-hint' });
    }

    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());

    const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta' });
    const submit = () => {
      const values = { title: titleInput.value, body: bodyInput.value };
      this.close();
      this.onSubmit(values);
    };
    save.addEventListener('click', submit);

    contentEl.addEventListener('keydown', (evt) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
        evt.preventDefault();
        submit();
      }
    });

    // Auto-focus fights the on-screen keyboard on mobile.
    if (!Platform.isMobile) window.setTimeout(() => bodyInput.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* --------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------ */

const TEMPLATE_VARIABLES = [
  ['{{title}}', 'the title you typed, or the start of the selection'],
  ['{{body}}', 'the note you typed'],
  ['{{selection}}', 'the selected text'],
  ['{{selectionQuote}}', 'the selected text, every line prefixed with "> "'],
  ['{{source}}', 'link to the source note'],
  ['{{sourceName}}', 'name of the source note'],
  ['{{sourcePath}}', 'path of the source note'],
  ['{{embed}}', 'embed of the anchored block, empty when block IDs are off'],
  ['{{blockId}}', 'the block ID, without the caret'],
  ['{{date}}', 'creation date, using the date format below'],
  ['{{time}}', 'creation time, as HH:mm'],
  ['{{author}}', 'the author set below'],
  ['{{summary}}', 'source note name and a short excerpt'],
];

class LinknoteSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Linknote folder')
      .setDesc('Where new linknotes are created. Created if missing. Default: ' + DEFAULT_SETTINGS.folder)
      .addText((t) =>
        t.setValue(s.folder).onChange(async (v) => {
          s.folder = v.trim() || DEFAULT_SETTINGS.folder;
          if (typeof renderPreview === 'function') renderPreview();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Filename template')
      .setDesc(
        'Template variables are listed below. The .md extension is added for you. ' +
          '{{title}} is shortened to ' + FILENAME_TITLE_MAX_CHARS + ' characters here only. ' +
          'Default: ' + DEFAULT_SETTINGS.filenameTemplate
      )
      .addText((t) =>
        t.setValue(s.filenameTemplate).onChange(async (v) => {
          s.filenameTemplate = v.trim() || DEFAULT_SETTINGS.filenameTemplate;
          renderPreview();
          await this.plugin.saveSettings();
        })
      );

    const preview = containerEl.createDiv({ cls: 'lkn-preview' });
    const renderPreview = () => preview.setText('Result: ' + previewFilename(s));
    renderPreview();

    new Setting(containerEl)
      .setName('Date format')
      .setDesc('Tokens: YYYY, YY, MMMM, MMM, MM, DD, dddd, ddd, HH, mm, ss. Default: ' + DEFAULT_SETTINGS.dateFormat)
      .addText((t) =>
        t.setValue(s.dateFormat).onChange(async (v) => {
          s.dateFormat = v.trim() || DEFAULT_SETTINGS.dateFormat;
          renderPreview();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Author')
      .setDesc('Available as {{author}}. Leave empty if you do not need it. Default: empty')
      .addText((t) =>
        t
          .setPlaceholder('(empty)')
          .setValue(s.author)
          .onChange(async (v) => {
            s.author = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Note template')
      .setDesc(
        'The whole linknote, frontmatter included. Blank runs left by empty variables are collapsed. ' +
          'Default: the ' + TEMPLATE_PRESETS[0].name + ' preset'
      )
      .addTextArea((t) => {
        t.setValue(s.noteTemplate).onChange(async (v) => {
          s.noteTemplate = v || DEFAULT_NOTE_TEMPLATE;
          await this.plugin.saveSettings();
        });
        t.inputEl.addClass('lkn-template');
        return t;
      })
      .addExtraButton((b) =>
        b
          .setIcon('rotate-ccw')
          .setTooltip('Restore the default template')
          .onClick(async () => {
            s.noteTemplate = DEFAULT_NOTE_TEMPLATE;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName('Load a preset')
      .setDesc('Replaces the note template above. Presets are starting points — rewrite them in whatever language you write in.')
      .addDropdown((d) => {
        TEMPLATE_PRESETS.forEach((preset, i) => d.addOption(String(i), preset.name));
        d.setValue(String(this.presetIndex || 0));
        d.onChange((v) => {
          this.presetIndex = Number(v);
        });
      })
      .addButton((b) =>
        b.setButtonText('Load').onClick(async () => {
          const preset = TEMPLATE_PRESETS[this.presetIndex || 0];
          s.noteTemplate = preset.template;
          await this.plugin.saveSettings();
          this.display();
          new Notice('Note template replaced with: ' + preset.name);
        })
      );

    const help = containerEl.createEl('details', { cls: 'lkn-varhelp' });
    help.createEl('summary', { text: 'Template variables' });
    const list = help.createEl('ul');
    for (const [name, desc] of TEMPLATE_VARIABLES) {
      const li = list.createEl('li');
      li.createEl('code', { text: name });
      li.appendText(' — ' + desc);
    }

    new Setting(containerEl).setName('Anchoring').setHeading();

    new Setting(containerEl)
      .setName('Link marker')
      .setDesc('The character left at the anchored spot in the source note. Default: ' + DEFAULT_SETTINGS.marker)
      .addText((t) =>
        t.setValue(s.marker).onChange(async (v) => {
          s.marker = v || DEFAULT_SETTINGS.marker;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Add a block ID')
      .setDesc('Appends a block ID so the linknote can embed the anchored block.')
      .addToggle((t) =>
        t.setValue(s.useBlockId).onChange(async (v) => {
          s.useBlockId = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Insert the link marker')
      .setDesc('Turn off to leave only a block ID in the source note.')
      .addToggle((t) =>
        t.setValue(s.useInlineLink).onChange(async (v) => {
          s.useInlineLink = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('Behaviour').setHeading();

    new Setting(containerEl)
      .setName('Show the floating button')
      .setDesc('Turn off to work from the command palette or a hotkey instead.')
      .addToggle((t) =>
        t.setValue(s.showFloatingButton).onChange(async (v) => {
          s.showFloatingButton = v;
          if (!v) this.plugin.hideFloatingButton();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Open the linknote after creating it')
      .addToggle((t) =>
        t.setValue(s.openAfterCreate).onChange(async (v) => {
          s.openAfterCreate = v;
          await this.plugin.saveSettings();
        })
      );
  }
}

module.exports = LinknotePlugin;

// Exported for tests. Unused at runtime.
module.exports.buildAnchoredBlock = buildAnchoredBlock;
module.exports.narrowToListItem = narrowToListItem;
module.exports.listItemMatches = listItemMatches;
module.exports.normalizeInline = normalizeInline;
module.exports.findBlockContaining = findBlockContaining;
module.exports.existingBlockId = existingBlockId;
module.exports.sanitizeFileName = sanitizeFileName;
module.exports.clampChars = clampChars;
module.exports.clampBytes = clampBytes;
module.exports.previewFilename = previewFilename;
module.exports.sampleFilenameVars = sampleFilenameVars;
module.exports.formatDate = formatDate;
module.exports.renderTemplate = renderTemplate;
module.exports.tidy = tidy;
module.exports.DEFAULT_NOTE_TEMPLATE = DEFAULT_NOTE_TEMPLATE;
module.exports.TEMPLATE_PRESETS = TEMPLATE_PRESETS;
