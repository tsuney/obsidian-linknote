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
  MarkdownRenderer,
  MarkdownRenderChild,
  ItemView,
  normalizePath,
} = obsidian;

/* --------------------------------------------------------------------------
 * Templates
 * ------------------------------------------------------------------------ */

const DEFAULT_NOTE_TEMPLATE = `---
created: {{date}} {{time}}
source: "{{sourceBlock}}"
author: {{author}}
body: {{bodyYaml}}
---

> [!NOTE]- {{titleShort}}
{{selectionQuote}}

## Linknote

{{body}}
`;

const CALLOUT_NOTE_TEMPLATE = `---
created: {{date}}
source: "{{sourceBlock}}"
---

> [!NOTE]+ {{titleShort}}
{{bodyQuote}}
`;

const EMBED_NOTE_TEMPLATE = `---
created: {{date}}
source: "{{sourceBlock}}"
---

# {{title}}

{{body}}

{{embed}}
`;

const QUOTED_NOTE_TEMPLATE = `---
created: {{date}}
source: "{{sourceBlock}}"
---

# {{title}}

{{body}}

> [!quote] Selected text
{{selectionQuote}}

{{embed}}
`;

const DETAILED_NOTE_TEMPLATE = `---
type: linknote
summary: "{{summary}}"
tags:
  - linknote
created: {{date}}
author:
  - {{author}}
source: "{{sourceBlock}}"
---

# {{title}}

## 1. Note

{{body}}

## 2. Context

{{embed}}

> [!quote] Selected text
{{selectionQuote}}

## 3. Source

{{sourceBlock}}, as of {{date}}.
`;

/**
 * Starting points offered in the settings tab. They are deliberately plain:
 * pick the closest one and rewrite it in whatever language you write in.
 */
const TEMPLATE_PRESETS = [
  {
    name: 'Minimal — your note, with the source folded above',
    template: DEFAULT_NOTE_TEMPLATE,
  },
  {
    name: 'Just a callout',
    template: CALLOUT_NOTE_TEMPLATE,
  },
  {
    name: 'With the source embed',
    template: EMBED_NOTE_TEMPLATE,
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
  filenameTemplate: '{{sourceName}}_{{anchor}}',
  dateFormat: 'YYYY-MM-DD',
  noteTemplate: DEFAULT_NOTE_TEMPLATE,
  marker: '†',
  useBlockId: true,
  useInlineLink: true,
  showFloatingButton: true,
  openAfterCreate: false,
  author: '',
  markerStyle: 'chip',
  highlightAnchored: true,
  showCards: false,
  cardPlacement: 'margin',
  bodyHeading: 'Linknote',
  syncBodyProperty: true,
  cardsCollapsed: false,
  cardWidth: 240,
  cardFontScale: 100,
  cardMaxLines: 6,
  cardsPerStack: 3,
  cardTextColour: 'normal',
  cardTextColourCustom: '',
};

/*
 * Cards in the margin only work if there is a margin. Obsidian centres the
 * text column and leaves 70-150px either side, which no card fits into, so
 * the gutter has to be made: the column is narrowed and pushed left, and the
 * cards live in what that frees. Below CARD_MIN_PANE there is not enough pane
 * to do that without squeezing the text, and cards fall back to inline.
 */
const CARD_GAP = 24;
const CARD_MIN_TEXT = 380;
const CARD_STACK_GAP = 12;
const LIST_VIEW_TYPE = 'linknote-list';

/** The gutter a card of this width needs, and the pane that can afford it. */
function cardGutter(width) {
  return (Number(width) || 240) + CARD_GAP + 16;
}
function cardMinPane(width) {
  return cardGutter(width) + CARD_MIN_TEXT;
}

const CARD_TEXT_COLOURS = {
  normal: 'var(--text-normal)',
  muted: 'var(--text-muted)',
  faint: 'var(--text-faint)',
  accent: 'var(--text-accent)',
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

/** How much of the title {{titleShort}} keeps, for use in a heading. */
const TITLE_SHORT_MAX_CHARS = 30;

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

/**
 * A title cut down to something that fits on one line, for a callout or a
 * heading. Measured in characters, not bytes: bytes matter only where a file
 * system imposes them, and three bytes per character would leave Japanese at
 * a third of the length of English.
 */
function shortenTitle(text, max) {
  const value = String(text).replace(/\s+/g, ' ').trim();
  const limit = max || TITLE_SHORT_MAX_CHARS;
  if (value.length <= limit) return value;
  return clampChars(value, limit) + '…';
}

/**
 * Tidies the separators a filename template leaves behind. An empty variable
 * — {{blockId}} on a heading, say — turns "{{sourceName}}_{{blockId}}" into
 * "Note_", and two empty ones leave a run of separators in the middle.
 */
function tidyFileName(name) {
  return String(name)
    .replace(/[ \t]*([_-])[ \t]*(?:[_-][ \t]*)+/g, '$1')
    .replace(/^[\s_-]+|[\s_-]+$/g, '')
    .trim();
}

/**
 * A value for a YAML property, as a block scalar. Written flat, a note of
 * more than one line — or one carrying a colon or a hash — makes the
 * frontmatter invalid. Empty input yields an empty value rather than "|-".
 */
function toYamlBlock(text, indent) {
  const value = String(text == null ? '' : text);
  if (!value.trim()) return '';
  const pad = indent == null ? '  ' : indent;
  return '|-\n' + value.split('\n').map((line) => pad + line).join('\n');
}

/**
 * The text under a heading, down to the next heading of the same level or
 * higher. This is how a linknote says which part of itself is the note: an
 * explicit marker rather than a guess about layout. Fenced code is skipped,
 * so a # inside a code block is not mistaken for a heading.
 */
function sectionUnderHeading(text, heading) {
  const want = String(heading == null ? '' : heading).trim();
  if (!want) return '';

  const lines = String(text == null ? '' : text).split('\n');
  let fenced = false;
  let start = -1;
  let level = 0;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (!m) continue;
    const title = m[2].replace(/\s*\^[A-Za-z0-9-]+$/, '').trim();

    if (start === -1) {
      if (title === want) {
        start = i + 1;
        level = m[1].length;
      }
      continue;
    }
    if (m[1].length <= level) return lines.slice(start, i).join('\n').trim();
  }

  return start === -1 ? '' : lines.slice(start).join('\n').trim();
}

/**
 * Strips a source line back to the passage itself: the marker link and the
 * block ID are Linknote's own furniture, and a list marker is not part of the
 * text either. Used to say, in a list, which passage a linknote is attached to.
 */
function anchorExcerpt(line, max) {
  const bare = String(line == null ? '' : line)
    .replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, '')
    .replace(/\s*\[\[[^\]]*\]\]\s*$/, '')
    .replace(/\s*\[[^\]]*\]\([^)]*\)\s*$/, '');
  return shortenTitle(normalizeInline(bare), max || 60);
}

/* --------------------------------------------------------------------------
 * Taking a linknote back out (pure functions — covered by tests)
 * ------------------------------------------------------------------------ */

/** A link target reduced to something comparable: no subpath, alias or .md. */
function normaliseLinkTarget(text) {
  let value = String(text == null ? '' : text).split('|')[0].split('#')[0].trim();
  try {
    value = decodeURIComponent(value);
  } catch (e) {
    /* left as written */
  }
  return value.replace(/^<|>$/g, '').replace(/^\.\//, '').replace(/\.md$/i, '').trim();
}

/** The names a link to one particular note might be written as. */
function linkNamesFor(path) {
  const clean = String(path == null ? '' : path).replace(/\.md$/i, '');
  const base = clean.split('/').pop();
  return Array.from(new Set([clean, base].filter(Boolean)));
}

const WIKILINK_RE = /!?\[\[([^\]]+)\]\]/g;
const MDLINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Removes the first link to one of `names` from a line, along with the space
 * that separated it. Reports whether anything was found, so the caller can
 * refuse rather than write a line it did not recognise.
 */
function removeLinkFromLine(line, names) {
  const value = String(line == null ? '' : line);
  const wanted = (names || []).map(normaliseLinkTarget);

  for (const re of [WIKILINK_RE, MDLINK_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(value)) !== null) {
      if (wanted.indexOf(normaliseLinkTarget(m[1])) === -1) continue;
      const before = value.slice(0, m.index).replace(/[ \t]+$/, '');
      const after = value.slice(m.index + m[0].length);
      return { line: before + after, removed: true };
    }
  }
  return { line: value, removed: false };
}

/** The block ID at the end of a line, without the caret. */
function blockIdOfLine(line) {
  const m = String(line == null ? '' : line).match(BLOCK_ID_RE);
  return m ? m[1] : '';
}

function stripBlockIdFromLine(line) {
  return String(line == null ? '' : line).replace(BLOCK_ID_RE, '');
}

/**
 * Takes a linknote's marker out of the note it annotates.
 *
 * Refuses rather than guesses, on the same terms as writing: the marker has
 * to be found, and found once. A line left holding nothing goes with it —
 * that is the heading case, where the marker sits on a line of its own.
 */
function removeAnchor(content, names, dropBlockId) {
  const lines = String(content == null ? '' : content).split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (removeLinkFromLine(lines[i], names).removed) hits.push(i);
  }

  if (!hits.length) return { ok: false, reason: 'not-found', content: null, blockId: '' };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous', content: null, blockId: '' };

  const at = hits[0];
  const stripped = removeLinkFromLine(lines[at], names).line;
  const blockId = blockIdOfLine(stripped);
  const next = (dropBlockId && blockId ? stripBlockIdFromLine(stripped) : stripped).replace(/[ \t]+$/, '');

  if (!next.trim()) {
    lines.splice(at, 1);
    // The marker had a blank line either side; one of them goes with it.
    if (at > 0 && at < lines.length && !lines[at - 1].trim() && !lines[at].trim()) {
      lines.splice(at, 1);
    }
  } else {
    lines[at] = next;
  }

  return { ok: true, reason: '', content: lines.join('\n'), blockId };
}

/** Everything after the frontmatter block, or the whole text if there is none. */
function stripFrontmatter(text) {
  const value = String(text == null ? '' : text);
  if (!/^---\r?\n/.test(value)) return value.trim();
  const end = value.indexOf('\n---', 3);
  if (end === -1) return value.trim();
  const after = value.slice(end + 4);
  return after.replace(/^\r?\n/, '').trim();
}

/** Adds or removes a task marker on the line the caret sits in. */
function toggleTaskLine(text, caret) {
  const value = String(text == null ? '' : text);
  const at = Math.max(0, Math.min(Number(caret) || 0, value.length));
  const start = value.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = value.indexOf('\n', at);
  const end = lineEnd === -1 ? value.length : lineEnd;
  const line = value.slice(start, end);

  const done = line.match(/^(\s*)(?:[-*+]\s+)?\[[ xX]\]\s?/);
  const next = done
    ? done[1] + line.slice(done[0].length)
    : line.replace(/^(\s*)(?:[-*+]\s+)?/, '$1- [ ] ');

  return {
    text: value.slice(0, start) + next + value.slice(end),
    cursor: Math.max(start, at + (next.length - line.length)),
  };
}

/**
 * The tag being typed at the caret, if any. Returns the range to replace so a
 * pick can overwrite what was typed rather than append to it.
 */
function tagQueryAt(text, caret) {
  const value = String(text == null ? '' : text);
  const at = Math.max(0, Math.min(Number(caret) || 0, value.length));
  const before = value.slice(0, at);
  const hit = before.match(/(^|\s)#([^\s#]*)$/);
  if (!hit) return null;
  const start = at - hit[2].length - 1;
  return { start, end: at, query: hit[2] };
}

/** Puts a picked tag into the text, replacing what was typed. */
function applyTagPick(text, range, tag) {
  const value = String(text == null ? '' : text);
  const name = String(tag).replace(/^#/, '');
  const inserted = '#' + name + ' ';
  return {
    text: value.slice(0, range.start) + inserted + value.slice(range.end),
    cursor: range.start + inserted.length,
  };
}

/** Every tag in the vault, from file caches. Sorted, without the leading #. */
function collectTags(caches) {
  const seen = new Set();
  for (const cache of caches || []) {
    if (!cache) continue;
    for (const t of cache.tags || []) {
      const name = String((t && t.tag) || '').replace(/^#/, '').trim();
      if (name) seen.add(name);
    }
    const fm = cache.frontmatter && cache.frontmatter.tags;
    const list = Array.isArray(fm) ? fm : typeof fm === 'string' ? fm.split(/[,\s]+/) : [];
    for (const t of list) {
      const name = String(t || '').replace(/^#/, '').trim();
      if (name) seen.add(name);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/** Tags matching what has been typed: prefix matches first, then the rest. */
function filterTags(tags, query, limit) {
  const q = String(query || '').toLowerCase();
  const max = limit || 8;
  if (!q) return (tags || []).slice(0, max);
  const starts = [];
  const contains = [];
  for (const t of tags || []) {
    const low = t.toLowerCase();
    if (low.startsWith(q)) starts.push(t);
    else if (low.includes(q)) contains.push(t);
  }
  return starts.concat(contains).slice(0, max);
}

/** Escapes a value for use inside an attribute selector. */
function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
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

/** Renders a filename template and cleans up what the variables left behind. */
function buildFileName(template, vars) {
  const cleaned = tidyFileName(sanitizeFileName(renderTemplate(template, vars)));
  return tidyFileName(clampBytes(cleaned, FILENAME_MAX_BYTES));
}

/** Stand-in values so the settings tab can show what a filename will look like. */
function sampleFilenameVars(settings, now) {
  return {
    title: 'Quarterly close',
    titleShort: 'Quarterly close',
    body: '',
    bodyQuote: '',
    bodyYaml: '',
    selection: 'the tenth business day',
    selectionQuote: '> the tenth business day',
    source: '[[Team handbook]]',
    sourceBlock: '[[Team handbook#^k3n8v1]]',
    sourceName: 'Team handbook',
    sourcePath: 'Team handbook.md',
    embed: '',
    blockId: 'k3n8v1',
    anchor: 'k3n8v1',
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
  const name = buildFileName(settings.filenameTemplate, vars);
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

/**
 * Last-ditch comparison key: letters and digits only.
 *
 * Normalising the markup is not always enough. Obsidian decides how to render
 * a link, and the visible text can differ from the source in ways that are not
 * markup at all — a leading `#` on a heading link, spacing around punctuation,
 * a separator the theme inserts. Stripping everything but letters and digits
 * survives all of that. It is only ever used to locate a line, and only when a
 * single line matches, so a loose key cannot put the anchor in the wrong place.
 */
function looseKey(text) {
  return normalizeInline(text).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** List lines within a block that contain the selection. */
function listItemMatches(blockSrc, selection) {
  const raw = String(selection || '').split('\n')[0].trim();
  if (!raw) return [];

  const lines = blockSrc.split('\n').filter((l) => LIST_MARKER_RE.test(l));

  const needle = normalizeInline(raw);
  if (needle) {
    const hits = lines.filter((l) => normalizeInline(l).indexOf(needle) !== -1);
    if (hits.length) return hits;
  }

  const loose = looseKey(raw);
  if (!loose) return [];
  return lines.filter((l) => looseKey(l).indexOf(loose) !== -1);
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
  const firstLine = String(needle).split('\n')[0];
  const lines = content.split('\n');

  const uniqueLine = (key, of) => {
    if (!key) return -1;
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (of(lines[i]).indexOf(key) === -1) continue;
      if (found !== -1) return -2; // ambiguous
      found = i;
    }
    return found;
  };

  let hit = uniqueLine(normalizeInline(firstLine), normalizeInline);
  if (hit < 0) hit = uniqueLine(looseKey(firstLine), looseKey);
  if (hit < 0) return '';
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

/**
 * Heading text of a block, or '' when it is not a heading.
 *
 * Obsidian cannot attach a block ID to a heading, and appending the marker to
 * the heading itself would change its text — breaking every [[Note#Heading]]
 * link pointing at it. So headings are referenced by their heading anchor
 * instead, and the marker goes on the line below (the reading view moves it
 * back up visually).
 */
function headingTextOf(blockSrc) {
  const first = String(blockSrc).split('\n').find((l) => l.trim() !== '') || '';
  const m = first.trim().match(/^#{1,6}\s+(.*)$/);
  if (!m) return '';
  return m[1].replace(BLOCK_ID_RE, '').replace(/\s+#+\s*$/, '').trim();
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
    this.tagCache = null;
    this.relayoutPending = false;
    this.stackObservers = null;

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.ctxMap.set(el, ctx);
      this.decorateMarkers(el);
      this.renderCards(el, ctx);
    });

    // The tag list is rebuilt on demand; this only marks it stale.
    // 'changed' rather than vault 'modify': it fires once the cache has caught
    // up, so the frontmatter a card reads is the edited one.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.tagCache = null;
        this.syncBodyProperty(file);
        this.refreshCardsFor(file);
      })
    );

    // A note without linknotes must not keep the gutter the previous one had.
    this.registerEvent(this.app.vault.on('modify', (file) => this.refreshCardsFor(file)));
    // These events fire before the view has drawn. Running once at that moment
    // decided "no cards here" and dropped the gutter, and since Obsidian then
    // restored the cards from its own cache without the post processor running,
    // nothing put the gutter back. So the work is repeated as things settle.
    // Order matters: the placement of each stack is decided first, and the
    // gutter is settled from the result. The other way round read the state
    // left by the previous pass, dropped the gutter, and put it straight back.
    const settle = () => {
      this.applyCardStyle();
      this.sweepCards();
      this.refitCards();
      this.syncCardLayout();
      this.scheduleRelayout();
    };
    const settleSoon = () => {
      settle();
      this.laterCardPass(120);
      this.laterCardPass(500);
      this.laterCardPass(1200);
    };
    this.registerEvent(this.app.workspace.on('file-open', settleSoon));
    this.registerEvent(this.app.workspace.on('layout-change', settleSoon));
    this.registerEvent(this.app.workspace.on('active-leaf-change', settleSoon));
    this.app.workspace.onLayoutReady(settleSoon);
    this.registerDomEvent(window, 'resize', () => this.refitCards());

    this.registerView(LIST_VIEW_TYPE, (leaf) => new LinknoteListView(leaf, this));
    this.addRibbonIcon('message-square', 'Linknotes in this note', () => this.openList());

    this.addCommand({
      id: 'open-list',
      name: 'Show the linknotes in this note',
      callback: () => this.openList(),
    });

    this.addCommand({
      id: 'toggle-cards',
      name: 'Show or stow the linknote cards',
      callback: () => this.toggleCardsCollapsed(),
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

  /**
   * Marks up rendered link markers so they can be styled, and flags the block
   * they sit in. Nothing is written to disk: this only touches the rendered
   * DOM, so turning it off leaves your notes exactly as they were.
   */
  decorateMarkers(el) {
    const s = this.settings;
    const marker = String(s.marker || '').trim();
    if (!marker) return;

    let links;
    try {
      links = Array.prototype.slice.call(el.querySelectorAll('a'));
    } catch (e) {
      return;
    }

    for (const a of links) {
      if (String(a.textContent || '').trim() !== marker) continue;

      a.classList.add('lkn-marker');
      if (s.markerStyle === 'plain') a.classList.add('lkn-marker-plain');

      // On a phone the marker opens a sheet rather than the note itself: the
      // point of a note in the margin is to be read without leaving the page.
      if (Platform.isMobile && !a.dataset.lknSheet) {
        a.dataset.lknSheet = '1';
        a.addEventListener('click', (evt) => {
          const ctx = this.ctxMap.get(el);
          const sourcePath = (ctx && ctx.sourcePath) || '';
          if (!sourcePath) return;
          evt.preventDefault();
          evt.stopPropagation();
          this.openSheetFor(a, sourcePath);
        });
      }

      if (!s.highlightAnchored) continue;
      // A list item is a better unit to flag than the whole list.
      const host = (a.closest && a.closest('li')) || el;
      if (host && host.classList) host.classList.add('lkn-anchored');
    }

    // A marker alone in its block belongs visually to the heading above it.
    this.scheduleHeadingAttach(el, marker);
  }

  /**
   * Defers the move to the heading until the element is in the document.
   * A post processor is handed a detached tree, so nothing outside `el` —
   * the heading included — can be reached while it runs.
   */
  scheduleHeadingAttach(el, marker) {
    try {
      if (String(el.textContent || '').trim() !== marker) return;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      if (!win) return;

      // No rule beside the heading itself: the marker now sits in the heading
      // line, which is signal enough, and a rule there reads as a quote bar.
      const run = () => {
        this.attachMarkerToHeading(el, marker);
      };

      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
      else win.setTimeout(run, 0);
    } catch (e) {
      /* the marker simply stays on its own line */
    }
  }

  /**
   * Moves a marker that is alone in its block up into the heading above it,
   * and hides the now-empty block. The file is untouched: the marker has to
   * live on its own line, because putting it in the heading text would change
   * the heading and break links to it.
   */
  attachMarkerToHeading(el, marker) {
    try {
      if (String(el.textContent || '').trim() !== marker) return null;
      if (el.isConnected === false) return null;

      const link = el.querySelector('a');
      if (!link) return null;

      // Reading view wraps every top-level block, so the heading is not a
      // sibling of this block but of one of its ancestors.
      let node = el;
      let prev = null;
      for (let i = 0; i < 4 && node; i++) {
        prev = node.previousElementSibling;
        if (prev) break;
        node = node.parentElement;
      }
      // A second linknote on the same heading sits behind the first, which is
      // hidden by now. Step over anything already moved up.
      for (let i = 0; i < 8 && prev; i++) {
        const moved =
          (prev.classList && prev.classList.contains('lkn-relocated')) ||
          (prev.querySelector && prev.querySelector('.lkn-relocated'));
        if (!moved) break;
        prev = prev.previousElementSibling;
      }
      if (!prev) return null;

      const heading =
        (prev.matches && prev.matches('h1, h2, h3, h4, h5, h6') && prev) ||
        (prev.querySelector && prev.querySelector('h1, h2, h3, h4, h5, h6'));
      if (!heading) return null;

      // A re-render can run this twice over a heading that already has it.
      const href = link.getAttribute ? link.getAttribute('href') || '' : '';
      const seated = heading.querySelectorAll
        ? Array.prototype.slice.call(heading.querySelectorAll('a.lkn-marker'))
        : [];
      for (const a of seated) {
        if (a === link) return heading;
        if ((a.getAttribute ? a.getAttribute('href') || '' : '') === href) {
          el.classList.add('lkn-relocated');
          return heading;
        }
      }

      heading.appendChild(link);
      el.classList.add('lkn-relocated');
      return heading;
    } catch (e) {
      return null;
    }
  }

  /**
   * Every tag in the vault, for the composer's tag picker. Built from public
   * file caches rather than the undocumented metadataCache.getTags(), and
   * dropped whenever the cache changes so it cannot go stale.
   */
  vaultTags() {
    if (this.tagCache) return this.tagCache;
    try {
      const files = this.app.vault.getMarkdownFiles();
      this.tagCache = collectTags(files.map((f) => this.app.metadataCache.getFileCache(f)));
    } catch (e) {
      this.tagCache = [];
    }
    return this.tagCache;
  }

  /* ------------------------------------------------------------ cards */

  /**
   * Draws each linknote as a card beside the block it is attached to. In the
   * margin where there is room, inline where there is not — a narrow window,
   * a full-width note, or a phone. Nothing is written to the note.
   */
  renderCards(el, ctx) {
    // Not on a phone. There is no margin to put a card in and inline cards
    // interrupt the reading; the sheet and the sidebar answer this instead.
    if (!this.settings.showCards || Platform.isMobile) return;

    let links;
    try {
      links = Array.prototype.slice.call(el.querySelectorAll('a.lkn-marker'));
    } catch (e) {
      return;
    }
    if (!links.length) return;

    const sourcePath = (ctx && ctx.sourcePath) || '';
    for (const a of links) {
      const linktext = a.getAttribute('data-href') || a.getAttribute('href') || '';
      if (!linktext) continue;

      let file = null;
      try {
        file = this.app.metadataCache.getFirstLinkpathDest(linktext.split('#')[0], sourcePath);
      } catch (e) {
        file = null;
      }
      if (!file) continue;

      const host = (a.closest && a.closest('li')) || el;
      if (!host || !host.classList || !host.createDiv) continue;
      const already =
        host.querySelector && host.querySelector('.lkn-card[data-lkn-path="' + cssEscape(file.path) + '"]');
      if (already) continue;

      host.classList.add('lkn-has-card');
      // One stack per block. Cards used to be positioned individually, which
      // put every card on a block at the same spot, one on top of the other.
      let stack = host.querySelector(':scope > .lkn-card-stack');
      if (!stack) stack = host.createDiv({ cls: 'lkn-card-stack' });

      const card = stack.createDiv({ cls: 'lkn-card' });
      card.setAttribute('data-lkn-path', file.path);
      card.setAttribute('data-lkn-src', sourcePath);
      // Stowed, the card is a strip with nothing to press but itself.
      card.addEventListener('click', () => {
        if (this.settings.cardsCollapsed) this.toggleCardsCollapsed(false);
      });
      this.paintCard(card, file);
      this.fitStack(stack);
    }
  }

  /**
   * Fills a card with the linknote as it stands now. Called again whenever the
   * linknote changes, so the whole card is rebuilt rather than appended to.
   */
  async paintCard(card, file) {
    if (!card || !file) return;
    const sourcePath = card.getAttribute('data-lkn-src') || '';

    let text = '';
    let author = '';
    let created = '';
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache && cache.frontmatter) || null;
      if (fm && fm.author) author = String(Array.isArray(fm.author) ? fm.author.join(', ') : fm.author);
      // The note's own created property, minus any time of day; the file's own
      // timestamp when it has none, so a card always says when.
      if (fm && typeof fm.created === 'string' && fm.created.trim()) {
        created = fm.created.trim().split(/\s+/)[0];
      } else if (file.stat && file.stat.ctime) {
        created = formatDate(new Date(file.stat.ctime), this.settings.dateFormat);
      }

      // The note itself, not the property: the property is written once, and
      // goes stale the moment the note is edited.
      const content = await this.app.vault.cachedRead(file);
      text = sectionUnderHeading(content, this.settings.bodyHeading);
      if (!text && fm && typeof fm.body === 'string' && fm.body.trim()) text = fm.body;
      if (!text) text = stripFrontmatter(content);
    } catch (e) {
      /* an empty card is better than a broken one */
    }

    // Not isConnected: on the first draw the whole tree is still detached, and
    // bailing here is what left the card an empty box. Losing its host is the
    // real signal that the card is gone.
    if (!card.parentElement) return;
    card.empty();

    const head = card.createDiv({ cls: 'lkn-card-head' });
    // Who and when, rather than the file name: linknotes on one block differ
    // only by a trailing number, which told the reader nothing.
    const label = [author, created].filter(Boolean).join(' · ') || file.basename;
    const title = head.createEl('a', { cls: 'lkn-card-title', text: label });
    title.setAttribute('href', file.path);
    title.setAttribute('aria-label', file.basename);
    title.setAttribute('title', file.basename);
    title.addEventListener('click', (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(file.path, sourcePath, evt.metaKey || evt.ctrlKey);
    });

    const stow = head.createEl('button', { cls: 'lkn-card-stow', text: '–' });
    stow.setAttribute('aria-label', 'Stow the cards');
    stow.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.toggleCardsCollapsed(true);
    });

    const drop = head.createEl('button', { cls: 'lkn-card-remove', text: '×' });
    drop.setAttribute('aria-label', 'Remove this linknote');
    drop.setAttribute('title', 'Remove this linknote');
    drop.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!source || !(source instanceof TFile)) {
        new Notice('Linknote: the note this card belongs to could not be found.');
        return;
      }
      this.confirmRemoval(source, file);
    });

    const body = card.createDiv({ cls: 'lkn-card-body' });
    if (!text) return;

    try {
      if (MarkdownRenderer && typeof MarkdownRenderer.render === 'function') {
        await MarkdownRenderer.render(this.app, text, body, file.path, this);
      } else if (MarkdownRenderer && typeof MarkdownRenderer.renderMarkdown === 'function') {
        await MarkdownRenderer.renderMarkdown(text, body, file.path, this);
      } else {
        body.setText(text);
      }
    } catch (e) {
      body.setText(text);
    }

    // The card just changed height, so everything below it has to move.
    this.scheduleRelayout();
  }

  /**
   * The linknotes a note carries, in the order they appear in it. Read from
   * the note's own link cache, so it costs nothing and needs no scanning: a
   * link into the linknote folder is a linknote by definition.
   */
  async linknotesOf(file) {
    if (!file) return [];
    let links = [];
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      links = (cache && cache.links) || [];
    } catch (e) {
      return [];
    }
    if (!links.length) return [];

    let lines = [];
    try {
      lines = (await this.app.vault.cachedRead(file)).split('\n');
    } catch (e) {
      lines = [];
    }

    const out = [];
    const seen = new Set();
    for (const link of links) {
      const target = String((link && link.link) || '').split('#')[0];
      if (!target) continue;

      let note = null;
      try {
        note = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
      } catch (e) {
        note = null;
      }
      if (!note || !this.isLinknote(note) || seen.has(note.path)) continue;
      seen.add(note.path);

      const line = (link.position && link.position.start && link.position.start.line) || 0;
      const source = lines[line] || '';
      const idMatch = source.match(/\^([A-Za-z0-9-]+)[ \t]*$/);

      // A marker on a heading sits on a line of its own, so stripping it away
      // leaves nothing. The heading above it is the passage in that case.
      let passage = anchorExcerpt(source);
      if (!passage) {
        for (let i = line - 1; i >= 0 && i > line - 5; i--) {
          const heading = headingTextOf(lines[i]);
          if (heading) {
            passage = shortenTitle(normalizeInline(heading), 60);
            break;
          }
          if (lines[i].trim()) break;
        }
      }

      out.push({ file: note, line, blockId: idMatch ? idMatch[1] : '', passage });
    }
    return out;
  }

  /** What a linknote says, for a list or a sheet: who, when, and the note. */
  async readLinknote(file) {
    const out = { author: '', created: '', text: '' };
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache && cache.frontmatter) || null;
      if (fm && fm.author) out.author = String(Array.isArray(fm.author) ? fm.author.join(', ') : fm.author);
      if (fm && typeof fm.created === 'string' && fm.created.trim()) {
        out.created = fm.created.trim().split(/\s+/)[0];
      } else if (file.stat && file.stat.ctime) {
        out.created = formatDate(new Date(file.stat.ctime), this.settings.dateFormat);
      }
      const content = await this.app.vault.cachedRead(file);
      out.text = sectionUnderHeading(content, this.settings.bodyHeading);
      if (!out.text && fm && typeof fm.body === 'string') out.text = fm.body;
      if (!out.text) out.text = stripFrontmatter(content);
    } catch (e) {
      /* what was gathered is enough */
    }
    return out;
  }

  /**
   * Draws the rows shared by the sidebar and the sheet. onRemoved, when
   * given, is called after a row's linknote has actually been removed — the
   * sheet uses it to close itself, since what it was showing is gone.
   */
  async renderLinknoteRows(target, sourceFile, entries, onRemoved) {
    target.empty();
    if (!entries.length) {
      target.createDiv({ cls: 'lkn-list-empty', text: 'No linknotes in this note.' });
      return;
    }

    for (const entry of entries) {
      const row = target.createDiv({ cls: 'lkn-list-item' });

      // Who and when first, so every row is headed the same way. The passage
      // is not always there — a heading anchor may leave nothing to quote.
      const info = await this.readLinknote(entry.file);
      const meta = [info.author, info.created].filter(Boolean).join(' · ');
      const head = row.createDiv({ cls: 'lkn-list-head' });
      head.createDiv({ cls: 'lkn-list-meta', text: meta || entry.file.basename });

      const drop = head.createEl('button', { cls: 'lkn-list-remove', text: '×' });
      drop.setAttribute('aria-label', 'Remove this linknote');
      drop.setAttribute('title', 'Remove this linknote');
      drop.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.confirmRemoval(sourceFile, entry.file, onRemoved);
      });

      if (entry.passage) {
        const passage = row.createDiv({ cls: 'lkn-list-passage', text: entry.passage });
        passage.setAttribute('aria-label', 'Go to the passage');
        passage.addEventListener('click', (evt) => {
          evt.stopPropagation();
          const sub = entry.blockId ? '#^' + entry.blockId : '';
          this.app.workspace.openLinkText(sourceFile.path + sub, sourceFile.path, false);
        });
      }

      const body = row.createDiv({ cls: 'lkn-list-body' });
      body.setText(info.text || entry.file.basename);
      row.addEventListener('click', (evt) => {
        this.app.workspace.openLinkText(entry.file.path, sourceFile.path, evt.metaKey || evt.ctrlKey);
      });
    }
  }

  /**
   * True when nothing else in the vault points at this block. Asked before a
   * block ID is removed, since the ID may be doing work for another note.
   * Walks the public link caches; the linknote being removed is excused.
   */
  blockIdIsUnused(sourceFile, blockId, exceptPath) {
    if (!blockId) return true;
    const wanted = '#^' + blockId;
    try {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (file.path === exceptPath) continue;
        const cache = this.app.metadataCache.getFileCache(file);
        for (const link of (cache && cache.links) || []) {
          const raw = String((link && link.link) || '');
          if (raw.indexOf(wanted) === -1) continue;
          const target = raw.split('#')[0];
          // A subpath with no note in front points inside the same file.
          const dest = target
            ? this.app.metadataCache.getFirstLinkpathDest(target, file.path)
            : file;
          if (dest && dest.path === sourceFile.path) return false;
        }
        for (const embed of (cache && cache.embeds) || []) {
          const raw = String((embed && embed.link) || '');
          if (raw.indexOf(wanted) === -1) continue;
          const target = raw.split('#')[0];
          const dest = target
            ? this.app.metadataCache.getFirstLinkpathDest(target, file.path)
            : file;
          if (dest && dest.path === sourceFile.path) return false;
        }
      }
    } catch (e) {
      // Unsure means leave it alone.
      return false;
    }
    return true;
  }

  /**
   * Works out what removing a linknote would do, without doing any of it.
   * The confirmation is built from this, so what the user is told and what
   * happens are the same thing.
   */
  async planRemoval(sourceFile, noteFile) {
    const names = linkNamesFor(noteFile.path);
    let content = '';
    try {
      content = await this.app.vault.read(sourceFile);
    } catch (e) {
      return { ok: false, reason: 'unreadable' };
    }

    const found = removeAnchor(content, names, false);
    if (!found.ok) return { ok: false, reason: found.reason };

    const blockId = found.blockId;
    const dropBlockId = !!blockId && this.blockIdIsUnused(sourceFile, blockId, noteFile.path);
    const result = dropBlockId ? removeAnchor(content, names, true) : found;

    return {
      ok: true,
      reason: '',
      sourceFile,
      noteFile,
      blockId,
      dropBlockId,
      before: content,
      after: result.content,
    };
  }

  /**
   * Carries out a plan. The note goes to wherever the vault sends deleted
   * files, not straight out of existence, and the source is only written when
   * it still reads as it did when the plan was made.
   */
  async applyRemoval(plan) {
    let wrote = false;
    try {
      const now = await this.app.vault.read(plan.sourceFile);
      if (now !== plan.before) {
        new Notice('Linknote: the note changed while the confirmation was open. Nothing was removed.');
        return false;
      }
      await this.app.vault.process(plan.sourceFile, () => plan.after);
      wrote = true;
      await this.app.fileManager.trashFile(plan.noteFile);
    } catch (e) {
      // Said plainly, because a half-done removal is worth knowing about.
      new Notice(
        wrote
          ? 'Linknote: the marker was removed, but the note itself could not be deleted.'
          : 'Linknote: removal failed. Nothing was changed.'
      );
      return false;
    }

    new Notice('Linknote removed: ' + plan.noteFile.basename);
    // Housekeeping only. A card left on screen for a moment is not a failure,
    // so it never turns a finished removal into a reported one.
    try {
      this.sweepCards();
      this.scheduleRelayout();
    } catch (e) {
      /* the next pass will catch up */
    }
    return true;
  }

  /** Asks first. Called from a card, from the list and from the sheet. */
  async confirmRemoval(sourceFile, noteFile, onRemoved) {
    const plan = await this.planRemoval(sourceFile, noteFile);
    if (!plan.ok) {
      const why =
        plan.reason === 'ambiguous'
          ? 'the source note links to it in more than one place'
          : plan.reason === 'unreadable'
            ? 'the source note could not be read'
            : 'no marker for it was found in the source note';
      new Notice('Linknote: nothing was removed — ' + why + '.');
      return;
    }
    new LinknoteRemoveModal(this.app, this, plan, onRemoved).open();
  }

  /** True for a note that lives in the linknote folder. */
  isLinknote(file) {
    if (!file || typeof file.path !== 'string') return false;
    const folder = String(this.settings.folder || '').replace(/\/+$/, '');
    return !folder || file.path.startsWith(folder + '/');
  }

  /**
   * Brings the body property back in step with the note. Only for a note that
   * already carries the property — the plugin maintains what it wrote and does
   * not add properties to notes that never had one.
   */
  async syncBodyProperty(file) {
    if (!this.settings.syncBodyProperty || !this.isLinknote(file)) return;
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache && cache.frontmatter) || null;
      if (!fm || !Object.prototype.hasOwnProperty.call(fm, 'body')) return;

      const section = sectionUnderHeading(
        await this.app.vault.cachedRead(file),
        this.settings.bodyHeading
      );
      if (!section) return;

      const current = typeof fm.body === 'string' ? fm.body : '';
      // Also stops the write this triggers from starting another one.
      if (current.trim() === section.trim()) return;

      await this.app.fileManager.processFrontMatter(file, (front) => {
        front.body = section;
      });
    } catch (e) {
      /* the property simply stays as it was */
    }
  }

  /** Repaints every card that shows this file, after it has been edited. */
  refreshCardsFor(file) {
    if (!file || !file.path || !this.settings.showCards) return;
    const selector = '.lkn-card[data-lkn-path="' + cssEscape(file.path) + '"]';
    for (const doc of this.openDocuments()) {
      let cards = [];
      try {
        cards = Array.prototype.slice.call(doc.querySelectorAll(selector));
      } catch (e) {
        continue;
      }
      for (const card of cards) {
        this.paintCard(card, file);
        // The note may have grown or shrunk; the placement is decided again.
        if (card.parentElement) this.fitStack(card.parentElement);
      }
    }
  }

  /**
   * Margin or inline. The margin needs a gutter that Obsidian does not leave,
   * so the view is asked to make one; where the pane is too narrow for that,
   * or on a phone, the card goes inline instead.
   */
  /**
   * Watches a stack's height. The cards fill in asynchronously, so a stack
   * measured the moment it is built is shorter than it ends up, and the stack
   * below it is not pushed down far enough. Rather than guess when the text
   * has landed, the measurement is redone whenever a height actually changes.
   */
  observeStack(stack) {
    try {
      const doc = stack.ownerDocument;
      const win = (doc && doc.defaultView) || window;
      if (!win || typeof win.ResizeObserver !== 'function') return;

      if (!this.stackObservers) this.stackObservers = new WeakMap();
      let observer = this.stackObservers.get(doc);
      if (!observer) {
        observer = new win.ResizeObserver(() => this.scheduleRelayout());
        this.stackObservers.set(doc, observer);
        this.register(() => observer.disconnect());
      }
      // Observing the same element twice is a no-op, so this needs no guard.
      observer.observe(stack);
    } catch (e) {
      /* the timed passes remain */
    }
  }

  fitStack(stack) {
    const card = stack;
    const host = stack && stack.parentElement;
    if (!host) return;
    this.observeStack(stack);
    const doc = stack.ownerDocument;
    const win = (doc && doc.defaultView) || window;

    const decide = (attempt) => {
      if (!card.parentElement) return;
      // Measuring a detached stack gives zeroes, which would read as no room.
      if (!card.isConnected) {
        if (attempt < 5) schedule(attempt + 1);
        return;
      }
      const view =
        (host.closest && (host.closest('.markdown-preview-view') || host.closest('.markdown-rendered'))) || null;

      let margin = !Platform.isMobile && this.settings.cardPlacement !== 'inline' && !!view;
      if (margin) {
        const width = view.getBoundingClientRect().width;
        // Straight after a reload the pane has no size yet. Reading that as
        // "no room" is what left the cards inline for good.
        if (!width) {
          if (attempt < 8) schedule(attempt + 1);
          return;
        }
        margin = width >= cardMinPane(this.settings.cardWidth);
      }

      if (view) view.classList.toggle('lkn-cards', margin);
      card.classList.toggle('lkn-card-inline', !margin);
      if (!margin) {
        card.style.top = '';
        card.style.maxHeight = '';
        card.classList.remove('lkn-stack-scroll');
        if (host.style) host.style.setProperty('--lkn-shift', '0px');
      }
      this.scheduleRelayout();

    };

    const schedule = (attempt) => {
      const run = () => decide(attempt);
      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
      else win.setTimeout(run, 16);
    };
    schedule(0);
  }

  /**
   * Walks the open reading views and puts back any card that has gone missing.
   * Reading view reuses sections it has already drawn, and a card lives inside
   * the block it belongs to, so a card can be dropped without the post
   * processor running again to rebuild it. Rather than depend on when Obsidian
   * chooses to re-render, the cards are simply restored whenever the layout
   * settles.
   */
  sweepCards() {
    if (!this.settings.showCards) return;
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf && leaf.view;
        if (!view || !view.containerEl || !view.file || !view.file.path) return;

        let els = [];
        try {
          els = Array.prototype.slice.call(
            view.containerEl.querySelectorAll('.markdown-preview-view, .markdown-rendered')
          );
        } catch (e) {
          return;
        }
        for (const el of els) {
          // Decorating first: the class the cards key on may have gone too.
          this.decorateMarkers(el);
          this.renderCards(el, { sourcePath: view.file.path });
        }
      });
    } catch (e) {
      /* nothing to sweep */
    }
  }

  /**
   * Gives every view the gutter it currently needs. Clearing the gutter on
   * file-open instead took it from views that still held cards: switching to
   * the linknote and back left them pinned outside the pane, since nothing
   * re-rendered to put the gutter back.
   */
  syncCardLayout() {
    const wanted = !!this.settings.showCards;
    for (const doc of this.openDocuments()) {
      let views = [];
      try {
        views = Array.prototype.slice.call(doc.querySelectorAll('.markdown-preview-view'));
      } catch (e) {
        continue;
      }
      for (const v of views) {
        const holds = wanted && !!v.querySelector('.lkn-card-stack:not(.lkn-card-inline)');
        v.classList.toggle('lkn-cards', holds);
      }
    }
  }

  /** Drops the gutter everywhere, for when cards are turned off. */
  clearCardLayout() {
    for (const doc of this.openDocuments()) {
      try {
        const views = doc.querySelectorAll('.lkn-cards');
        for (const v of Array.prototype.slice.call(views)) v.classList.remove('lkn-cards');
      } catch (e) {
        /* nothing to clear */
      }
    }
  }

  /**
   * Pushes the card settings out as CSS custom properties. Doing it this way
   * keeps the stylesheet in charge of the layout and leaves the settings as
   * plain numbers, and it reaches popout windows, which have their own body.
   */
  applyCardStyle() {
    const s = this.settings;
    const width = Number(s.cardWidth) || 240;
    const colour =
      s.cardTextColour === 'custom'
        ? s.cardTextColourCustom || CARD_TEXT_COLOURS.normal
        : CARD_TEXT_COLOURS[s.cardTextColour] || CARD_TEXT_COLOURS.normal;

    for (const doc of this.openDocuments()) {
      const body = doc && doc.body;
      if (!body || !body.style) continue;
      body.style.setProperty('--lkn-card-width', width + 'px');
      body.style.setProperty('--lkn-card-gutter', cardGutter(width) + 'px');
      body.style.setProperty('--lkn-card-scale', String((Number(s.cardFontScale) || 100) / 100));
      body.style.setProperty('--lkn-card-lines', String(Number(s.cardMaxLines) || DEFAULT_SETTINGS.cardMaxLines));
      body.style.setProperty('--lkn-card-color', colour);
      body.classList.toggle('lkn-cards-collapsed', !!s.cardsCollapsed);
    }
  }

  /** Reveals the list in the right sidebar, opening it if it is not there. */
  async openList() {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(LIST_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: LIST_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /** The sheet a marker opens: the linknotes attached to that one block. */
  async openSheetFor(link, sourcePath) {
    const file = sourcePath && this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) return;

    const all = await this.linknotesOf(file);
    const linktext = (link.getAttribute('data-href') || link.getAttribute('href') || '').split('#')[0];
    let target = null;
    try {
      target = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
    } catch (e) {
      target = null;
    }
    if (!target) return;

    const here = all.find((e) => e.file.path === target.path);
    const entries = here ? all.filter((e) => e.line === here.line) : [];
    if (!entries.length) return;

    new LinknoteSheet(this.app, this, file, entries).open();
  }

  /** Stows the cards, or brings them back. */
  async toggleCardsCollapsed(next) {
    this.settings.cardsCollapsed = next === undefined ? !this.settings.cardsCollapsed : !!next;
    await this.saveSettings();
    this.applyCardStyle();
  }

  /** Runs the card passes again once the view has had time to draw. */
  laterCardPass(ms) {
    const id = window.setTimeout(() => {
      this.sweepCards();
      this.refitCards();
      this.syncCardLayout();
      this.scheduleRelayout();
    }, ms);
    this.register(() => window.clearTimeout(id));
  }

  /**
   * Pushes each stack down until it clears the one above it. Every stack is
   * positioned against its own block, so two blocks close together produce two
   * stacks in the same place. Nothing but measuring after the fact can tell:
   * the height of a card depends on the text inside it.
   */
  layoutStacks(view) {
    let stacks = [];
    try {
      stacks = Array.prototype.slice.call(
        view.querySelectorAll('.lkn-card-stack:not(.lkn-card-inline)')
      );
    } catch (e) {
      return;
    }
    if (!stacks.length) return;

    // Measure from the natural position, not from wherever the last pass left it.
    for (const stack of stacks) stack.style.top = '0px';

    let floor = -Infinity;
    for (const stack of stacks) {
      const host = stack.parentElement;
      if (!host || !stack.isConnected) continue;
      this.capStack(stack);
      const hostTop = host.getBoundingClientRect().top;
      const height = stack.getBoundingClientRect().height;
      const top = Math.max(hostTop, floor);
      const shift = Math.round(top - hostTop);
      stack.style.top = shift + 'px';
      // How far the stack had to move, so a leader line can trace it back.
      // Held on the block, not the stack: a stack that scrolls would clip it.
      host.style.setProperty('--lkn-shift', shift + 'px');
      floor = top + height + CARD_STACK_GAP;
    }
  }

  /**
   * Limits how many cards a stack shows at once; the rest are reached by
   * scrolling inside it. Measured rather than calculated, since a card is as
   * tall as the note inside it.
   */
  capStack(stack) {
    const limit = Number(this.settings.cardsPerStack) || 0;
    let cards = [];
    try {
      cards = Array.prototype.slice.call(stack.children).filter(
        (c) => c.classList && c.classList.contains('lkn-card')
      );
    } catch (e) {
      return;
    }

    // Measure the natural layout, not whatever the last pass left behind.
    stack.style.maxHeight = '';
    if (!limit || cards.length <= limit) {
      stack.classList.remove('lkn-stack-scroll');
      return;
    }

    const top = stack.getBoundingClientRect().top;
    const last = cards[limit - 1].getBoundingClientRect();
    stack.style.maxHeight = Math.max(40, Math.round(last.bottom - top)) + 'px';
    stack.classList.add('lkn-stack-scroll');
  }

  /** One relayout per frame, however many things ask for it. */
  scheduleRelayout() {
    if (this.relayoutPending) return;
    this.relayoutPending = true;
    const run = () => {
      this.relayoutPending = false;
      for (const doc of this.openDocuments()) {
        let views = [];
        try {
          views = Array.prototype.slice.call(doc.querySelectorAll('.markdown-preview-view'));
        } catch (e) {
          continue;
        }
        for (const view of views) this.layoutStacks(view);
      }
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
    else window.setTimeout(run, 16);
  }

  /** Re-decides every card on screen, after a resize or a settings change. */
  refitCards() {
    for (const doc of this.openDocuments()) {
      let stacks = [];
      try {
        stacks = Array.prototype.slice.call(doc.querySelectorAll('.lkn-card-stack'));
      } catch (e) {
        continue;
      }
      for (const stack of stacks) this.fitStack(stack);
      this.scheduleRelayout();
      if (!this.settings.showCards) {
        const views = doc.querySelectorAll('.lkn-cards');
        for (const v of Array.prototype.slice.call(views)) v.classList.remove('lkn-cards');
      }
    }
  }

  /** Every document the workspace is drawing into, main window and popouts. */
  openDocuments() {
    const docs = new Set([document]);
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const el = leaf && leaf.view && leaf.view.containerEl;
        if (el && el.ownerDocument) docs.add(el.ownerDocument);
      });
    } catch (e) {
      /* the main document is enough */
    }
    return Array.from(docs);
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

    // On mobile there is nowhere near the selection that the OS menu will not
    // claim: it sits above the selection, or below it when there is no room.
    // A one-line selection leaves no gap at all. So the button leaves the
    // neighbourhood entirely and becomes a bar along the bottom of the screen.
    if (Platform.isMobile) {
      btn.style.top = '';
      btn.style.left = '';
      btn.style.display = 'block';
      return;
    }

    const top = Math.min(rect.bottom + 6, win.innerHeight - 48);
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
        const result = await this.createLinknote(snap, values);
        new Notice('Linknote created: ' + result.file.basename);
        if (this.settings.openAfterCreate) {
          // Let the cache catch up, or the embed resolves to the whole note.
          await this.waitForBlock(result.sourceFile, result.blockId);
          await this.app.workspace.getLeaf('split').openFile(result.file);
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

    // A heading is referenced by its own anchor, never by a block ID.
    const headingText = headingTextOf(blockSrc);
    const wantBlockId = s.useBlockId && !headingText;

    let blockId = headingText ? null : existingBlockId(blockSrc);
    const isNewId = !blockId;
    if (wantBlockId && !blockId) {
      do {
        blockId = randomId(6);
      } while (currentContent.includes('^' + blockId));
    }

    // The note is written first, because the marker needs a link to it.
    const noteFile = await this.writeLinknote(
      sourceFile,
      snap,
      values,
      wantBlockId ? blockId : null,
      headingText
    );

    const link = s.useInlineLink
      ? app.fileManager.generateMarkdownLink(noteFile, sourceFile.path, undefined, s.marker)
      : '';
    const idToWrite = wantBlockId && isNewId ? blockId : '';
    const anchored = buildAnchoredBlock(blockSrc, link, idToWrite);

    if (anchored !== blockSrc) {
      await this.processFile(sourceFile, (data) => {
        const at = data.indexOf(blockSrc);
        if (at === -1) return data;
        return data.slice(0, at) + anchored + data.slice(at + blockSrc.length);
      });
    }

    return { file: noteFile, sourceFile, blockId: wantBlockId ? blockId : '', headingText };
  }

  /**
   * Waits until the metadata cache knows about a block ID.
   *
   * The linknote is written before the anchor reaches the source, and the
   * cache updates asynchronously afterwards. Opening the linknote before the
   * cache has caught up makes `![[Note#^id]]` resolve to nothing, and Obsidian
   * falls back to embedding the whole note. Resolves early on timeout so a
   * missed event can never leave the caller hanging.
   */
  async waitForBlock(file, blockId, timeoutMs) {
    if (!file || !blockId) return;
    const cacheHasBlock = () => {
      const cache = this.app.metadataCache && this.app.metadataCache.getFileCache(file);
      return !!(cache && cache.blocks && cache.blocks[blockId]);
    };
    if (cacheHasBlock()) return;

    await new Promise((resolve) => {
      let settled = false;
      let ref = null;
      const timer = setTimeout(() => finish(), timeoutMs || 2000);
      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      const done = () => {
        if (ref && this.app.metadataCache.offref) this.app.metadataCache.offref(ref);
        finish();
      };
      ref = this.app.metadataCache.on('changed', (changed) => {
        if (changed && changed.path === file.path && cacheHasBlock()) done();
      });
      if (cacheHasBlock()) done();
    });
  }

  async writeLinknote(sourceFile, snap, values, blockId, headingText) {
    const app = this.app;
    const s = this.settings;
    const now = new Date();

    const rawTitle = (values.title || snap.text).trim().replace(/\s+/g, ' ');

    await this.ensureFolder(s.folder);

    // A provisional path is enough to generate links relative to the folder.
    const provisional = normalizePath(`${s.folder}/tmp.md`);
    const source = app.fileManager.generateMarkdownLink(sourceFile, provisional);
    const subpath = blockId ? '#^' + blockId : headingText ? '#' + headingText : '';
    // A link to the exact spot, rather than to the note as a whole. With no
    // anchor to point at it falls back to the note, so a template that uses it
    // still reads correctly when block IDs are turned off.
    const sourceBlock = subpath
      ? app.fileManager.generateMarkdownLink(sourceFile, provisional, subpath)
      : source;
    // A heading carries no block ID, so its anchor is a heading link. Embedding
    // one pulls in the whole section — every subsection down to the next
    // heading of the same level — which for a top-level heading is most of the
    // note. A link is used instead; hovering it previews the section.
    const embed = !subpath ? '' : headingText && !blockId ? sourceBlock : '!' + sourceBlock;

    const excerpt = snap.text.replace(/\s+/g, ' ').slice(0, 40);
    const body = (values.body || '').trim();
    const vars = {
      title: rawTitle,
      titleShort: shortenTitle(rawTitle),
      body,
      // Every line prefixed, so a note of several lines stays inside a callout.
      bodyQuote: body ? body.split('\n').map((l) => '> ' + l).join('\n') : '',
      bodyYaml: toYamlBlock(body),
      selection: snap.text,
      selectionQuote: snap.text.split('\n').map((l) => '> ' + l).join('\n'),
      source,
      sourceBlock,
      sourceName: sourceFile.basename,
      sourcePath: sourceFile.path,
      embed,
      blockId: blockId || '',
      // What the linknote is pinned to, in a form a filename can carry. A
      // heading has no block ID, so without this every linknote on a heading
      // in the same note would want the same name.
      anchor: blockId || headingText || '',
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
      buildFileName(s.filenameTemplate, fileVars) ||
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

/**
 * The linknotes of whatever note is in front, listed in the order they appear
 * in it. The cards answer "what is written here"; this answers "what has been
 * written about this note, and where". On a phone it is the only answer, since
 * cards there have nowhere to go.
 */
class LinknoteListView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return LIST_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Linknotes';
  }

  getIcon() {
    return 'message-square';
  }

  async onOpen() {
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.draw()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.draw()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.draw()));
    await this.draw();
  }

  async draw() {
    const el = this.contentEl;
    el.addClass('lkn-list');

    const file = this.app.workspace.getActiveFile();
    if (!file) {
      el.empty();
      el.createDiv({ cls: 'lkn-list-empty', text: 'No note is open.' });
      return;
    }

    const entries = await this.plugin.linknotesOf(file);
    await this.plugin.renderLinknoteRows(el, file, entries, () => this.draw());
  }
}

/** What removing a linknote will do, said plainly, before it is done. */
class LinknoteRemoveModal extends Modal {
  constructor(app, plugin, plan, onRemoved) {
    super(app);
    this.plugin = plugin;
    this.plan = plan;
    this.onRemoved = onRemoved;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('lkn-modal');
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Remove this linknote?' });

    const list = contentEl.createEl('ul', { cls: 'lkn-remove-list' });
    list.createEl('li', {
      text: '“' + this.plan.noteFile.basename + '” goes to wherever your vault sends deleted files.',
    });
    list.createEl('li', {
      text: 'Its marker is taken out of “' + this.plan.sourceFile.basename + '”.',
    });
    if (this.plan.blockId && this.plan.dropBlockId) {
      list.createEl('li', {
        text: 'The block ID ^' + this.plan.blockId + ' goes too — nothing else in the vault points at it.',
      });
    } else if (this.plan.blockId) {
      list.createEl('li', {
        text: 'The block ID ^' + this.plan.blockId + ' stays: something else in the vault points at it.',
      });
    }
    contentEl.createDiv({
      cls: 'lkn-hint',
      text: 'Nothing else in either note is touched.',
    });

    const buttons = contentEl.createDiv({ cls: 'lkn-buttons' });
    buttons.createDiv({ cls: 'lkn-hint' });
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const go = buttons.createEl('button', { text: 'Remove', cls: 'mod-warning' });
    go.addEventListener('click', async () => {
      this.close();
      const done = await this.plugin.applyRemoval(this.plan);
      if (done && typeof this.onRemoved === 'function') this.onRemoved();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** One block's linknotes, as a sheet. What a marker opens on a phone. */
class LinknoteSheet extends Modal {
  constructor(app, plugin, sourceFile, entries) {
    super(app);
    this.plugin = plugin;
    this.sourceFile = sourceFile;
    this.entries = entries;
  }

  onOpen() {
    this.modalEl.addClass('lkn-sheet');
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Linknotes' });
    const list = this.contentEl.createDiv({ cls: 'lkn-list' });
    this.plugin.renderLinknoteRows(list, this.sourceFile, this.entries, () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

class LinknoteModal extends Modal {
  constructor(app, plugin, snap, onSubmit) {
    super(app);
    this.plugin = plugin;
    this.snap = snap;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const mobile = !!Platform.isMobile;
    modalEl.addClass('lkn-modal');
    if (mobile) modalEl.addClass('lkn-modal-mobile');
    contentEl.empty();

    contentEl.createEl('h3', { text: 'New linknote' });

    // On mobile the on-screen keyboard takes roughly half the screen, so Save
    // has to sit above the fold. Everything below it may be out of reach.
    const buttons = mobile ? contentEl.createDiv({ cls: 'lkn-buttons' }) : null;

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

    const noteHead = contentEl.createDiv({ cls: 'lkn-label lkn-label-row' });
    noteHead.createSpan({ text: 'Note' });
    const tools = noteHead.createDiv({ cls: 'lkn-tools' });

    const bodyInput = contentEl.createEl('textarea', { cls: 'lkn-body' });
    bodyInput.placeholder = 'Markdown is supported.';

    const suggest = contentEl.createDiv({ cls: 'lkn-suggest' });
    suggest.style.display = 'none';

    let matches = [];
    let active = 0;
    let range = null;

    const closeSuggest = () => {
      suggest.style.display = 'none';
      matches = [];
      range = null;
    };

    const drawSuggest = () => {
      suggest.empty();
      matches.forEach((tag, i) => {
        const row = suggest.createDiv({
          cls: 'lkn-suggest-item' + (i === active ? ' is-active' : ''),
          text: '#' + tag,
        });
        // mousedown, not click: the textarea must not lose the caret first.
        row.addEventListener('mousedown', (evt) => {
          evt.preventDefault();
          pick(tag);
        });
      });
      suggest.style.display = matches.length ? 'block' : 'none';
    };

    const pick = (tag) => {
      if (!range || !tag) return;
      const next = applyTagPick(bodyInput.value, range, tag);
      bodyInput.value = next.text;
      bodyInput.setSelectionRange(next.cursor, next.cursor);
      closeSuggest();
      bodyInput.focus();
    };

    const refreshSuggest = () => {
      range = tagQueryAt(bodyInput.value, bodyInput.selectionStart);
      if (!range) return closeSuggest();
      matches = filterTags(this.plugin.vaultTags(), range.query);
      active = 0;
      drawSuggest();
    };

    const insertAtCaret = (text) => {
      const at = bodyInput.selectionStart;
      const before = bodyInput.value.slice(0, at);
      const pad = before && !/\s$/.test(before) ? ' ' : '';
      bodyInput.value = before + pad + text + bodyInput.value.slice(at);
      const c = at + pad.length + text.length;
      bodyInput.setSelectionRange(c, c);
      bodyInput.focus();
    };

    const taskBtn = tools.createEl('button', { cls: 'lkn-tool', text: 'Task' });
    taskBtn.setAttribute('aria-label', 'Turn this line into a task');
    taskBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      const next = toggleTaskLine(bodyInput.value, bodyInput.selectionStart);
      bodyInput.value = next.text;
      bodyInput.setSelectionRange(next.cursor, next.cursor);
      bodyInput.focus();
    });

    const tagBtn = tools.createEl('button', { cls: 'lkn-tool', text: 'Tag' });
    tagBtn.setAttribute('aria-label', 'Insert a tag');
    tagBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      insertAtCaret('#');
      refreshSuggest();
    });

    bodyInput.addEventListener('input', refreshSuggest);
    bodyInput.addEventListener('click', refreshSuggest);
    bodyInput.addEventListener('blur', () => window.setTimeout(closeSuggest, 120));
    bodyInput.addEventListener('keydown', (evt) => {
      if (!matches.length) return;
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        active = (active + 1) % matches.length;
        drawSuggest();
      } else if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        active = (active - 1 + matches.length) % matches.length;
        drawSuggest();
      } else if (evt.key === 'Enter' && !evt.metaKey && !evt.ctrlKey) {
        evt.preventDefault();
        pick(matches[active]);
      } else if (evt.key === 'Escape') {
        // Otherwise Esc would close the composer and lose what was typed.
        evt.preventDefault();
        evt.stopPropagation();
        closeSuggest();
      }
    });

    const row = buttons || contentEl.createDiv({ cls: 'lkn-buttons' });
    if (!mobile) {
      const mod = Platform.isMacOS ? '⌘' : 'Ctrl';
      row.createDiv({ cls: 'lkn-hint', text: `Save with ${mod} + Enter` });
    } else {
      row.createDiv({ cls: 'lkn-hint' });
    }

    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());

    const save = row.createEl('button', { text: 'Save', cls: 'mod-cta' });
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

    if (mobile) this.fitAboveKeyboard(modalEl);

    // Auto-focus fights the on-screen keyboard on mobile.
    if (!mobile) window.setTimeout(() => bodyInput.focus(), 0);
  }

  /**
   * Keeps the composer inside the part of the screen the keyboard has left.
   * The layout viewport does not shrink when the keyboard opens, so a modal
   * centred in it ends up half buried. visualViewport reports what is really
   * visible; the height it gives drives a max-height on the modal.
   */
  fitAboveKeyboard(modalEl) {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv || !modalEl || !modalEl.style) return;

    const fit = () => {
      // Pin to the top of what is visible. Capping the height is not enough:
      // the modal stays where it was, so the lower half goes under the keyboard.
      modalEl.style.setProperty('--lkn-fit-top', Math.round((vv.offsetTop || 0) + 8) + 'px');
      modalEl.style.setProperty('--lkn-fit-height', Math.max(180, Math.round(vv.height - 16)) + 'px');
    };

    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    this.detachFit = () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }

  onClose() {
    if (this.detachFit) {
      this.detachFit();
      this.detachFit = null;
    }
    this.contentEl.empty();
  }
}

/* --------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------ */

const TEMPLATE_VARIABLES = [
  ['{{titleShort}}', 'the title, cut to 30 characters with an ellipsis, for a heading or callout'],
  ['{{title}}', 'the title you typed, or the start of the selection'],
  ['{{body}}', 'the note you typed'],
  ['{{bodyQuote}}', 'the note you typed, every line prefixed with "> " so it stays inside a callout'],
  ['{{bodyYaml}}', 'the note you typed, as a YAML block scalar, safe to put in a property'],
  ['{{selection}}', 'the selected text'],
  ['{{selectionQuote}}', 'the selected text, every line prefixed with "> "'],
  ['{{source}}', 'link to the source note'],
  ['{{sourceName}}', 'name of the source note'],
  ['{{sourcePath}}', 'path of the source note'],
  ['{{sourceBlock}}', 'link to the anchored spot, not just the note; falls back to the note when there is no anchor'],
  ['{{embed}}', 'embed of the anchored block; a link when the anchor is a heading, empty when block IDs are off'],
  ['{{blockId}}', 'the block ID, without the caret'],
  ['{{anchor}}', 'what the linknote is pinned to: the block ID, or the heading text when it is a heading'],
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

    new Setting(containerEl).setName('Appearance').setHeading();

    new Setting(containerEl)
      .setName('Marker style')
      .setDesc('How the marker looks in the source note. Rendering only — nothing is written to your notes.')
      .addDropdown((d) => {
        d.addOption('chip', 'Chip — small badge');
        d.addOption('plain', 'Plain — an ordinary link');
        d.setValue(s.markerStyle || DEFAULT_SETTINGS.markerStyle);
        d.onChange(async (v) => {
          s.markerStyle = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Mark the annotated block')
      .setDesc('Draws a thin rule beside any block that carries a linknote, so annotated passages stand out while reading.')
      .addToggle((t) =>
        t.setValue(s.highlightAnchored).onChange(async (v) => {
          s.highlightAnchored = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Show linknotes as cards')
      .setDesc(
        'Draws each linknote beside the passage it annotates — in the margin where the window is wide enough, ' +
        'inline where it is not. Reading view only, and nothing is written to your notes. Default: off'
      )
      .addToggle((t) =>
        t.setValue(s.showCards).onChange(async (v) => {
          s.showCards = v;
          await this.plugin.saveSettings();
          this.plugin.clearCardLayout();
        })
      );

    new Setting(containerEl)
      .setName('Card width')
      .setDesc(
        'How wide a card in the margin is. The room made for it follows, so a narrower card ' +
        'leaves more of the pane to the text. Default: ' + DEFAULT_SETTINGS.cardWidth + 'px'
      )
      .addSlider((sl) =>
        sl
          .setLimits(160, 400, 20)
          .setValue(Number(s.cardWidth) || DEFAULT_SETTINGS.cardWidth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardWidth = v;
            await this.plugin.saveSettings();
            this.plugin.applyCardStyle();
            this.plugin.refitCards();
          })
      );

    new Setting(containerEl)
      .setName('Card height')
      .setDesc(
        'How many lines a card shows before it starts to scroll. Shorter keeps the column tidy ' +
        'where several passages carry notes. Default: ' + DEFAULT_SETTINGS.cardMaxLines + ' lines'
      )
      .addSlider((sl) =>
        sl
          .setLimits(3, 24, 1)
          .setValue(Number(s.cardMaxLines) || DEFAULT_SETTINGS.cardMaxLines)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardMaxLines = v;
            await this.plugin.saveSettings();
            this.plugin.applyCardStyle();
            this.plugin.scheduleRelayout();
          })
      );

    new Setting(containerEl)
      .setName('Cards shown per block')
      .setDesc(
        'How many cards a block shows at once; any beyond that are reached by scrolling the group. ' +
        'Zero shows them all. Default: ' + DEFAULT_SETTINGS.cardsPerStack
      )
      .addSlider((sl) =>
        sl
          .setLimits(0, 10, 1)
          .setValue(Number(s.cardsPerStack) || 0)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardsPerStack = v;
            await this.plugin.saveSettings();
            this.plugin.scheduleRelayout();
          })
      );

    new Setting(containerEl)
      .setName('Card text size')
      .setDesc('As a percentage of the size Obsidian uses for small interface text. Default: 100')
      .addSlider((sl) =>
        sl
          .setLimits(70, 130, 5)
          .setValue(Number(s.cardFontScale) || DEFAULT_SETTINGS.cardFontScale)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardFontScale = v;
            await this.plugin.saveSettings();
            this.plugin.applyCardStyle();
          })
      );

    new Setting(containerEl)
      .setName('Card text colour')
      .setDesc(
        'The first four follow your theme, so they stay readable when you switch between light ' +
        'and dark. A custom colour does not. Default: Normal'
      )
      .addDropdown((d) => {
        d.addOption('normal', 'Normal');
        d.addOption('muted', 'Muted');
        d.addOption('faint', 'Faint');
        d.addOption('accent', 'Accent');
        d.addOption('custom', 'Custom');
        d.setValue(s.cardTextColour || DEFAULT_SETTINGS.cardTextColour);
        d.onChange(async (v) => {
          s.cardTextColour = v;
          await this.plugin.saveSettings();
          this.plugin.applyCardStyle();
        });
      })
      .addColorPicker((c) =>
        c.setValue(s.cardTextColourCustom || '#888888').onChange(async (v) => {
          s.cardTextColourCustom = v;
          s.cardTextColour = 'custom';
          await this.plugin.saveSettings();
          this.plugin.applyCardStyle();
        })
      );

    new Setting(containerEl)
      .setName('Card placement')
      .setDesc(
        'In the margin, the text column is narrowed to make room, which is what a margin note costs. ' +
        'A narrow pane and a phone fall back to inline whichever is chosen. Default: In the margin'
      )
      .addDropdown((d) => {
        d.addOption('margin', 'In the margin');
        d.addOption('inline', 'Under the block');
        d.setValue(s.cardPlacement || DEFAULT_SETTINGS.cardPlacement);
        d.onChange(async (v) => {
          s.cardPlacement = v;
          await this.plugin.saveSettings();
          this.plugin.refitCards();
        });
      });

    new Setting(containerEl)
      .setName('Body heading')
      .setDesc(
        'The heading in a linknote that marks your own note, as opposed to the quoted source. ' +
        'The cards read the section under it. Default: ' + DEFAULT_SETTINGS.bodyHeading
      )
      .addText((t) =>
        t.setPlaceholder(DEFAULT_SETTINGS.bodyHeading).setValue(s.bodyHeading).onChange(async (v) => {
          s.bodyHeading = v.trim() || DEFAULT_SETTINGS.bodyHeading;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Write the body property from the note')
      .setDesc(
        'The note is the original and the property is a copy of it. Edit the section under the body ' +
        'heading and Linknote writes it to the note\'s body property, so a query sees what the note ' +
        'now says. Editing that property directly has no lasting effect: it is overwritten from the ' +
        'note the next time the file is read. To change the text, change the note. Only linknotes ' +
        'that already carry the property are touched, never any other note. Turn this off to leave ' +
        'the property exactly as it was first written. Default: on'
      )
      .addToggle((t) =>
        t.setValue(s.syncBodyProperty).onChange(async (v) => {
          s.syncBodyProperty = v;
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
module.exports.looseKey = looseKey;
module.exports.findBlockContaining = findBlockContaining;
module.exports.existingBlockId = existingBlockId;
module.exports.headingTextOf = headingTextOf;
module.exports.sanitizeFileName = sanitizeFileName;
module.exports.clampChars = clampChars;
module.exports.clampBytes = clampBytes;
module.exports.shortenTitle = shortenTitle;
module.exports.toYamlBlock = toYamlBlock;
module.exports.stripFrontmatter = stripFrontmatter;
module.exports.sectionUnderHeading = sectionUnderHeading;
module.exports.anchorExcerpt = anchorExcerpt;
module.exports.normaliseLinkTarget = normaliseLinkTarget;
module.exports.linkNamesFor = linkNamesFor;
module.exports.removeLinkFromLine = removeLinkFromLine;
module.exports.blockIdOfLine = blockIdOfLine;
module.exports.removeAnchor = removeAnchor;
module.exports.toggleTaskLine = toggleTaskLine;
module.exports.tagQueryAt = tagQueryAt;
module.exports.applyTagPick = applyTagPick;
module.exports.collectTags = collectTags;
module.exports.filterTags = filterTags;
module.exports.CALLOUT_NOTE_TEMPLATE = CALLOUT_NOTE_TEMPLATE;
module.exports.tidyFileName = tidyFileName;
module.exports.buildFileName = buildFileName;
module.exports.EMBED_NOTE_TEMPLATE = EMBED_NOTE_TEMPLATE;
module.exports.previewFilename = previewFilename;
module.exports.sampleFilenameVars = sampleFilenameVars;
module.exports.formatDate = formatDate;
module.exports.renderTemplate = renderTemplate;
module.exports.tidy = tidy;
module.exports.DEFAULT_NOTE_TEMPLATE = DEFAULT_NOTE_TEMPLATE;
module.exports.TEMPLATE_PRESETS = TEMPLATE_PRESETS;
