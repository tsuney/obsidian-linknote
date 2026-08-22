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
  requestUrl,
} = obsidian;

/* --------------------------------------------------------------------------
 * Templates
 * ------------------------------------------------------------------------ */

const DEFAULT_NOTE_TEMPLATE = `---
type: Linknote
created: {{date}} {{time}}
source: "{{sourceBlock}}"
author: {{author}}
selection: {{selectionYaml}}
body: {{bodyYaml}}
---
> [!NOTE]- {{titleShort}}... {{sourceBlock}}
{{selectionQuote}}
## {{bodyHeading}}
{{body}}
`;

// What the default template was in earlier versions. Kept so that a vault
// carrying one of them is not asked whether its "own" template may be
// replaced — it is the shipped one, only older.
const LEGACY_NOTE_TEMPLATES = [
  DEFAULT_NOTE_TEMPLATE.replace('## {{bodyHeading}}', '## Linknote'),
  DEFAULT_NOTE_TEMPLATE.replace('{{selectionQuote}}\n##', '{{selectionQuote}}\n\n##'),
  DEFAULT_NOTE_TEMPLATE.replace('{{selectionQuote}}\n## {{bodyHeading}}', '{{selectionQuote}}\n\n## Linknote'),
];

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
  listSort: 'position',
  cardTextColourCustom: '',
  notifyOthers: true,
  listScope: 'note',
  readOn: 'open',
  noteAuthor: '',
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
// The highlight registry is one namespace per window, shared with every other
// plugin and theme, so the key is spelled out in full.
const HIGHLIGHT_KEY = 'linknote-passage';
// What the passage search must never walk into: this plugin's own cards, and
// the panes Obsidian hangs below a note, which quote the same words back.
const SKIP_IN_SEARCH = '.lkn-card-stack, .embedded-backlinks, .backlink-pane, .search-result-container, .metadata-container';
// A marker on a line of its own — after a table, a code block, a heading — is
// a block by itself, so the words it is about are in a block above it.
const HIGHLIGHT_LOOKBACK = 3;

/*
 * Update notices. Sync delivers changes in bursts, so single events are
 * gathered for a moment and announced as one notice; right after start-up the
 * moment is longer, because that is when sync catches up on everything at
 * once and a notice per burst would still be several notices.
 */
const NOTICE_GATHER_MS = 5000;
const STARTUP_QUIET_MS = 30000;
// How long a notice stays. Long enough to be caught by someone who looks up
// from another window, short enough not to sit over the text. What is missed
// anyway is kept by the ribbon count, which does not time out.
const NOTICE_SHOWN_MS = 20000;
// How long after this device writes a linknote file its own create and modify
// events are ignored. Well past any burst of events one write can raise.
const SELF_WRITE_MS = 10000;

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
 * Where a passage sits inside a longer text, ignoring how the whitespace was
 * broken. Returns offsets into the original string, or null when the passage
 * is not there. Used to highlight the words a linknote is about inside the
 * block it is anchored to: the text was recorded from the rendered note, so it
 * matches what is on screen rather than the markup.
 */
function runInText(raw, needle) {
  const hay = collapseWithMap(String(raw == null ? '' : raw));
  const want = collapseWithMap(String(needle == null ? '' : needle)).text;
  if (!want) return null;

  const at = hay.text.indexOf(want);
  if (at === -1) return null;
  return { start: hay.map[at], end: hay.map[at + want.length - 1] + 1 };
}

/** Collapses runs of whitespace, keeping a map back to the original offsets. */
function collapseWithMap(raw) {
  const out = [];
  const map = [];
  let pending = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      pending = out.length > 0;
      continue;
    }
    if (pending) {
      out.push(' ');
      map.push(i);
      pending = false;
    }
    out.push(raw[i]);
    map.push(i);
  }
  return { text: out.join(''), map };
}

/**
 * The passage to show for a linknote: the `selection` property when it is
 * there, and otherwise the quote the note keeps it in. One place decides it,
 * so a card and a sidebar row never disagree.
 */
function selectionShown(frontmatter, content, bodyHeading) {
  const fm = frontmatter || null;
  const raw =
    fm && (typeof fm.selection === 'string' || typeof fm.selection === 'number')
      ? String(fm.selection)
      : '';
  const text = raw.trim() ? raw : quotedSelectionOf(content, bodyHeading);
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * The passage a linknote was made from, read back out of the note.
 *
 * Used when the note carries no `selection` property — every linknote written
 * before that property existed, and any template that leaves it out. The
 * shipped templates put the passage in a quote above the body heading, so the
 * first run of quoted lines there is it. A callout's own title line names the
 * note rather than the passage, so it is skipped.
 */
function quotedSelectionOf(content, bodyHeading) {
  const body = stripFrontmatter(content);
  const heading = String(bodyHeading == null ? '' : bodyHeading).trim();
  const out = [];

  for (const line of body.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      const title = line.replace(/^#{1,6}\s+/, '').replace(/\s*\^[A-Za-z0-9-]+$/, '').trim();
      if (!heading || title === heading) break;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (!quoted) {
      if (out.length) break;
      continue;
    }
    const inner = quoted[1];
    if (/^\s*\[!/.test(inner)) continue;
    out.push(inner.trim());
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
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
/**
 * A folder a linknote may be written to. Empty means "not set", which the
 * caller turns into the default: an empty folder would make every note in the
 * vault a linknote. A path that climbs out of the vault is refused outright.
 */
function safeFolder(value) {
  const clean = String(value == null ? '' : value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();
  if (!clean) return '';
  if (clean.split('/').some((part) => part === '..')) return '';
  return clean;
}

/**
 * A webhook address that is safe to post to, or nothing.
 *
 * HTTPS only. A webhook carries its secret in the address itself, so over
 * plain HTTP the secret would go out in clear and anyone on the wire could
 * post to the channel afterwards.
 */
function safeWebhook(value) {
  const url = String(value == null ? '' : value).trim();
  if (!url) return '';
  if (!/^https:\/\/[^\s]+$/i.test(url)) return '';
  return url;
}

/**
 * Settings as read from data.json, made safe to use. The file is ordinary
 * JSON in the vault: it can be hand-edited, or arrive over sync from another
 * device, so nothing in it is trusted to be the right shape.
 */
function sanitizeSettings(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    const fallback = DEFAULT_SETTINGS[key];

    if (typeof fallback === 'boolean') {
      out[key] = !!value;
    } else if (typeof fallback === 'number') {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }

  const folder = safeFolder(out.folder);
  if (!folder) delete out.folder;
  else out.folder = folder;


  if (typeof out.filenameTemplate === 'string' && !out.filenameTemplate.trim()) {
    delete out.filenameTemplate;
  }
  return out;
}

/** What a link shows: the alias of a wikilink, or the text of a markdown link. */
function linkDisplayText(raw) {
  const value = String(raw == null ? '' : raw);
  const wiki = value.match(/^!?\[\[([^\]]+)\]\]$/);
  if (wiki) {
    const bar = wiki[1].indexOf('|');
    return (bar === -1 ? wiki[1] : wiki[1].slice(bar + 1)).trim();
  }
  const md = value.match(/^!?\[([^\]]*)\]\(/);
  return md ? md[1].trim() : '';
}

function removeLinkFromLine(line, names) {
  const value = String(line == null ? '' : line);
  const wanted = (names || []).map(normaliseLinkTarget);

  // Every link to the note on this line, not just the first. One line may
  // hold the marker and a mention of the same note in the prose, and removing
  // the wrong one would take the prose link and leave the marker behind.
  const found = [];
  for (const re of [WIKILINK_RE, MDLINK_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(value)) !== null) {
      if (wanted.indexOf(normaliseLinkTarget(m[1])) === -1) continue;
      found.push({ at: m.index, len: m[0].length, text: linkDisplayText(m[0]) });
    }
  }
  if (!found.length) return { line: value, removed: false, count: 0 };

  // With more than one, the marker is the one that looks like a marker. If
  // that is still not a single link, the caller is told and stops.
  let hits = found;
  if (hits.length > 1) {
    const markerish = hits.filter((h) => markerMatch(h.text, '') === 'maybe');
    if (markerish.length === 1) hits = markerish;
  }
  if (hits.length > 1) return { line: value, removed: false, count: hits.length };

  const hit = hits[0];
  const before = value.slice(0, hit.at).replace(/[ \t]+$/, '');
  const after = value.slice(hit.at + hit.len);
  return { line: before + after, removed: true, count: 1 };
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
  let crowded = false;
  for (let i = 0; i < lines.length; i++) {
    const out = removeLinkFromLine(lines[i], names);
    if (out.removed) hits.push(i);
    else if (out.count > 1) crowded = true;
  }

  if (crowded) return { ok: false, reason: 'ambiguous', content: null, blockId: '' };
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

/**
 * The block a card hangs on: the list item a marker sits in, or the top-level
 * block Reading view wrapped it in.
 *
 * The fallback matters. A card is positioned against its host, so when the
 * caller passes the whole view — which the sweep does — falling back to that
 * hung the card off the view itself and put it off the side of the screen.
 * Turning cards off and on again was enough to see it: everything is rebuilt
 * by the sweep, and nothing came back.
 */
function hostBlockOf(a, fallback) {
  try {
    const li = a.closest && a.closest('li');
    if (li) return li;

    const sizer = a.closest && a.closest('.markdown-preview-sizer, .markdown-preview-view, .markdown-rendered');
    if (sizer) {
      let node = a.parentElement;
      while (node && node.parentElement && node.parentElement !== sizer) node = node.parentElement;
      if (node && node.parentElement === sizer) return node;
    }
  } catch (e) {
    /* fall back */
  }
  return fallback;
}

/**
 * The block a marker has to itself, or null when the marker shares its block
 * with other text. Climbs while the ancestor holds nothing but the marker, so
 * the answer is the same whether the caller has the block in hand or the whole
 * view. Stops at the rendered container, which is not a block.
 */
function markerBlockOf(a, marker) {
  const wanted = String(marker == null ? '' : marker).trim();
  if (!wanted || !a) return null;

  let node = a.parentElement;
  let best = null;
  for (let i = 0; i < 6 && node; i++) {
    const stop =
      node.classList &&
      (node.classList.contains('markdown-preview-view') ||
        node.classList.contains('markdown-preview-sizer') ||
        node.classList.contains('markdown-rendered'));
    if (stop) break;
    if (String(node.textContent || '').trim() === wanted) best = node;
    else if (best) break;
    node = node.parentElement;
  }
  return best;
}

/**
 * Where a block sits in a note, counting only whole-line matches.
 *
 * A plain indexOf also matches a block that is a prefix of a longer line —
 * which is exactly what a stale selection looks like once a marker has been
 * appended to it. Anchoring there wrote the second marker into the middle of
 * the line, stranding the first block ID and leaving both linknotes pointing
 * at nothing.
 */
function blockOccurrences(content, block) {
  const text = String(content == null ? '' : content);
  const needle = String(block == null ? '' : block);
  if (!needle) return [];

  const out = [];
  let at = text.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? '\n' : text[at - 1];
    // Trailing spaces belong to the match: a block found by searching has had
    // them trimmed off, and leaving them behind would strand them after the
    // block ID.
    let end = at + needle.length;
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
    const after = end >= text.length ? '\n' : text[end];
    if (before === '\n' && (after === '\n' || after === '\r')) {
      out.push({ at, len: end - at });
    }
    at = text.indexOf(needle, at + 1);
  }
  return out;
}

/**
 * Puts the anchored block back into the note.
 *
 * When the marker had to go on a line of its own — a heading, a table, a code
 * block — it needs a blank line after it as well as before. Without one it
 * joins whatever follows into a single block: the marker can no longer be
 * drawn up beside its heading, and it is read as part of the next paragraph
 * or list. A heading written straight above its list is the common case.
 */
function spliceAnchored(data, at, len, blockSrc, anchored) {
  const text = String(data == null ? '' : data);
  // Read from the result rather than by slicing at the old length: the block
  // may have had trailing spaces, which buildAnchoredBlock trims away.
  const ownLine = /\n\n[^\n]*$/.test(anchored);
  let rest = text.slice(at + len);

  if (ownLine && rest) {
    const next = rest.replace(/^\r?\n/, '');
    const started = next !== rest;
    const firstLine = next.split('\n')[0];
    if (started && firstLine.trim()) rest = '\n' + rest;
  }
  return text.slice(0, at) + anchored + rest;
}

/**
 * Escapes a value for use inside a quoted attribute selector. Quotes and
 * backslashes are escaped; a line break is written as a CSS escape, since a
 * raw one inside a string makes the whole selector a parse error — and a file
 * name may carry one when it arrives from another system.
 */
function cssEscape(value) {
  return String(value)
    .replace(/["\\]/g, '\\$&')
    .replace(/\n/g, '\\00000a')
    .replace(/\r/g, '\\00000d')
    .replace(/\f/g, '\\00000c');
}

/**
 * The marker a link is written with, taken from the link itself rather than
 * from any setting: the note may have been made on another device. Empty when
 * the link carries no alias, or one too long to be a marker.
 */
function markerOfLink(link) {
  const raw = String((link && link.original) || '');
  const bar = raw.indexOf('|');
  const alias = bar === -1 ? '' : raw.slice(bar + 1).replace(/\]+$/, '').trim();
  const text = alias || String((link && link.displayText) || '').trim();
  return markerMatch(text, '') === 'maybe' ? text : '';
}

/**
 * Replaces everything in `target` with the children of `holder`, in one step.
 * Nothing may be awaited between the emptying and the filling, or a second
 * draw running at the same time appends its rows into a list the first has
 * already refilled.
 */
function swapIn(target, holder) {
  target.empty();
  while (holder.firstChild) target.appendChild(holder.firstChild);
}

/**
 * How much a link's visible text looks like a marker.
 *
 *   'exact' — it is the marker character this device is set to
 *   'maybe' — small enough to be a marker rather than prose, so it is one if
 *             it points into the linknote folder
 *   'no'    — prose
 *
 * The second case is what lets a linknote made on another device be seen as
 * one here. The marker is a setting, and two devices need not agree on it,
 * but a link into the linknote folder means the same thing everywhere.
 */
function markerMatch(text, marker) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return 'no';
  const m = String(marker == null ? '' : marker).trim();
  if (m && t === m) return 'exact';
  if (/\s/.test(t)) return 'no';
  return Array.from(t).length <= 4 ? 'maybe' : 'no';
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
    bodyHeading: settings.bodyHeading || DEFAULT_SETTINGS.bodyHeading,
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

// A block ID is either appended to the line it names, or written on the line
// below it — Obsidian's own form for a table or a code block. Both have to be
// recognised, or an existing ID is treated as ordinary text and destroyed.
const BLOCK_ID_RE = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const BLOCK_ID_LINE_RE = /^[ \t]*\^([A-Za-z0-9-]+)[ \t]*$/;

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

  // A block ID sitting alone on the last line names the block above it. The
  // marker belongs on the text, and the ID has to stay where it is: moving it
  // or adding a second one breaks every [[Note#^id]] pointing here.
  let ownLineId = '';
  let idLine = -1;
  if (last > 0) {
    const alone = lines[last].match(BLOCK_ID_LINE_RE);
    if (alone) {
      ownLineId = alone[1];
      idLine = last;
      last--;
      while (last > 0 && lines[last].trim() === '') last--;
    }
  }

  const lastLine = lines[last];
  const firstLine = (lines.find((l) => l.trim() !== '') || '').trim();

  const isHeading = /^#{1,6}\s/.test(firstLine);
  const isCodeFence = /^(```|~~~)/.test(firstLine);
  const isMathBlock = /^\$\$/.test(firstLine);
  const isTable = /^\s*\|/.test(lastLine);
  const needsOwnLine = isHeading || isCodeFence || isMathBlock || isTable;

  if (needsOwnLine) {
    if (ownLineId) {
      if (!link) return blockSrc;
      // The ID has to stay last on its line, so the marker goes in front of it.
      lines[idLine] = link + ' ^' + ownLineId;
      return lines.join('\n');
    }
    const tail = [link, blockId ? '^' + blockId : ''].filter(Boolean).join(' ');
    if (!tail) return blockSrc;
    return blockSrc.replace(/\s*$/, '') + '\n\n' + tail;
  }

  // A block ID already here must survive: other notes may reference it.
  if (ownLineId) {
    if (!link) return blockSrc;
    lines[last] = lines[last].replace(/\s+$/, '') + ' ' + link;
    return lines.join('\n');
  }
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
  // Line by line rather than on '\n\n': a separator line holding a space, or a
  // file saved with CRLF, is still a blank line, and treating it as text ran
  // two paragraphs together — which anchored the marker to the wrong one.
  const lines = content.split('\n');
  const isBlank = (s) => s.replace(/\r/g, '').trim() === '';

  const starts = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }

  let from = 0;
  while (from < lines.length - 1 && starts[from + 1] <= at) from++;
  let to = from;
  while (to < lines.length - 1 && starts[to + 1] < at + len) to++;

  while (from > 0 && !isBlank(lines[from - 1])) from--;
  while (to < lines.length - 1 && !isBlank(lines[to + 1])) to++;

  const end = starts[to] + lines[to].length;
  return content.slice(starts[from], end).replace(/\s+$/, '');
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
  // Either form: appended to the line, or alone on the line below it.
  const alone = lines[last].match(BLOCK_ID_LINE_RE);
  if (alone) return alone[1];
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
    this.resettleTimer = null;
    this.composerOpen = false;
    this.buttonMutedUntil = 0;
    this.relayoutPending = false;
    this.stackObservers = null;
    this.seenState = null;
    this.pendingChanges = null;
    this.noticeTimer = null;
    this.stateSaveTimer = null;
    this.listRefreshTimer = null;
    this.refitTimer = null;
    this.viewObservers = null;
    this.recentWrites = new Map();
    this.quietUntil = Date.now() + STARTUP_QUIET_MS;
    this.chat = { on: false, webhook: '' };
    this.loadChatConfig();

    this.registerMarkdownPostProcessor((el, ctx) => {
      // Guarded as a whole: anything thrown here would stop Obsidian drawing
      // the rest of the section.
      try {
        this.ctxMap.set(el, ctx);
        this.decorateMarkers(el);
        this.renderCards(el, ctx);
      } catch (e) {
        console.error('[Linknote] rendering', e);
      }
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
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        this.refreshCardsFor(file);
        // Ticking a task in the text rewrites the note, and Obsidian redraws
        // that one list item — taking the card hanging off it with it. Nothing
        // else asks for it back, so a note being edited is settled again.
        this.resettleSource(file);
      })
    );
    // These events fire before the view has drawn. Running once at that moment
    // decided "no cards here" and dropped the gutter, and since Obsidian then
    // restored the cards from its own cache without the post processor running,
    // nothing put the gutter back. So the work is repeated as things settle.
    // Order matters: the placement of each stack is decided first, and the
    // gutter is settled from the result. The other way round read the state
    // left by the previous pass, dropped the gutter, and put it straight back.
    const settleSoon = () => this.settleCards();
    this.registerEvent(this.app.workspace.on('file-open', settleSoon));
    this.registerEvent(this.app.workspace.on('layout-change', settleSoon));
    this.registerEvent(this.app.workspace.on('active-leaf-change', settleSoon));
    this.app.workspace.onLayoutReady(settleSoon);
    this.registerDomEvent(window, 'resize', () => this.refitCards());

    /*
     * Noticing other people's linknotes. Sync writes through the Vault API,
     * so a linknote arriving from another device raises the same create and
     * modify events as a local edit — that is the whole live detection. The
     * events are subscribed once the layout is ready, because on start-up
     * Obsidian raises create for every file it indexes, which is history,
     * not news. What happened while the vault was closed is found by the
     * reconcile pass, which compares mtimes against what this device last
     * saw. Missed events therefore cost nothing that the next start-up does
     * not recover: the reconcile is the main road, the events the shortcut.
     */
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on('create', (file) => this.linknoteChanged(file)));
      this.registerEvent(this.app.vault.on('modify', (file) => this.linknoteChanged(file)));
      this.registerEvent(
        this.app.vault.on('rename', (file, oldPath) => this.linknoteRenamed(file, oldPath))
      );
      this.registerEvent(this.app.vault.on('delete', (file) => this.linknoteGone(file)));
      this.reconcileLinknotes();
    });
    // A linknote opened as a note has been read.
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file && this.isLinknote(file)) this.markLinknoteRead(file);
      })
    );

    this.registerView(LIST_VIEW_TYPE, (leaf) => new LinknoteListView(leaf, this));
    // The ribbon is where an unread count belongs: a notice is gone in
    // seconds and only reaches whoever was looking, whereas this stays until
    // the linknotes behind it have been read. It opens the whole-vault list,
    // which is what a count is a count of.
    this.ribbonEl = this.addRibbonIcon('message-square', 'Linknotes', () =>
      this.openList(this.unreadCount() ? 'vault' : undefined)
    );

    // And along the bottom, where nothing overlaps it and it is on screen
    // whatever pane is in front. Not on mobile: there is no status bar there.
    if (!Platform.isMobile) {
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass('mod-clickable', 'lkn-status');
      this.statusEl.addEventListener('click', () => this.openList('vault'));
    }

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
      // The live selection only. Falling back to the last one looks helpful
      // and is not: with nothing selected — or with an image selected, which
      // is no text at all — it would quietly annotate whatever was read
      // before, and the linknote would land on the wrong passage.
      callback: () => this.openComposer(this.captureSelectionAnywhere()),
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
        if (this.hitWindow === win) this.clearPassage();
        try {
          const observer = doc && this.stackObservers && this.stackObservers.get(doc);
          if (observer) observer.disconnect();
        } catch (e) {
          /* it had none */
        }
      })
    );
    this.registerEvent(this.app.workspace.on('layout-change', () => this.hookAllOpenDocuments()));
  }

  onunload() {
    // Set first: every deferred pass checks it, so nothing carries on working
    // for a plugin that is no longer there.
    this.unloaded = true;
    if (this.resettleTimer) {
      window.clearTimeout(this.resettleTimer);
      this.resettleTimer = null;
    }
    if (this.noticeTimer) {
      window.clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
    // Written out now rather than on the timer, so a read mark from the last
    // moment is not lost with the plugin.
    if (this.seenState) this.saveSeenState();
    try {
      this.hideFloatingButton();
    } catch (e) {
      /* the button's window has gone */
    }
    try {
      this.removeAllTraces();
    } catch (e) {
      /* one document failing must not skip the others */
    }
  }

  /**
   * Puts every open document back as it was. The plugin draws into Obsidian's
   * own rendered DOM — classes on blocks, cards in a gutter, custom
   * properties on the body — and none of that belongs to a disabled plugin.
   * A marker that was moved into a heading is carried back to the block it
   * came from, so the note reads as it would with the plugin never installed.
   */
  removeAllTraces() {
    this.clearPassage();
    try {
      if (this.ribbonEl) {
        this.ribbonEl.classList.remove('lkn-has-unread');
        this.ribbonEl.removeAttribute('data-lkn-unread');
      }
    } catch (e) {
      /* the button has gone with the ribbon */
    }
    const gone = [
      'lkn-cards',
      'lkn-anchored',
      'lkn-has-card',
      'lkn-marker',
      'lkn-marker-plain',
      'lkn-relocated',
    ];
    const props = [
      '--lkn-card-width',
      '--lkn-card-gutter',
      '--lkn-card-scale',
      '--lkn-card-color',
      '--lkn-card-lines',
    ];

    for (const doc of this.openDocuments()) {
      try {
        for (const a of Array.prototype.slice.call(doc.querySelectorAll('a.lkn-marker'))) {
          const home = a._lknHome;
          a._lknHome = null;
          if (home && home.appendChild && home.isConnected) home.appendChild(a);
          // The marks this plugin left on Obsidian's own anchors. Without
          // this, enabling the plugin again on an already-rendered note finds
          // them still set and draws nothing.
          a._lknCard = null;
          a._lknDupe = false;
          if (a.dataset) delete a.dataset.lknSheet;
        }
        for (const stack of Array.prototype.slice.call(doc.querySelectorAll('.lkn-card-stack'))) {
          for (const card of Array.prototype.slice.call(stack.querySelectorAll('.lkn-card'))) {
            this.dropCardChild(card);
          }
          this.unobserveStack(stack);
          stack.remove();
        }
        for (const cls of gone) {
          for (const el of Array.prototype.slice.call(doc.querySelectorAll('.' + cls))) {
            el.classList.remove(cls);
          }
        }
        for (const el of Array.prototype.slice.call(doc.querySelectorAll('[style*="--lkn-shift"]'))) {
          el.style.removeProperty('--lkn-shift');
        }
        if (doc.body) {
          doc.body.classList.remove('lkn-cards-collapsed');
          doc.body.classList.remove('lkn-plain-marker');
          doc.body.classList.remove('lkn-rule-anchored');
          for (const prop of props) doc.body.style.removeProperty(prop);
        }
      } catch (e) {
        /* this document is already gone */
      }
    }
  }

  /* ------------------------------------------------------------- settings */

  async loadSettings() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, sanitizeSettings(raw));
    // 0.22.0 kept the webhook here for a day. sanitizeSettings drops unknown
    // keys, so it would simply vanish; it is carried over to where it belongs
    // instead, and the next save takes it out of the file.
    this.strayChat = raw && typeof raw === 'object' && raw.chatWebhook ? raw : null;
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

    let links;
    try {
      links = Array.prototype.slice.call(el.querySelectorAll('a'));
    } catch (e) {
      return;
    }

    const ctx = this.ctxMap.get(el);
    const ctxPath = (ctx && ctx.sourcePath) || '';

    // The marker text actually found, and how many were found. A block that
    // holds one marker and nothing else belongs to the heading above it, and
    // the marker there need not be this device's character.
    let onlyText = '';
    let count = 0;
    const found = [];

    for (const a of links) {
      const text = String(a.textContent || '').trim();
      const how = markerMatch(text, marker);
      if (how === 'no') continue;
      if (how === 'maybe' && !this.pointsAtLinknote(a, ctxPath)) continue;

      count++;
      onlyText = text;
      found.push({ el: a, text });
      a.classList.add('lkn-marker');
      if (s.markerStyle === 'plain') a.classList.add('lkn-marker-plain');

      // On mobile the marker opens a sheet rather than the note itself: the
      // point of a note in the margin is to be read without leaving the page.
      if (Platform.isMobile && !a.dataset.lknSheet) {
        a.dataset.lknSheet = '1';
        // registerDomEvent, not addEventListener: the anchor belongs to
        // Obsidian, and the handler has to go when the plugin does.
        this.registerDomEvent(a, 'click', (evt) => {
          const ctx = this.ctxMap.get(el);
          const sourcePath = (ctx && ctx.sourcePath) || '';
          if (!sourcePath) return;
          evt.preventDefault();
          evt.stopPropagation();
          this.openSheetFor(a, sourcePath);
        });
      }

      // A list item is a better unit to flag than the whole list. The class
      // goes on whether or not the rule is wanted: it says which blocks carry
      // a linknote, and the stylesheet decides whether to draw anything.
      const host = (a.closest && a.closest('li')) || el;
      if (host && host.classList) host.classList.add('lkn-anchored');
    }

    // A marker alone in its block belongs visually to the heading above it.
    // Scheduled per marker rather than per `el`, so it works both here — where
    // `el` is the block — and from a later sweep, where `el` is the whole view.
    for (const hit of found) {
      const block = markerBlockOf(hit.el, hit.text);
      if (block) this.scheduleHeadingAttach(block, hit.text);
    }
  }

  /**
   * Defers the move to the heading until the element is in the document.
   * A post processor is handed a detached tree, so nothing outside `el` —
   * the heading included — can be reached while it runs.
   */
  scheduleHeadingAttach(el, marker) {
    try {
      if (String(el.textContent || '').trim() !== marker) return;
      if (el.classList && el.classList.contains('lkn-relocated')) return;
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      if (!win) return;

      // Retried, because one frame is not always enough: a post processor is
      // handed a detached tree, and until it is in the document the heading
      // above it cannot be reached. A single attempt that landed too early
      // left the marker on its own line for good.
      const run = (attempt) => {
        if (this.unloaded || !el.parentElement) return;
        if (this.attachMarkerToHeading(el, marker)) return;
        if (attempt >= 4) return;
        const again = () => run(attempt + 1);
        if (attempt < 2 && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(again);
        else win.setTimeout(again, attempt < 3 ? 120 : 500);
      };

      if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => run(0));
      else win.setTimeout(() => run(0), 0);
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

      // Where it came from, so unloading the plugin can put it back.
      link._lknHome = el;
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
   * a full-width note, or mobile. Nothing is written to the note.
   */
  renderCards(el, ctx) {
    // Not on mobile. There is no margin to put a card in and inline cards
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
      // A marker inside a card belongs to the linknote being shown, not to
      // the note being read.
      if (a.closest && a.closest('.lkn-card')) continue;

      let file = null;
      try {
        file = this.app.metadataCache.getFirstLinkpathDest(linktext.split('#')[0], sourcePath);
      } catch (e) {
        file = null;
      }
      // A card is for a linknote. A marker-looking link to some other note —
      // someone may well use † as an alias — gets no card, and so no way to
      // delete a note this plugin does not own.
      if (!file || !this.isLinknote(file)) continue;

      // One card per marker. The marker element is the identity, so two
      // passes over the same rendered block cannot each add a card for it,
      // whichever host each decides to hang it on. parentElement rather than
      // isConnected: on the first pass the whole tree is still detached.
      if (a._lknDupe) continue;
      if (a._lknCard && a._lknCard.parentElement) continue;

      const host = hostBlockOf(a, el);
      if (!host || !host.classList || !host.createDiv) continue;
      let already = null;
      try {
        already = host.querySelector('.lkn-card[data-lkn-path="' + cssEscape(file.path) + '"]');
      } catch (e) {
        continue; // an unusable file name is not worth taking the render down
      }
      if (already) continue;

      host.classList.add('lkn-has-card');
      // One stack per block. Cards used to be positioned individually, which
      // put every card on a block at the same spot, one on top of the other.
      let stack = host.querySelector(':scope > .lkn-card-stack');
      if (!stack) stack = host.createDiv({ cls: 'lkn-card-stack' });

      const card = stack.createDiv({ cls: 'lkn-card' });
      a._lknCard = card;
      card.setAttribute('data-lkn-path', file.path);
      card.setAttribute('data-lkn-src', sourcePath);
      // The marker as written here, so a card says which device wrote it
      // without the note having to carry a property for it.
      card.setAttribute('data-lkn-mark', String(a.textContent || '').trim());
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
    let passage = '';
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
      passage = selectionShown(fm, content, this.settings.bodyHeading);
      text = sectionUnderHeading(content, this.settings.bodyHeading);
      if (!text && fm && typeof fm.body === 'string' && fm.body.trim()) text = fm.body;
      if (!text) text = stripFrontmatter(content);
    } catch (e) {
      /* an empty card is better than a broken one */
    }

    // Not isConnected: on the first draw the whole tree is still detached, and
    // bailing here is what left the card an empty box. Losing its host is the
    // real signal that the card is gone.
    if (this.unloaded || !card.parentElement) return;
    // Seeing a card go past is not the same as having taken it in, so by
    // default a card does not mark anything read. Reading is something you
    // say you have done: open the linknote, or press the tick on the card.
    if (readsOnShowing(this.settings)) this.markLinknoteRead(file);
    this.dropCardChild(card);
    card.empty();

    const head = card.createDiv({ cls: 'lkn-card-head' });
    const mark = card.getAttribute('data-lkn-mark') || '';
    if (mark) head.createEl('span', { cls: 'lkn-card-mark', text: mark });
    // Who and when, rather than the file name: linknotes on one block differ
    // only by a trailing number, which told the reader nothing.
    const label = [author, created].filter(Boolean).join(' · ') || file.basename;
    const title = head.createEl('a', { cls: 'lkn-card-title', text: label });
    title.setAttribute('aria-label', file.basename);
    title.setAttribute('title', file.basename);
    title.addEventListener('click', (evt) => {
      evt.preventDefault();
      this.app.workspace.openLinkText(file.path, sourcePath, evt.metaKey || evt.ctrlKey);
    });

    // Unread until it is said to be read. The card wears the accent while it
    // is, and carries the tick that says so; both go the moment it is read,
    // and the count on the ribbon comes down with them.
    const unread = this.isUnread(file);
    card.classList.toggle('lkn-card-unread', unread);
    if (unread) {
      const ack = head.createEl('button', { cls: 'lkn-card-ack', text: '✓' });
      ack.setAttribute('aria-label', 'Mark this linknote read');
      ack.setAttribute('title', 'Mark this linknote read');
      // The marks come off through clearUnreadMarks, which finds every card
      // for this linknote — this one included.
      ack.addEventListener('click', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.markLinknoteRead(file, true);
      });
    }

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

    // Which words this linknote is about. Several linknotes on one block
    // differ only in this, so without it a card cannot be told from its
    // neighbour. One line, with the whole passage on hover.
    if (passage) {
      const quote = card.createDiv({ cls: 'lkn-card-quote', text: passage });
      quote.setAttribute('title', passage + '\n(press to show it in the text)');
      // A button in all but name: reachable by keyboard, and announced as one.
      quote.setAttribute('role', 'button');
      quote.setAttribute('tabindex', '0');
      const point = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const block = card.closest && card.closest('.lkn-has-card');
        if (block && this.highlightNear(block, passage)) return;

        // The block this card hangs off is not always the one on screen.
        // Where another plugin re-renders a line — the Tasks plugin does —
        // the copy the card was built against is left behind, detached from
        // the page, and nothing can be found inside it. Rather than reason
        // about which copy is which, fall back to exactly what the sidebar
        // does: find the marker again in the note as it is now.
        const source = this.app.vault.getAbstractFileByPath(sourcePath);
        if (source instanceof TFile) {
          this.laterHighlight(source, passage, 0, file, () => {
            new Notice('Linknote: those words are no longer in this note.');
          });
          return;
        }
        new Notice('Linknote: those words are no longer in this note.');
      };
      quote.addEventListener('click', point);
      quote.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') point(evt);
      });
    }

    const body = card.createDiv({ cls: 'lkn-card-body' });
    if (!text) return;

    try {
      // The rendered markdown belongs to a child of its own, unloaded the
      // next time this card is painted. Handing it the plugin instead would
      // keep every embed, timer and code block alive until the plugin does.
      const child = new MarkdownRenderChild(body);
      this.addChild(child);
      card._lknChild = child;
      await MarkdownRenderer.render(this.app, text, body, file.path, child);
    } catch (e) {
      body.setText(text);
    }

    // The card just changed height, so everything below it has to move.
    this.scheduleRelayout();
  }

  /**
   * One card per linknote in a view, keeping the first.
   *
   * Another plugin may re-render a block into a second copy of the same list
   * item — the Tasks plugin does — and each copy carries its own marker, so
   * each was given its own card for the same linknote. Nothing in a single
   * pass can see that: the copies arrive separately and detached. So the
   * extras are cleared here, once everything is on screen.
   */
  dedupeCards(view) {
    let cards = [];
    try {
      cards = Array.prototype.slice.call(view.querySelectorAll('.lkn-card'));
    } catch (e) {
      return;
    }
    if (cards.length < 2) return;

    const seen = new Set();
    for (const card of cards) {
      const path = card.getAttribute('data-lkn-path') || '';
      if (!path) continue;
      if (!seen.has(path)) {
        seen.add(path);
        continue;
      }
      const stack = card.parentElement;
      // Remember which marker lost, or the next pass draws the card again and
      // this one deletes it again — a flicker on every settle.
      const host = stack && stack.parentElement;
      if (host && host.querySelectorAll) {
        for (const a of Array.prototype.slice.call(host.querySelectorAll('a.lkn-marker'))) {
          if (a._lknCard === card) {
            a._lknCard = null;
            a._lknDupe = true;
          }
        }
      }
      this.dropCardChild(card);
      this.unobserveStack(stack);
      card.remove();
      if (stack && stack.classList && stack.classList.contains('lkn-card-stack')) {
        if (!stack.querySelector('.lkn-card')) {
          const host = stack.parentElement;
          stack.remove();
          if (host && host.classList) host.classList.remove('lkn-has-card');
        }
      }
    }
  }

  /**
   * Paints the words a linknote is about inside the block it is anchored to.
   *
   * Nothing is written to the note, and nothing in the DOM is changed: the
   * range is handed to the browser's own highlight registry, which colours it
   * without wrapping it in anything. A passage that spans bold text or a link
   * therefore highlights correctly, and Obsidian's rendered tree is untouched.
   *
   * The anchor is still the block. This only says, inside that block, which
   * words were selected — and where the note has since been revised so that
   * those words are no longer there, nothing happens at all.
   */
  highlightPassage(block, passage) {
    const text = String(passage == null ? '' : passage).trim();
    if (!block || !text) return false;

    const doc = block.ownerDocument;
    const win = (doc && doc.defaultView) || null;
    if (!win || !win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') return false;

    try {
      // The block's own text, with the cards this plugin drew left out.
      const walker = doc.createTreeWalker(block, win.NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          // The cards this plugin drew, and the panes Obsidian hangs off the
          // bottom of a note. Backlinks quote the passage verbatim, so without
          // this the colour lands down there instead of in the text.
          if (parent && parent.closest && parent.closest(SKIP_IN_SEARCH)) {
            return win.NodeFilter.FILTER_REJECT;
          }
          return win.NodeFilter.FILTER_ACCEPT;
        },
      });

      const spans = [];
      let raw = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue || '';
        spans.push({ node, from: raw.length, to: raw.length + value.length });
        raw += value;
      }

      const run = runInText(raw, text);
      if (!run) return false;

      const at = (offset, isEnd) => {
        for (const span of spans) {
          const inside = isEnd
            ? offset > span.from && offset <= span.to
            : offset >= span.from && offset < span.to;
          if (inside) return { node: span.node, offset: offset - span.from };
        }
        return null;
      };
      const from = at(run.start, false);
      const to = at(run.end, true);
      if (!from || !to) return false;

      const range = doc.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);

      this.clearPassage();
      win.CSS.highlights.set(HIGHLIGHT_KEY, new win.Highlight(range));
      this.showRange(range, win);
      this.hitWindow = win;
      // A pointer rather than a state: it goes by itself, so the reader is not
      // left with a stray colour on the page.
      this.hitTimer = win.setTimeout(() => this.clearPassage(), 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Scrolls a highlighted passage into view when it is not already there.
   *
   * A colour painted on a part of the note that is off screen is a colour
   * nobody sees — and from the sidebar that is the ordinary case, since the
   * list shows linknotes from the whole note. A passage already on screen is
   * left where it is: scrolling something the reader is looking at is worse
   * than not scrolling at all.
   */
  showRange(range, win) {
    try {
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.height && !rect.width)) return;
      const top = 48;
      const bottom = (win.innerHeight || 0) - 48;
      if (rect.top >= top && rect.bottom <= bottom) return;

      let node = range.startContainer;
      if (node && node.nodeType === 3) node = node.parentElement;   // 3 = TEXT_NODE
      if (!node || typeof node.scrollIntoView !== 'function') return;
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) {
      /* the view is mid-render; the colour is still painted */
    }
  }

  /**
   * The passage, looked for around the block rather than only inside it.
   *
   * A marker that had to go on a line of its own — the line after a table, a
   * code block, a heading — is a rendered block containing nothing but the
   * marker, so the words are not in it. Rather than give up, the blocks just
   * above are tried, and then the pane as a whole. The anchor is unchanged:
   * this only widens where the colour is allowed to look.
   */
  highlightNear(block, passage) {
    if (!block) return false;
    if (this.highlightPassage(block, passage)) return true;

    let prev = null;
    try {
      prev = block.previousElementSibling;
    } catch (e) {
      prev = null;
    }
    for (let step = 0; step < HIGHLIGHT_LOOKBACK && prev; step += 1) {
      if (this.highlightPassage(prev, passage)) return true;
      try {
        prev = prev.previousElementSibling;
      } catch (e) {
        prev = null;
      }
    }

    let pane = null;
    try {
      pane = block.closest && block.closest('.markdown-preview-sizer, .markdown-preview-view, .markdown-rendered');
    } catch (e) {
      pane = null;
    }
    if (pane && pane !== block) return this.highlightPassage(pane, passage);
    return false;
  }

  /**
   * The same, after a jump from the sidebar.
   *
   * Two things have to happen before there is anything to paint, and neither
   * is on a schedule this can know: the note has to open, and Obsidian has to
   * draw the part of it the linknote is in. A long note is not all in the
   * page at once — a passage many screens away exists only as a placeholder
   * until the reader is taken there — so the jump is what makes the words
   * findable in the first place. Hence: try, wait, try again, for about three
   * seconds, and give up quietly rather than paint the wrong thing.
   *
   * The linknote's own block is preferred throughout. Only on the last rounds
   * is the whole note allowed, since that lights up the first paragraph that
   * happens to carry the same words, which may not be the one meant.
   */
  laterHighlight(file, passage, attempt, noteFile, onFail) {
    const round = attempt || 0;
    if (this.unloaded) return;
    if (round > 9) {
      // Said once, at the end. Saying it on the first attempt would call a
      // note that has simply not finished drawing a note that has changed.
      if (typeof onFail === 'function') onFail();
      return;
    }
    const timer = window.setTimeout(() => {
      if (this.unloaded) return;
      let done = false;
      try {
        this.app.workspace.iterateAllLeaves((leaf) => {
          if (done) return;
          const view = leaf && leaf.view;
          if (!view || !view.file || view.file.path !== file.path || !view.containerEl) return;
          const el = view.containerEl.querySelector('.markdown-preview-view');
          if (!el) return;
          const block = noteFile ? this.blockOfLinknote(el, noteFile) : null;
          if (block) {
            if (this.highlightNear(block, passage)) done = true;
          } else if (!noteFile || round >= 7) {
            if (this.highlightPassage(el, passage)) done = true;
          }
        });
      } catch (e) {
        /* nothing is drawn yet */
      }
      if (!done) this.laterHighlight(file, passage, round + 1, noteFile, onFail);
    }, round === 0 ? 120 : 300);
    this.register(() => window.clearTimeout(timer));
  }

  /** The rendered block carrying the marker for one linknote, or null. */
  blockOfLinknote(view, noteFile) {
    try {
      for (const a of Array.prototype.slice.call(view.querySelectorAll('a.lkn-marker'))) {
        // A marker shown in the backlinks pane below the note is not the one
        // in the text, and jumping the colour down there helps nobody.
        if (a.closest && a.closest(SKIP_IN_SEARCH)) continue;
        const raw = a.getAttribute('data-href') || a.getAttribute('href') || '';
        const target = String(raw).split('#')[0];
        if (!target) continue;
        const dest = this.app.metadataCache.getFirstLinkpathDest(target, '');
        if (!dest || dest.path !== noteFile.path) continue;
        return (a.closest && (a.closest('li') || a.closest('.el-p, .el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6, .el-div, .el-ul, .el-ol, .el-table, .el-pre, .el-blockquote'))) || null;
      }
    } catch (e) {
      /* fall back to the whole view */
    }
    return null;
  }

  /** Takes the highlight off again. */
  clearPassage() {
    const win = this.hitWindow;
    this.hitWindow = null;
    // All of it inside the guard: the window may have been a popout that has
    // since closed, and touching a closed window's timers throws.
    try {
      if (this.hitTimer && win) win.clearTimeout(this.hitTimer);
      if (win && win.CSS && win.CSS.highlights) win.CSS.highlights.delete(HIGHLIGHT_KEY);
    } catch (e) {
      /* the window has gone */
    }
    this.hitTimer = null;
  }

  /** Unloads the rendered markdown a card was holding, if it held any. */
  dropCardChild(card) {
    const child = card && card._lknChild;
    if (!child) return;
    card._lknChild = null;
    try {
      this.removeChild(child);
    } catch (e) {
      /* already gone */
    }
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

      out.push({
        file: note,
        line,
        blockId: idMatch ? idMatch[1] : '',
        passage,
        marker: markerOfLink(link),
      });
    }
    return out;
  }

  /** What a linknote says, for a list or a sheet: who, when, and the note. */
  async readLinknote(file) {
    const out = { author: '', created: '', text: '', selection: '' };
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
      // The same fallback order as a card, empty property included, so a row
      // and a card never show different things for the same linknote.
      if (!out.text && fm && typeof fm.body === 'string' && fm.body.trim()) out.text = fm.body;
      if (!out.text) out.text = stripFrontmatter(content);
      out.selection = selectionShown(fm, content, this.settings.bodyHeading);
    } catch (e) {
      /* what was gathered is enough */
    }
    return out;
  }

  /**
   * Draws the rows shared by the sidebar and the sheet. onRemoved, when
   * given, is called after a row's linknote has actually been removed — the
   * sheet uses it to close itself, since what it was showing is gone.
   *
   * The rows are built away from the screen and put in place in one go.
   * Three workspace events and the metadata cache can all ask for a redraw at
   * once, and a draw that emptied the list and then waited on a file read had
   * its rows appended after the next draw had already emptied and filled it.
   * That is how a new linknote came to be listed twice until the note was
   * reopened.
   */
  async renderLinknoteRows(target, sourceFile, entries, onRemoved, opts) {
    const doc = target.ownerDocument || document;
    const options = opts || {};
    const holder = doc.createElement('div');
    // The rendered markdown of the rows being replaced, let go of once the new
    // rows are in place.
    const previous = target._lknRowChildren || [];
    const children = [];
    const finish = () => {
      for (const child of previous) {
        try {
          this.removeChild(child);
        } catch (e) {
          /* already gone */
        }
      }
      target._lknRowChildren = children;
      swapIn(target, holder);
    };

    if (!entries.length) {
      holder.createDiv({
        cls: 'lkn-list-empty',
        text: options.emptyText || 'No linknotes in this note.',
      });
      finish();
      return;
    }

    for (const entry of entries) {
      const row = holder.createDiv({ cls: 'lkn-list-item' });
      // The vault-wide list has no single source note; each row carries the
      // one its linknote's own source property points at.
      const src = entry.source || sourceFile;

      // Who and when first, so every row is headed the same way. The passage
      // is not always there — a heading anchor may leave nothing to quote.
      const info = await this.readLinknote(entry.file);
      const meta = [info.author, info.created].filter(Boolean).join(' · ');
      const head = row.createDiv({ cls: 'lkn-list-head' });
      /*
       * One slot at the head of the row, before who and when. Unread, it
       * holds the dot; read, it holds the marker the linknote was written
       * with — so the row is headed the way a card is, and the character
       * says whose it is once the dot has gone. The two never both appear:
       * a dot beside a marker reads as two separate claims about one row,
       * and the dot is the one that matters while it is there.
       */
      const unread = typeof this.isUnread === 'function' && this.isUnread(entry.file);
      const slot = headSlot(unread, entry.marker);
      if (slot === 'dot') {
        const dot = head.createDiv({ cls: 'lkn-unread-dot' });
        dot.setAttribute('aria-label', 'Unread');
        dot.setAttribute('title', 'Unread');
      } else if (slot === 'marker') {
        head.createDiv({ cls: 'lkn-list-mark', text: entry.marker });
      }
      head.createDiv({ cls: 'lkn-list-meta', text: meta || entry.file.basename });

      // The same tick a card carries, so a row can be acknowledged without
      // opening it. Only while it is unread: a button that does nothing is
      // worse than no button.
      if (unread && typeof this.markLinknoteRead === 'function') {
        const ack = head.createEl('button', { cls: 'lkn-list-ack', text: '✓' });
        ack.setAttribute('aria-label', 'Mark this linknote read');
        ack.setAttribute('title', 'Mark this linknote read');
        ack.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.markLinknoteRead(entry.file, true);
          // The sidebar redraws itself a moment later, but the sheet on
          // mobile does not, so the row is put right where it stands: the
          // dot gives its place to the marker, and the tick goes.
          try {
            const dot = head.querySelector('.lkn-unread-dot');
            if (dot) {
              if (entry.marker) {
                const mark = head.createDiv({ cls: 'lkn-list-mark', text: entry.marker });
                dot.replaceWith(mark);
              } else {
                dot.remove();
              }
            }
            ack.remove();
          } catch (e) {
            /* the next redraw settles it */
          }
        });
      }

      if (src) {
        const drop = head.createEl('button', { cls: 'lkn-list-remove', text: '×' });
        drop.setAttribute('aria-label', 'Remove this linknote');
        drop.setAttribute('title', 'Remove this linknote');
        drop.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.confirmRemoval(src, entry.file, onRemoved);
        });
      }

      // The words selected, rather than the whole block: that is what tells
      // two linknotes on one block apart. The block is the fallback, for a
      // linknote that records no passage.
      const shown = info.selection || entry.passage;
      if (shown && src) {
        const passage = row.createDiv({ cls: 'lkn-list-passage', text: shown });
        passage.setAttribute('aria-label', 'Go to the passage');
        passage.setAttribute('role', 'button');
        passage.setAttribute('tabindex', '0');
        const goToPassage = (evt) => {
          evt.stopPropagation();
          const sub = entry.blockId ? '#^' + entry.blockId : '';
          this.app.workspace.openLinkText(src.path + sub, src.path, false);
          // After the jump, and only if the passage was recorded: the view
          // needs a moment to draw before there is anything to paint.
          if (info.selection) this.laterHighlight(src, info.selection, 0, entry.file);
        };
        passage.addEventListener('click', goToPassage);
        passage.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter' || evt.key === ' ') goToPassage(evt);
        });
      } else if (shown) {
        // No source to jump to — the words are still worth showing.
        row.createDiv({ cls: 'lkn-list-passage lkn-list-passage-still', text: shown });
      }

      const body = row.createDiv({ cls: 'lkn-list-body' });
      const text = info.text || entry.file.basename;
      try {
        const child = new MarkdownRenderChild(body);
        this.addChild(child);
        children.push(child);
        await MarkdownRenderer.render(this.app, text, body, entry.file.path, child);
      } catch (e) {
        body.setText(text);
      }
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      const openNote = (evt) => {
        this.app.workspace.openLinkText(
          entry.file.path,
          src ? src.path : entry.file.path,
          !!(evt.metaKey || evt.ctrlKey)
        );
      };
      row.addEventListener('click', openNote);
      row.addEventListener('keydown', (evt) => {
        if (evt.key !== 'Enter' && evt.key !== ' ') return;
        evt.preventDefault();
        openNote(evt);
      });
    }

    finish();

    // A row shows the whole linknote, so showing it is reading it — but only
    // after the rows are in place: marking read redraws the sidebar, and a
    // redraw racing the render it belongs to is how rows once doubled.
    if (
      options.markRead &&
      readsOnShowing(this.settings) &&
      typeof this.markLinknoteRead === 'function'
    ) {
      for (const entry of entries) this.markLinknoteRead(entry.file);
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
        // frontmatterLinks as well as links and embeds: the shipped templates
        // put the reference in a `source` property, and a linknote written
        // from one of them holds the block ID nowhere else.
        const refs = []
          .concat((cache && cache.links) || [])
          .concat((cache && cache.embeds) || [])
          .concat((cache && cache.frontmatterLinks) || []);
        for (const ref of refs) {
          const raw = String((ref && ref.link) || '');
          if (raw.indexOf(wanted) === -1) continue;
          const target = raw.split('#')[0];
          // A subpath with no note in front points inside the same file.
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
      // The comparison happens inside process(), on the data it hands over.
      // Reading first and writing afterwards leaves a gap in which an edit —
      // from another pane, or from sync — would be written over.
      await this.app.vault.process(plan.sourceFile, (data) => {
        if (data !== plan.before) return data;
        wrote = true;
        return plan.after;
      });
      if (!wrote) {
        new Notice('Linknote: the note changed while the confirmation was open. Nothing was removed.');
        return false;
      }
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
    // Last line of defence before a file is trashed: this plugin deletes
    // linknotes, and nothing else, whatever the caller thought it was doing.
    if (!this.isLinknote(noteFile) || !String(this.settings.folder || '').trim()) {
      new Notice('Linknote: that note is not in your linknote folder, so it was left alone.');
      return;
    }
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

  /**
   * True when a rendered link resolves to a note in the linknote folder.
   * Asked only about links short enough to be a marker, so it costs a cache
   * lookup on a handful of links per block rather than on all of them.
   */
  pointsAtLinknote(a, sourcePath) {
    try {
      // With no folder set every note is a linknote, which would make every
      // short link a marker. Then only the marker character decides.
      if (!String(this.settings.folder || '').replace(/\/+$/, '')) return false;
      const raw = a.getAttribute('data-href') || a.getAttribute('href') || '';
      const target = String(raw).split('#')[0];
      if (!target) return false;
      const file = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath || '');
      return !!file && this.isLinknote(file);
    } catch (e) {
      return false;
    }
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

      this.noteSelfWrite(file.path);
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
   * or on mobile, the card goes inline instead.
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

  /**
   * Watches the pane a card lives in, so that a change in its width re-decides
   * margin or inline.
   *
   * A window resize is not the only way a pane gets wider: collapsing a
   * sidebar, closing a split, changing the zoom or the readable line width all
   * do it, and none of them raise resize. Without this, a card that fell
   * inline while the pane was narrow stayed inline however much room it was
   * later given, because nothing asked the question again.
   *
   * The gutter is padding on this same element, so adding it does not change
   * the width being watched and cannot set the observer off against itself.
   */
  observeView(view) {
    try {
      const doc = view.ownerDocument;
      const win = (doc && doc.defaultView) || window;
      if (!win || typeof win.ResizeObserver !== 'function') return;

      if (!this.viewObservers) this.viewObservers = new WeakMap();
      let observer = this.viewObservers.get(doc);
      if (!observer) {
        observer = new win.ResizeObserver(() => this.refitSoon());
        this.viewObservers.set(doc, observer);
        this.register(() => observer.disconnect());
      }
      observer.observe(view);
    } catch (e) {
      /* the window resize and the timed passes remain */
    }
  }

  /**
   * One re-fit per burst. Dragging a pane divider resizes it every frame, and
   * measuring every card on every one of those frames is wasted work.
   */
  refitSoon() {
    if (this.unloaded || this.refitTimer) return;
    this.refitTimer = window.setTimeout(() => {
      this.refitTimer = null;
      if (this.unloaded) return;
      this.refitCards();
      this.syncCardLayout();
      this.scheduleRelayout();
    }, 120);
    this.register(() => window.clearTimeout(this.refitTimer));
  }

  /**
   * Lets go of a stack that is about to be thrown away. A ResizeObserver holds
   * its targets, so without this every discarded stack — and the rendered
   * markdown inside it — stays reachable for as long as the plugin runs.
   */
  unobserveStack(stack) {
    try {
      const doc = stack && stack.ownerDocument;
      const observer = doc && this.stackObservers && this.stackObservers.get(doc);
      if (observer) observer.unobserve(stack);
    } catch (e) {
      /* it was never observed */
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
        // Frames run out long before a re-rendering pane settles. Giving up
        // here is what left a card inline for good: the placement had been
        // decided narrow, and nothing asked again. Once only: a stack that
        // stays detached would otherwise ask for a pass every 400ms forever.
        else if (!card._lknLateRetry) {
          card._lknLateRetry = true;
          this.laterCardPass(400);
        }
        return;
      }
      const view =
        (host.closest && (host.closest('.markdown-preview-view') || host.closest('.markdown-rendered'))) || null;
      // Any change to the pane's width re-decides this, so widening it brings
      // the cards back out of the text without waiting for a window resize.
      if (view) this.observeView(view);

      let margin = !Platform.isMobile && this.settings.cardPlacement !== 'inline' && !!view;
      if (margin) {
        const width = view.getBoundingClientRect().width;
        // Straight after a reload the pane has no size yet. Reading that as
        // "no room" is what left the cards inline for good.
        if (!width) {
          if (attempt < 8) schedule(attempt + 1);
          else if (!card._lknLateRetry) {
            card._lknLateRetry = true;
            this.laterCardPass(400);
          }
          return;
        }
        margin = width >= cardMinPane(this.settings.cardWidth);
      }

      // Measured and decided, so the next stall gets its late pass too.
      card._lknLateRetry = false;

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
          // A card's own contents are rendered markdown too, and Obsidian
          // marks them as such. Sweeping into them would draw cards inside
          // cards; the note a card shows is not a note being read.
          if (el.closest && el.closest('.lkn-card')) continue;
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

  /**
   * Takes the cards off the screen, for when they are turned off. The gutter
   * alone was not enough: the cards themselves stayed where they were until
   * the note happened to be re-rendered.
   */
  clearCardLayout() {
    for (const doc of this.openDocuments()) {
      try {
        for (const stack of Array.prototype.slice.call(doc.querySelectorAll('.lkn-card-stack'))) {
          for (const card of Array.prototype.slice.call(stack.querySelectorAll('.lkn-card'))) {
            this.dropCardChild(card);
          }
          this.unobserveStack(stack);
          stack.remove();
        }
        for (const host of Array.prototype.slice.call(doc.querySelectorAll('.lkn-has-card'))) {
          host.classList.remove('lkn-has-card');
          if (host.style) host.style.removeProperty('--lkn-shift');
        }
        for (const a of Array.prototype.slice.call(doc.querySelectorAll('a.lkn-marker'))) {
          a._lknCard = null;
          a._lknDupe = false;
        }
      } catch (e) {
        /* this document is already gone */
      }
    }
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
      // Carried on the body rather than on each marker, so switching either
      // setting shows immediately instead of waiting for a re-render.
      body.classList.toggle('lkn-plain-marker', s.markerStyle === 'plain');
      body.classList.toggle('lkn-rule-anchored', !!s.highlightAnchored);
      body.classList.toggle('lkn-cards-collapsed', !!s.cardsCollapsed);
    }
  }

  /** Reveals the list in the right sidebar, opening it if it is not there. */
  async openList(scope) {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(LIST_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: LIST_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    // Asked for with a scope — a notice was clicked — the list switches to it.
    if (scope && leaf.view && typeof leaf.view.setScope === 'function') {
      await leaf.view.setScope(scope);
    }
  }

  /** The sheet a marker opens: the linknotes attached to that one block. */
  async openSheetFor(link, sourcePath) {
    const found = sourcePath && this.app.vault.getAbstractFileByPath(sourcePath);
    const file = found instanceof TFile ? found : null;
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
  /**
   * Draws the cards of an open note again, shortly after it changed on disk.
   *
   * Only for a note actually on screen, and only once per burst: a long edit
   * fires modify over and over, and each pass measures every stack.
   */
  resettleSource(file) {
    if (!file || !file.path || !this.settings.showCards || Platform.isMobile) return;
    let open = false;
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf && leaf.view;
        if (view && view.file && view.file.path === file.path) open = true;
      });
    } catch (e) {
      return;
    }
    if (!open) return;
    if (this.resettleTimer) window.clearTimeout(this.resettleTimer);
    this.resettleTimer = window.setTimeout(() => {
      this.resettleTimer = null;
      if (this.unloaded) return;
      this.sweepCards();
      this.refitCards();
      this.syncCardLayout();
      this.scheduleRelayout();
      this.laterCardPass(300);
    }, 150);
  }

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
    this.dedupeCards(view);

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
    const docs = this.openDocuments();
    const win = (docs[0] && docs[0].defaultView) || window;
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
    else win.setTimeout(run, 16);
  }

  /**
   * Draws, places and sizes the cards for every open view, then again a few
   * times as the view finishes drawing. Called on the workspace events and by
   * the settings screen, so turning cards on shows them at once rather than
   * whenever the note next happens to be re-rendered.
   */
  settleCards() {
    this.applyCardStyle();
    this.sweepCards();
    this.refitCards();
    this.syncCardLayout();
    this.scheduleRelayout();
    this.laterCardPass(120);
    this.laterCardPass(500);
    this.laterCardPass(1200);
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

  /**
   * Takes back the selection a linknote was just made from, in the window it
   * was made in. Nothing in the note is touched — this is the reader's
   * highlight, not the text.
   */
  dropSelection(doc) {
    this.snapshot = null;
    try {
      const win = ((doc || document).defaultView) || window;
      const sel = win.getSelection && win.getSelection();
      if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges();
    } catch (e) {
      /* the window has gone */
    }
  }

  refreshFloatingButton(doc) {
    if (!this.settings.showFloatingButton) return;
    // While the composer is up, and for a moment after it closes: the events
    // that raise the button are queued behind the press that opened or
    // dismissed it, and arrive once it is too late to be meant.
    if (this.composerOpen || Date.now() < (this.buttonMutedUntil || 0)) {
      this.hideFloatingButton();
      return;
    }
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
      btn.show();
      return;
    }

    const top = Math.min(rect.bottom + 6, win.innerHeight - 48);
    const left = Math.min(Math.max(rect.left, 8), win.innerWidth - 120);
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
    btn.show();
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
      new Notice('Linknote: select some text in Reading view first.');
      return;
    }
    // The selection is still there while the composer is open, and the events
    // that raise the floating button fire after the press that opened it — so
    // without this the button comes straight back and sits over the box like
    // an afterimage until something clears the selection.
    this.composerOpen = true;
    this.hideFloatingButton();
    const modal = new LinknoteModal(this.app, this, snap, async (values) => {
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
    });
    const closed = modal.onClose.bind(modal);
    modal.onClose = () => {
      this.composerOpen = false;
      // The passage has been used, so the selection behind it has done its
      // work. Dropped here because pressing Save raises a mouseup, and the
      // check that mouseup schedules runs after the composer has gone: it
      // would find the selection still standing and put the button back.
      this.dropSelection(snap.doc);
      this.buttonMutedUntil = Date.now() + 500;
      this.hideFloatingButton();
      closed();
    };
    modal.open();
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

    const where = blockOccurrences(currentContent, blockSrc);
    if (!where.length) {
      throw new Error('the source note has changed; refresh the view and retry');
    }
    if (where.length > 1) {
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
      // Located again inside process(), on the data being written: the note
      // may have moved on since it was read, and a marker written from a
      // stale position is worse than no marker at all.
      let placed = false;
      await this.processFile(sourceFile, (data) => {
        const spots = blockOccurrences(data, blockSrc);
        if (spots.length !== 1) return data;
        placed = true;
        const { at, len } = spots[0];
        return spliceAnchored(data, at, len, blockSrc, anchored);
      });
      if (!placed) {
        throw new Error('the source note changed while the linknote was being saved; the marker was not written');
      }
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
      // The listener goes on both paths. Letting go only when the event
      // arrives leaked one subscription per timed-out creation.
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (ref && this.app.metadataCache.offref) this.app.metadataCache.offref(ref);
        } catch (e) {
          /* already gone */
        }
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs || 2000);
      ref = this.app.metadataCache.on('changed', (changed) => {
        if (changed && changed.path === file.path && cacheHasBlock()) finish();
      });
      // registerEvent as well, so unload takes it down if we never settle.
      this.registerEvent(ref);
      if (cacheHasBlock()) finish();
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
      // Safe to put in a property: the passage may run to several lines, or
      // hold a colon or a hash.
      selectionYaml: toYamlBlock(snap.text),
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
      // The marker this device is set to. Two devices need not agree on it,
      // so a note can record which one it was written on.
      marker: String(s.marker || '').trim(),
      // The heading cards and rows read the body from. Writing it through the
      // template rather than typing it means the two cannot drift apart.
      bodyHeading: String(s.bodyHeading || DEFAULT_SETTINGS.bodyHeading).trim(),
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

    this.noteSelfWrite(path);
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

  /**
   * Every write to an existing note goes through here. process() reads and
   * writes as one step, so nothing typed between a read and a write is lost.
   */
  async processFile(file, fn) {
    if (file && file.path) this.noteSelfWrite(file.path);
    return await this.app.vault.process(file, fn);
  }

  /* ------------------------------------------------------ update notices */

  /**
   * Remembers that this device is about to write a file, so the create and
   * modify events that write raises are recognised as its own echo and not
   * announced as someone else's news.
   */
  noteSelfWrite(path) {
    if (!path) return;
    const now = Date.now();
    // Made here rather than counted on: writes can come through before
    // onload's bookkeeping has run, as the integration harness does.
    if (!this.recentWrites) this.recentWrites = new Map();
    this.recentWrites.set(path, now);
    // The map only ever holds the last few minutes of writes.
    if (this.recentWrites.size > 64) {
      for (const [p, at] of this.recentWrites) {
        if (now - at > SELF_WRITE_MS) this.recentWrites.delete(p);
      }
    }
  }

  /** Is this file the one being looked at on this device right now? */
  isInFront(file) {
    try {
      const active = this.app.workspace.getActiveFile();
      return !!active && !!file && active.path === file.path;
    } catch (e) {
      return false;
    }
  }

  /* ----------------------------------------------- chat, per device only */

  chatKey() {
    return 'linknote/' + this.app.vault.getName() + '/chat';
  }

  /**
   * Where this device posts, and whether it posts at all.
   *
   * In localStorage rather than in the settings file, for the same reason the
   * read marks are: a vault shared between people is the case this feature is
   * for, and Obsidian can be told to sync plugin settings. If the address
   * lived in data.json, one person's channel would become everyone's, and
   * three people would post their news into it. It is also a secret — the
   * address is the whole of the authentication — and a secret does not belong
   * in a file inside the vault.
   *
   * The cost is that it does not travel: a second machine needs the address
   * typing again. For a per-person destination that is the right way round.
   */
  loadChatConfig() {
    let parsed = null;
    try {
      parsed = JSON.parse(window.localStorage.getItem(this.chatKey()) || 'null');
    } catch (e) {
      parsed = null;
    }
    this.chat = sanitizeChatConfig(parsed);

    // Anything the previous version left in the settings file is adopted here
    // and then cleared from there, so the address ends up in one place only.
    if (this.strayChat) {
      const rescued = safeWebhook(this.strayChat.chatWebhook);
      if (rescued && !this.chat.webhook) {
        this.chat = { on: !!this.strayChat.chatNotify, webhook: rescued };
        this.saveChatConfig();
      }
      this.strayChat = null;
      this.saveSettings();
    }
  }

  saveChatConfig() {
    try {
      window.localStorage.setItem(this.chatKey(), JSON.stringify(this.chat || { on: false, webhook: '' }));
    } catch (e) {
      new Notice('Linknote: the chat settings could not be saved on this device.');
    }
  }

  seenStateKey() {
    return 'linknote/' + this.app.vault.getName() + '/state';
  }

  /**
   * What this device has seen, from localStorage. Not data.json: read marks
   * are one device's business — carried by sync they would mark linknotes
   * read on devices that never showed them — and they change far too often
   * to sit in a file that sync watches. localStorage is per vault and per
   * device, which is exactly the scope a read mark has.
   */
  loadSeenState() {
    let parsed = null;
    try {
      parsed = JSON.parse(window.localStorage.getItem(this.seenStateKey()) || 'null');
    } catch (e) {
      parsed = null;
    }
    const state = sanitizeSeenState(parsed);
    this.seenState = state || { known: this.currentLinknoteTimes(), told: {} };
    if (!state) this.saveSeenState();
  }

  saveSeenState(delayed) {
    if (delayed) {
      if (this.stateSaveTimer) return;
      this.stateSaveTimer = window.setTimeout(() => {
        this.stateSaveTimer = null;
        this.saveSeenState();
      }, 1000);
      return;
    }
    if (this.stateSaveTimer) {
      window.clearTimeout(this.stateSaveTimer);
      this.stateSaveTimer = null;
    }
    if (!this.seenState) return;
    try {
      window.localStorage.setItem(this.seenStateKey(), JSON.stringify(this.seenState));
    } catch (e) {
      /* storage full or absent; unread marks are a convenience, not a record */
    }
  }

  /** Every linknote on disk right now, path → mtime. */
  currentLinknoteTimes() {
    const out = {};
    // With no folder set every note in the vault would count as a linknote,
    // and the whole vault would be announced. Detection sits this out, the
    // same way marker recognition does.
    if (!String(this.settings.folder || '').trim()) return out;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.isLinknote(file)) out[file.path] = (file.stat && file.stat.mtime) || 0;
    }
    return out;
  }

  /**
   * Catches up on everything that happened while the vault was closed, by
   * comparing what is on disk with what this device last saw. Run once the
   * layout is ready; like the archive pass of a watched folder, it assumes
   * events were missed and looks for itself.
   */
  reconcileLinknotes() {
    if (this.unloaded) return;
    if (!this.seenState) this.loadSeenState();
    const current = this.currentLinknoteTimes();
    const { added, edited } = diffKnown(this.seenState.known, current);
    for (const path of added.concat(edited)) this.queueChange(path);
    // What no longer exists is forgotten on both counts.
    for (const bucket of ['known', 'told']) {
      for (const path of Object.keys(this.seenState[bucket])) {
        if (!Object.prototype.hasOwnProperty.call(current, path)) {
          delete this.seenState[bucket][path];
        }
      }
    }
    this.saveSeenState(true);
    this.refreshListViews();
  }

  /** A linknote was created or modified — by sync, by someone, or by us. */
  linknoteChanged(file) {
    if (this.unloaded || !(file instanceof TFile) || file.extension !== 'md') return;
    if (!String(this.settings.folder || '').trim() || !this.isLinknote(file)) return;
    const wrote = this.recentWrites.get(file.path);
    // A linknote open in front of you on this device is one you are reading
    // or editing yourself. Typing into someone else's linknote goes through
    // Obsidian's own save, not this plugin's writes, so without this the
    // device announced your own edit back to you — under the other person's
    // name, since the name shown is the author of the note, not whoever last
    // touched it. A change arriving over sync for the note on screen is
    // missed this way, but it is the one change already in plain sight.
    if ((wrote && Date.now() - wrote < SELF_WRITE_MS) || this.isInFront(file)) {
      // This device's own write. It is already read here, whatever the
      // author says — the body property, for one, is written into other
      // people's linknotes.
      if (this.seenState) {
        this.seenState.known[file.path] = (file.stat && file.stat.mtime) || 0;
        this.saveSeenState(true);
      }
      return;
    }
    this.queueChange(file.path);
    this.refreshListViews();
  }

  /** A rename is the same note under a new path, not news. */
  linknoteRenamed(file, oldPath) {
    if (!this.seenState || !oldPath) return;
    for (const bucket of ['known', 'told']) {
      if (Object.prototype.hasOwnProperty.call(this.seenState[bucket], oldPath)) {
        if (file && file.path) this.seenState[bucket][file.path] = this.seenState[bucket][oldPath];
        delete this.seenState[bucket][oldPath];
      }
    }
    this.saveSeenState(true);
  }

  /** A deleted linknote is forgotten, not announced. */
  linknoteGone(file) {
    if (!this.seenState || !file || !file.path) return;
    delete this.seenState.known[file.path];
    delete this.seenState.told[file.path];
    this.saveSeenState(true);
    this.refreshListViews();
  }

  /**
   * Queues one changed path for the next notice. Whether it is new or an
   * edit is decided at flush time from what this device knew, not from which
   * event happened to arrive first.
   */
  queueChange(path) {
    if (!this.pendingChanges) this.pendingChanges = new Set();
    this.pendingChanges.add(path);
    if (this.noticeTimer) return;
    const delay = Math.max(NOTICE_GATHER_MS, this.quietUntil - Date.now());
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.flushNotices();
    }, delay);
  }

  /**
   * Turns the queued paths into one notice. Everything that does not deserve
   * announcing is dropped here: our own linknotes, anything already read at
   * this mtime, and anything a previous notice already covered — so a
   * restart does not tell the same news twice.
   */
  flushNotices() {
    if (this.unloaded || !this.pendingChanges || !this.seenState) return;
    const pending = this.pendingChanges;
    this.pendingChanges = null;

    const changes = [];
    const mine = [];
    for (const path of pending) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || !this.isLinknote(file)) continue;
      const mtime = (file.stat && file.stat.mtime) || 0;
      const known = this.seenState.known[path];
      if (known != null && mtime <= known) continue;

      let fm = null;
      try {
        fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || null;
      } catch (e) {
        fm = null;
      }
      const author = authorOf(fm);
      if (isOwnAuthor(author, this.settings.author)) continue;

      const told = this.seenState.told[path];
      if (told != null && mtime <= told) continue;
      this.seenState.told[path] = mtime;

      const change = { author, kind: known == null ? 'new' : 'edited' };
      changes.push(change);
      // A chat message is only for what lands on a note of your own. The
      // in-app notice covers everything; this one is the tap on the shoulder
      // that reaches you when Obsidian is not what you are looking at.
      if (this.isOnMyNote(file, author)) mine.push(change);
    }

    if (!changes.length) return;
    this.saveSeenState(true);
    if (this.settings.notifyOthers) this.showUpdateNotice(noticeText(changes));
    if (mine.length) this.postToChat(mine);
  }

  /**
   * Was this linknote written on a note of mine?
   *
   * Judged the same way everything else here is judged: by the author named
   * in the frontmatter. The source note is found through the linknote's own
   * `source` property, resolved by the metadata cache — a name in a wikilink
   * is not a path, and only Obsidian knows which note it means.
   */
  isOnMyNote(linknote, linknoteAuthor) {
    try {
      const { source } = this.sourceOfLinknote(linknote);
      if (!source) return false;
      const fm = (this.app.metadataCache.getFileCache(source) || {}).frontmatter || null;
      // The name your notes call you by, which is not always the name your
      // linknotes are signed with. Falls back to the Author when unset.
      const names = namesOf(this.settings.noteAuthor || this.settings.author);
      names.push.apply(names, namesOf(this.settings.author));
      return chatWorthy(authorOf(fm), linknoteAuthor, names);
    } catch (e) {
      return false;
    }
  }

  /**
   * Posts one line to a chat channel. Desktop only: a phone does not keep a
   * plugin running in the background, and the chat app is already on it.
   *
   * A failure is said out loud. A notification that quietly stops arriving is
   * worse than none, because it is trusted.
   */
  async postToChat(changes) {
    if (Platform.isMobile || !chatIsLive(this.chat)) return;
    const url = safeWebhook(this.chat.webhook);
    const content = chatText(changes);
    if (!url || !content) return;
    const failed = await this.sendChat(url, content);
    if (failed) new Notice('Linknote: the chat message was not sent — ' + failed);
  }

  /**
   * The request itself. Returns an empty string on success, or why it failed.
   *
   * WeCom answers 200 with an error code in the body, so the body is checked
   * as well as the status; otherwise a wrong key looks like a success.
   */
  async sendChat(url, content) {
    try {
      const res = await requestUrl({
        url,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return 'HTTP ' + res.status;
      let payload = null;
      try {
        payload = res.json;
      } catch (e) {
        payload = null;
      }
      if (payload && payload.errcode) {
        return 'error ' + payload.errcode + (payload.errmsg ? ' ' + payload.errmsg : '');
      }
      return '';
    } catch (e) {
      return (e && e.message) || 'the request did not go through';
    }
  }

  /** The notice is also the doorway: clicking it opens the vault-wide list. */
  showUpdateNotice(text) {
    try {
      const frag = document.createDocumentFragment();
      const line = document.createElement('div');
      line.className = 'lkn-notice';
      line.textContent = text;
      line.addEventListener('click', () => this.openList('vault'));
      const hint = document.createElement('div');
      hint.className = 'lkn-notice-hint';
      hint.textContent = 'Click to open the inbox';
      frag.appendChild(line);
      frag.appendChild(hint);
      new Notice(frag, NOTICE_SHOWN_MS);
    } catch (e) {
      new Notice(text, NOTICE_SHOWN_MS);
    }
  }

  /**
   * A linknote whose body has been on screen is read. Reading marks are by
   * mtime, so a linknote edited again after being read comes back as unread.
   */
  markLinknoteRead(file, now) {
    if (!this.seenState || !file || !file.path || !this.isLinknote(file)) return;
    const mtime = (file.stat && file.stat.mtime) || 0;
    const known = this.seenState.known[file.path];
    if (known != null && known >= mtime) return;
    this.seenState.known[file.path] = mtime;
    this.saveSeenState(true);
    // Every place this linknote is shown, not just the one that was pressed.
    // The tick on a card used to clear its own card and nothing else, and the
    // tick on a row cleared the row and nothing else — so acknowledging in
    // one place left the same linknote still marked unread in the other.
    this.clearUnreadMarks(file);
    // Pressing the tick is a deliberate act and has to be seen to work: the
    // count comes down in the same breath rather than on the next coalesced
    // pass, which would read as the button having missed.
    if (now) this.paintRibbonBadge();
    this.refreshListViews();
  }

  /**
   * Takes the unread marks off the cards for a linknote that has just been
   * read — the accent down the edge, and the tick that cleared it.
   *
   * Only this direction. A linknote that becomes unread again does so because
   * someone edited it, and that already redraws the card in full, header and
   * all. Here the card is left as it is apart from the two marks, so that
   * acknowledging one does not re-render the note inside it.
   */
  clearUnreadMarks(file) {
    // No file means every card on screen, which is what marking the whole
    // vault read needs. Asking for each linknote in turn would walk the DOM
    // once per note in the vault.
    const selector = file
      ? '.lkn-card[data-lkn-path="' + cssEscape(file.path) + '"]'
      : '.lkn-card.lkn-card-unread';
    for (const doc of this.openDocuments()) {
      let cards = [];
      try {
        cards = Array.prototype.slice.call(doc.querySelectorAll(selector));
      } catch (e) {
        continue;
      }
      for (const card of cards) {
        try {
          card.classList.remove('lkn-card-unread');
          const ack = card.querySelector('.lkn-card-ack');
          if (ack) ack.remove();
        } catch (e) {
          /* the next card still gets its turn */
        }
      }
    }
  }

  markAllLinknotesRead() {
    if (!this.seenState) return;
    this.seenState.known = this.currentLinknoteTimes();
    this.saveSeenState();
    // Every card on screen, for the same reason one tick clears every card
    // of its own linknote: what was acknowledged has to look acknowledged
    // wherever it is shown.
    this.clearUnreadMarks();
    this.paintRibbonBadge();
    this.refreshListViews();
  }

  /**
   * The same count along the bottom of the window. The status bar is not
   * covered by anything and does not depend on which pane is in front, so it
   * is where a count is still there to be found an hour later. Empty at zero:
   * a line saying nothing is waiting is a line earning nothing.
   */
  paintStatusBar(count) {
    const el = this.statusEl;
    if (!el) return;
    try {
      const n = Number(count) || 0;
      el.setText(n > 0 ? '● ' + badgeText(n) + ' unread linknote' + (n === 1 ? '' : 's') : '');
      el.toggleClass('lkn-status-unread', n > 0);
      el.setAttribute('aria-label', n > 0 ? 'Open the linknote inbox' : '');
    } catch (e) {
      /* the ribbon count remains */
    }
  }

  /** How many linknotes are waiting to be read on this device. */
  unreadCount() {
    if (!this.seenState || !String(this.settings.folder || '').trim()) return 0;
    let n = 0;
    try {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (this.isLinknote(file) && this.isUnread(file)) n += 1;
      }
    } catch (e) {
      return n;
    }
    return n;
  }

  /**
   * Puts the count on the ribbon icon, or takes it off at zero. Written as an
   * attribute the stylesheet draws from, so nothing is added to Obsidian's own
   * button beyond a class it can be styled by — and taken off again cleanly
   * when the plugin is disabled.
   */
  paintRibbonBadge() {
    const n = this.unreadCount();
    this.paintStatusBar(n);
    const el = this.ribbonEl;
    if (!el) return;
    try {
      const badge = badgeText(n);
      if (badge) {
        el.classList.add('lkn-has-unread');
        el.setAttribute('data-lkn-unread', badge);
        el.setAttribute('aria-label', n === 1 ? 'Linknotes — 1 unread' : 'Linknotes — ' + n + ' unread');
      } else {
        el.classList.remove('lkn-has-unread');
        el.removeAttribute('data-lkn-unread');
        el.setAttribute('aria-label', 'Linknotes');
      }
    } catch (e) {
      /* the list and the notices remain */
    }
  }

  /**
   * Unread means: changed since this device last showed it, and not this
   * device's own. Own linknotes are never unread — their author has nothing
   * to be told.
   */
  isUnread(file) {
    if (!this.seenState || !file || !file.stat) return false;
    const known = this.seenState.known[file.path];
    if (known != null && ((file.stat && file.stat.mtime) || 0) <= known) return false;
    let fm = null;
    try {
      fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || null;
    } catch (e) {
      fm = null;
    }
    return !isOwnAuthor(authorOf(fm), this.settings.author);
  }

  /**
   * Redraws every open sidebar list, once per burst.
   *
   * Not immediately: reading a linknote is announced from wherever it was
   * shown — including from painting a card — and a redraw started in the
   * middle of a card pass renders markdown, which sets the whole card
   * machinery going again while it is still measuring. Coalescing here keeps
   * one cause from turning into a storm.
   */
  refreshListViews() {
    if (this.unloaded || this.listRefreshTimer) return;
    this.listRefreshTimer = window.setTimeout(() => {
      this.listRefreshTimer = null;
      if (this.unloaded) return;
      // The badge answers the same question the rows do, so it is repainted
      // with them and cannot drift out of step.
      this.paintRibbonBadge();
      for (const leaf of this.app.workspace.getLeavesOfType(LIST_VIEW_TYPE)) {
        const view = leaf.view;
        if (view && typeof view.draw === 'function') view.draw();
      }
    }, 150);
    this.register(() => window.clearTimeout(this.listRefreshTimer));
  }

  /**
   * Every linknote in the vault, shaped like the entries linknotesOf builds,
   * each carrying the source note its own frontmatter points at. The shipped
   * templates write that link into the source property, which the metadata
   * cache lists under frontmatterLinks — no file is opened to find it.
   */
  allLinknoteEntries() {
    const out = [];
    if (!String(this.settings.folder || '').trim()) return out;
    // The markers of one source note are found in one pass over its links,
    // and a note usually carries several linknotes, so the answers are kept
    // for the length of this build.
    const markers = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isLinknote(file)) continue;
      const { source, blockId } = this.sourceOfLinknote(file);
      out.push({
        file,
        line: 0,
        blockId,
        passage: '',
        marker: this.markerFor(file, source, markers),
        source,
      });
    }
    return out;
  }

  /**
   * The character a linknote was written with, read from the marker left in
   * its source note — the same place a card and a this-note row read it, so
   * one linknote shows the same character wherever it appears.
   *
   * Not from a property: the shipped template does not record one, and this
   * has to work for every linknote already written. The link caches are in
   * memory, so no file is opened to answer it.
   */
  markerFor(file, source, cache) {
    if (!source) return '';
    try {
      let byPath = cache && cache.get(source.path);
      if (!byPath) {
        byPath = new Map();
        const links = (this.app.metadataCache.getFileCache(source) || {}).links || [];
        for (const link of links) {
          const marker = markerOfLink(link);
          if (!marker) continue;
          const target = String((link && link.link) || '').split('#')[0];
          if (!target) continue;
          const dest = this.app.metadataCache.getFirstLinkpathDest(target, source.path);
          // The first marker wins: a note may mention a linknote twice, and
          // the marker is the one that anchors it.
          if (dest && !byPath.has(dest.path)) byPath.set(dest.path, marker);
        }
        if (cache) cache.set(source.path, byPath);
      }
      return byPath.get(file.path) || '';
    } catch (e) {
      return '';
    }
  }

  /** The source note a linknote's own source property points at, if any. */
  sourceOfLinknote(file) {
    try {
      const cache = this.app.metadataCache.getFileCache(file) || {};
      for (const link of cache.frontmatterLinks || []) {
        if (String(link.key || '').split('.')[0] !== 'source') continue;
        const raw = String(link.link || '');
        const target = raw.split('#')[0];
        const dest = target
          ? this.app.metadataCache.getFirstLinkpathDest(target, file.path)
          : null;
        if (dest instanceof TFile) {
          const sub = raw.indexOf('#^') !== -1 ? raw.split('#^')[1] : '';
          return { source: dest, blockId: sub || '' };
        }
      }
    } catch (e) {
      /* a linknote without a source still lists; it just cannot jump */
    }
    return { source: null, blockId: '' };
  }
}

/* --------------------------------------------------------------------------
 * Composer modal
 * ------------------------------------------------------------------------ */

/**
 * The linknotes of whatever note is in front, listed in the order they appear
 * in it. The cards answer "what is written here"; this answers "what has been
 * written about this note, and where". On mobile it is the only answer, since
 * cards there have nowhere to go.
 */
/**
 * Does one row match what was typed in the sidebar's search box?
 *
 * Every word has to appear somewhere in the row — author, note, passage or
 * file name — so two words narrow rather than widen. Case is ignored; nothing
 * else is interpreted, since a search box that quietly treats what you typed
 * as a pattern is a search box that lies about what it found.
 */
function rowMatches(row, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  if (!row) return false;
  const hay = [row.author, row.text, row.selection, row.passage, row.name]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.indexOf(word) !== -1);
}

/**
 * The order the sidebar lists linknotes in.
 *
 * The order in the note is the default and the tie-breaker for every other
 * order, so rows never shuffle between two redraws that had nothing to
 * separate them.
 */
function sortRows(rows, mode) {
  const list = Array.prototype.slice.call(rows || []);
  const settle = (compare) =>
    list.sort((a, b) => compare(a, b) || (a.index || 0) - (b.index || 0));

  if (mode === 'created') return settle((a, b) => (b.created || 0) - (a.created || 0));
  // Unread is a filter rather than an order (see unreadOnly), and what is
  // left of the list is most useful newest first, like any other inbox.
  if (mode === 'modified' || mode === 'unread') {
    return settle((a, b) => (b.modified || 0) - (a.modified || 0));
  }
  if (mode === 'author') {
    return settle((a, b) => {
      const x = String(a.author || '');
      const y = String(b.author || '');
      // A linknote with no author goes last rather than first: an empty name
      // sorts before everything, which puts the least informative rows on top.
      if (!x !== !y) return x ? -1 : 1;
      return x.localeCompare(y, undefined, { sensitivity: 'base' });
    });
  }
  return settle(() => 0);
}

/**
 * Whether this choice hides everything already read.
 *
 * It sits among the orders because that is where someone looks to change
 * what the list shows, and one control is easier to find than two. What it
 * does is narrow the list, not reorder it.
 */
function unreadOnly(mode) {
  return mode === 'unread';
}

const LIST_SORTS = [
  ['position', 'In the note'],
  ['created', 'Newest first'],
  ['modified', 'Recently changed'],
  ['author', 'By author'],
  ['unread', 'Unread only'],
];

const LIST_SCOPES = [
  ['note', 'This note'],
  ['vault', 'Whole vault'],
];

/* --------------------------------------------------------------------------
 * Update notices — the pure parts
 * ------------------------------------------------------------------------ */

/** The author a linknote's frontmatter names, as one string. */
function authorOf(frontmatter) {
  const raw = frontmatter && frontmatter.author;
  if (raw == null) return '';
  const text = Array.isArray(raw) ? raw.filter(Boolean).join(', ') : String(raw);
  return text.trim();
}

/**
 * Whether a linknote is this device's own, judged by name. An empty name on
 * either side decides nothing: with no Author set there is no name to match,
 * and a linknote that names nobody cannot be claimed as anyone's.
 */
function isOwnAuthor(author, self) {
  const a = String(author == null ? '' : author).trim();
  const s = String(self == null ? '' : self).trim();
  return !!a && !!s && a === s;
}

/** A setting that may name several people, as a list of names. */
function namesOf(value) {
  return String(value == null ? '' : value)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Is a note with this author property one of mine?
 *
 * A different question from isOwnAuthor, and the two needed separating. Which
 * device wrote a linknote is told by the Author setting, and two devices of
 * one person are deliberately given different names there so that what came
 * from the phone can be told from what came from the desk. Whose *note* it is
 * has nothing to do with devices: it is whatever name the vault's own notes
 * use for you, which may be none of those. Judging both by the one setting
 * meant a note by "Tsuneyama" was never recognised as belonging to "Tsune",
 * and the notification it should have raised never went out.
 *
 * Either side may list several people. A note you wrote with someone else is
 * still yours.
 */
function isOwnNote(noteAuthor, names) {
  const listed = namesOf(noteAuthor);
  if (!listed.length || !names.length) return false;
  return names.some((mine) => listed.indexOf(mine) !== -1);
}

/**
 * Is this linknote worth telling a chat channel about?
 *
 * Two conditions, both read from author properties. The note has to be one of
 * mine — my name among the names it lists. And the linknote has to be
 * somebody else's, where "somebody else" means: **not one of that note's own
 * authors**, and not one of my names.
 *
 * The first version of this compared the linknote only against the Author of
 * this device, which is per device by design — so a linknote written on my
 * own phone, or under the name my notes are signed with, read as a stranger's
 * and was announced to me as news about my own writing. A note says who it
 * belongs to; anyone it names annotating it is an author annotating their own
 * note, whichever device they used.
 *
 * A linknote signed by nobody is treated as somebody else's. It is more
 * useful to be told about an unsigned annotation than to have it swallowed.
 */
function chatWorthy(noteAuthorText, linknoteAuthor, myNames) {
  const noteAuthors = namesOf(noteAuthorText);
  const mine = namesOf(myNames.join ? myNames.join(',') : myNames);
  if (!noteAuthors.length || !mine.length) return false;
  // Mine to be told about.
  if (!noteAuthors.some((name) => mine.indexOf(name) !== -1)) return false;
  // Somebody else's to have written.
  const who = String(linknoteAuthor == null ? '' : linknoteAuthor).trim();
  if (!who) return true;
  if (noteAuthors.indexOf(who) !== -1) return false;
  if (mine.indexOf(who) !== -1) return false;
  return true;
}

/**
 * What changed between what this device knew and what is on disk now. Both
 * sides map path → mtime. A path not yet known is new; a later mtime is an
 * edit. What disappeared is nobody's news and is simply left out.
 */
function diffKnown(known, current) {
  const added = [];
  const edited = [];
  for (const path of Object.keys(current || {})) {
    if (!Object.prototype.hasOwnProperty.call(known || {}, path)) added.push(path);
    else if (current[path] > known[path]) edited.push(path);
  }
  return { added, edited };
}

/**
 * One sentence for however many changes one notice covers, grouped by author
 * in the order the authors were first seen:
 * "3 linknotes updated (Yamada: 2 new · Sato: 1 edited)".
 */
function noticeText(changes) {
  const list = (changes || []).filter(Boolean);
  if (!list.length) return '';

  const authors = new Map();
  for (const change of list) {
    const name = String(change.author || '').trim() || '(no author)';
    if (!authors.has(name)) authors.set(name, { fresh: 0, edited: 0 });
    const tally = authors.get(name);
    if (change.kind === 'edited') tally.edited += 1;
    else tally.fresh += 1;
  }

  const parts = [];
  for (const [name, tally] of authors) {
    const bits = [];
    if (tally.fresh) bits.push(tally.fresh + ' new');
    if (tally.edited) bits.push(tally.edited + ' edited');
    parts.push(name + ': ' + bits.join(', '));
  }

  const n = list.length;
  const head = n === 1 ? '1 linknote updated' : n + ' linknotes updated';
  return head + ' (' + parts.join(' · ') + ')';
}

/**
 * What goes at the head of a row: the unread dot, or the marker the linknote
 * was written with, or nothing.
 *
 * One slot, never both. Unread, the dot is the thing to say; once it has gone
 * the character takes its place and says whose linknote this is, the way a
 * card is headed. A dot beside a marker read as two separate claims about one
 * row, and the marker is not the news.
 */
function headSlot(unread, marker) {
  if (unread) return 'dot';
  return String(marker || '').trim() ? 'marker' : 'none';
}

/**
 * Whether drawing a linknote on screen is enough to call it read.
 *
 * Only when it has been asked for by name. Anything else — unset, a value
 * from an older or hand-edited data.json, nonsense — means the deliberate
 * reading, because a count that clears itself by scrolling counts nothing.
 */
function readsOnShowing(settings) {
  return !!settings && settings.readOn === 'shown';
}

/**
 * The line posted to a chat channel: how many, and from whom. Nothing else.
 *
 * Deliberately no note name and no text. What is annotated is often the part
 * of a vault that should least leave it — a negotiating position, a personnel
 * note — and a title alone can carry that. This says enough to make someone
 * open Obsidian, which is where the content stays.
 */
function chatText(changes) {
  const list = (changes || []).filter(Boolean);
  if (!list.length) return '';

  const authors = new Map();
  for (const change of list) {
    const name = String(change.author || '').trim() || '(no author)';
    authors.set(name, (authors.get(name) || 0) + 1);
  }
  const who = Array.from(authors, ([name, count]) => name + ': ' + count).join(' · ');

  const n = list.length;
  return (
    'Linknote — ' +
    n +
    (n === 1 ? ' linknote' : ' linknotes') +
    ' on your notes (' +
    who +
    ')'
  );
}

/** The unread count as it is drawn on the ribbon; nothing at all when zero. */
function badgeText(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

/**
 * The chat settings as they came out of localStorage, checked before use.
 *
 * Kept apart from the read state on purpose: a webhook that fails to parse
 * must not cost anyone their read marks, and the two have nothing to do with
 * each other beyond both being this device's business alone.
 */
function sanitizeChatConfig(data) {
  const out = { on: false, webhook: '' };
  if (!data || typeof data !== 'object') return out;
  out.webhook = safeWebhook(data.webhook);
  // Whether you asked for it, kept apart from whether it can happen yet.
  // Folding the two together meant that switching it on before pasting the
  // address recorded "off", and pasting the address afterwards did not put it
  // back — leaving a switch that looked on and a feature that was not.
  out.on = !!data.on;
  return out;
}

/** Both halves: you asked for it, and there is somewhere to send it. */
function chatIsLive(chat) {
  return !!chat && !!chat.on && !!safeWebhook(chat.webhook);
}

/**
 * The read state as it came out of localStorage, checked before use — the
 * same wariness data.json gets, and for the same reason: nothing outside the
 * plugin's control is trusted to be the right shape. Returns null for
 * anything unusable, and null means "start over with everything read":
 * announcing months of history as news would be worse than missing a beat.
 */
function sanitizeSeenState(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.known || typeof data.known !== 'object') return null;
  const out = { known: {}, told: {} };
  for (const bucket of ['known', 'told']) {
    const source = data[bucket];
    if (!source || typeof source !== 'object') continue;
    for (const path of Object.keys(source)) {
      // A number and nothing else: JSON writes marks as numbers, so anything
      // that is not one was never written by this plugin.
      const mtime = source[path];
      if (path && typeof mtime === 'number' && Number.isFinite(mtime) && mtime >= 0) {
        out[bucket][path] = mtime;
      }
    }
  }
  return out;
}

class LinknoteListView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return LIST_VIEW_TYPE;
  }

  getDisplayText() {
    return this.plugin.settings.listScope === 'vault' ? 'Linknote inbox' : 'Linknotes';
  }

  getIcon() {
    return 'message-square';
  }

  async onOpen() {
    const el = this.contentEl;
    el.addClass('lkn-list');
    el.empty();

    // The search box and the order are built once and left alone. Redrawing
    // them with the rows would take the caret out of the box on the first
    // keystroke, and the box would be unusable.
    this.query = '';
    // Two rows. Four controls on one line squeezed the search box down to a
    // couple of characters in a sidebar of ordinary width, which made it
    // useless exactly where it is needed most.
    const tools = el.createDiv({ cls: 'lkn-list-tools' });
    const topRow = tools.createDiv({ cls: 'lkn-list-toolrow' });
    const searchRow = tools.createDiv({ cls: 'lkn-list-toolrow' });

    // This note, or the whole vault. The vault-wide list is the inbox: what
    // everyone has written, wherever it is, with the unread rows dotted.
    const scope = topRow.createEl('select', { cls: 'dropdown lkn-list-scope' });
    scope.setAttribute('aria-label', 'Scope');
    for (const [value, label] of LIST_SCOPES) {
      const option = scope.createEl('option', { text: label });
      option.value = value;
    }
    scope.value = this.plugin.settings.listScope === 'vault' ? 'vault' : 'note';
    scope.addEventListener('change', async () => {
      this.plugin.settings.listScope = scope.value === 'vault' ? 'vault' : 'note';
      await this.plugin.saveSettings();
      this.draw();
    });
    this.scopeEl = scope;

    const search = searchRow.createEl('input', { cls: 'lkn-list-search', type: 'search' });
    search.placeholder = 'Search these linknotes';
    search.setAttribute('aria-label', 'Search these linknotes');
    search.addEventListener('input', () => {
      this.query = search.value;
      this.draw();
    });

    const sort = topRow.createEl('select', { cls: 'dropdown lkn-list-sort' });
    sort.setAttribute('aria-label', 'Order');
    for (const [value, label] of LIST_SORTS) {
      const option = sort.createEl('option', { text: label });
      option.value = value;
    }
    sort.value = this.plugin.settings.listSort || DEFAULT_SETTINGS.listSort;
    sort.addEventListener('change', async () => {
      this.plugin.settings.listSort = sort.value;
      await this.plugin.saveSettings();
      this.draw();
    });

    // Only the vault-wide list gets the button: read marks are per note
    // shown, and "all" meaning "all in this one note" would surprise.
    const markAll = searchRow.createEl('button', { cls: 'lkn-list-markall', text: 'Mark all read' });
    markAll.setAttribute('aria-label', 'Mark every linknote read');
    markAll.setAttribute('title', 'Mark every linknote read');
    markAll.addEventListener('click', () => this.plugin.markAllLinknotesRead());
    this.markAllEl = markAll;

    this.rowsEl = el.createDiv({ cls: 'lkn-list-rows' });

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.draw()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.draw()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.draw()));
    await this.draw();
  }

  /** Switches the list to a scope, the way a click on a notice asks for. */
  async setScope(scope) {
    const next = scope === 'vault' ? 'vault' : 'note';
    this.plugin.settings.listScope = next;
    await this.plugin.saveSettings();
    if (this.scopeEl) this.scopeEl.value = next;
    await this.draw();
  }

  async draw() {
    const el = this.rowsEl || this.contentEl;

    // Every redraw takes a ticket, and a draw that is no longer the latest
    // gives up rather than putting stale rows on screen.
    const ticket = (this.drawTicket || 0) + 1;
    this.drawTicket = ticket;

    const vaultWide = this.plugin.settings.listScope === 'vault';
    if (this.markAllEl) this.markAllEl.toggleClass('lkn-hidden', !vaultWide);
    // The view is named for what it is showing, so the whole-vault list is
    // recognisable as the place unread linknotes are waiting rather than
    // looking like the same list with different rows.
    try {
      this.leaf.updateHeader();
    } catch (e) {
      /* the tab keeps the name it had */
    }

    let file = null;
    let entries = [];
    if (vaultWide) {
      if (!String(this.plugin.settings.folder || '').trim()) {
        el.empty();
        el.createDiv({
          cls: 'lkn-list-empty',
          text: 'Set a Linknote folder to list the whole vault.',
        });
        return;
      }
      entries = this.plugin.allLinknoteEntries();
    } else {
      file = this.app.workspace.getActiveFile();
      if (!file) {
        el.empty();
        el.createDiv({ cls: 'lkn-list-empty', text: 'No note is open.' });
        return;
      }
      entries = await this.plugin.linknotesOf(file);
    }
    if (this.drawTicket !== ticket) return;

    // What the search and the order need: read once here, rather than again
    // inside every comparison.
    const rows = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const info = await this.plugin.readLinknote(entry.file);
      const stat = entry.file.stat || {};
      rows.push({
        entry,
        index: i,
        author: info.author,
        text: info.text,
        selection: info.selection,
        passage: entry.passage,
        name: entry.file.basename,
        created: stat.ctime || 0,
        modified: stat.mtime || 0,
        unread: this.plugin.isUnread(entry.file),
      });
    }
    if (this.drawTicket !== ticket) return;

    let order = this.plugin.settings.listSort || DEFAULT_SETTINGS.listSort;
    // "In the note" orders by position in one note; across the vault there is
    // no such thing, and recently changed is what an inbox wants anyway.
    if (vaultWide && order === 'position') order = 'modified';
    const onlyUnread = unreadOnly(order);

    let found = rows.filter((row) => rowMatches(row, this.query));
    if (onlyUnread) found = found.filter((row) => row.unread);

    // Told apart, because an empty list means different things: nothing
    // matched what was typed, or nothing is waiting to be read.
    if (!found.length && (onlyUnread || String(this.query || '').trim())) {
      el.empty();
      el.createDiv({
        cls: 'lkn-list-empty',
        text: onlyUnread
          ? 'Nothing unread here.'
          : 'Nothing here matches “' + String(this.query).trim() + '”.',
      });
      return;
    }

    const wanted = sortRows(found, order).map((row) => row.entry);
    await this.plugin.renderLinknoteRows(
      el,
      file,
      wanted,
      () => this.draw(),
      vaultWide
        ? { emptyText: 'No linknotes in this vault.' }
        : // Rows in this scope show each linknote whole, so listing them is
          // reading them. The vault-wide list only marks a row read when it
          // is opened — it is the inbox, and an inbox that reads its own
          // mail defeats the dot and the button both.
          { markRead: true }
    );
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
    this.setTitle('Remove this linknote?');

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

/** One block's linknotes, as a sheet. What a marker opens on mobile. */
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
    this.setTitle('Linknotes');
    const list = this.contentEl.createDiv({ cls: 'lkn-list' });
    this.plugin.renderLinknoteRows(list, this.sourceFile, this.entries, () => this.close(), {
      markRead: true,
    });
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

    this.setTitle('New linknote');

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
    suggest.hide();

    let matches = [];
    let active = 0;
    let range = null;

    const closeSuggest = () => {
      suggest.hide();
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
      if (matches.length) suggest.show();
      else suggest.hide();
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
    taskBtn.setAttribute('title', 'Turn this line into a task');
    taskBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      const next = toggleTaskLine(bodyInput.value, bodyInput.selectionStart);
      bodyInput.value = next.text;
      bodyInput.setSelectionRange(next.cursor, next.cursor);
      bodyInput.focus();
    });

    const tagBtn = tools.createEl('button', { cls: 'lkn-tool', text: 'Tag' });
    tagBtn.setAttribute('title', 'Insert a tag');
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

    const doc = bodyInput.ownerDocument || document;

    // Whether the tag list is actually on screen — not whether there are
    // matches behind it, which can outlive the list being drawn.
    this.suggestOpen = () => {
      try {
        if (!suggest || !suggest.isConnected || !matches.length) return false;
        const win = doc.defaultView || window;
        return win.getComputedStyle(suggest).display !== 'none';
      } catch (e) {
        return matches.length > 0;
      }
    };

    /*
     * Esc belongs to the tag list while the list is open, and to the composer
     * the rest of the time. Which handler sees the key first is not ours to
     * decide — Obsidian watches for it too, through the modal's own scope and
     * through a listener above this box — so rather than race, all three ways
     * in are covered and they agree:
     *
     *   1. the key on its way down, before anything else has had it;
     *   2. the modal's scope, which is how Obsidian itself asks;
     *   3. close() itself, for when the shutdown was already under way.
     *
     * Whichever arrives first puts the list away and leaves the composer, so
     * nothing that was typed is lost; the next Esc closes the composer.
     */
    const guard = (evt) => {
      if (evt.key !== 'Escape' || !this.suggestOpen()) return;
      evt.preventDefault();
      evt.stopPropagation();
      closeSuggest();
    };
    doc.addEventListener('keydown', guard, true);
    this.detachGuard = () => doc.removeEventListener('keydown', guard, true);

    try {
      this.scope.register([], 'Escape', () => {
        if (!this.suggestOpen()) return true;   // let Obsidian close the box
        closeSuggest();
        return false;
      });
    } catch (e) {
      /* an older scope: the other two ways still hold */
    }

    // The last line of defence. A close that came from an Esc press while the
    // list was open is not a close at all — it is the list being dismissed.
    // Anything else (Cancel, Save, clicking away) closes as it always did.
    if (!this.closeWrapped) {
      this.closeWrapped = true;
      const shut = this.close.bind(this);
      this.close = () => {
        let evt = null;
        try {
          evt = (doc.defaultView && doc.defaultView.event) || null;
        } catch (e) {
          evt = null;
        }
        const byEscape = !!evt && evt.type === 'keydown' && evt.key === 'Escape';
        if (byEscape && this.suggestOpen()) {
          closeSuggest();
          return;
        }
        shut();
      };
    }

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
    if (this.closed) return;
    this.closed = true;
    if (this.detachFit) {
      this.detachFit();
      this.detachFit = null;
    }
    if (this.detachGuard) {
      this.detachGuard();
      this.detachGuard = null;
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
  ['{{selectionYaml}}', 'the selected text, as a YAML block scalar, safe to put in a property'],
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
  ['{{marker}}', 'the marker character set below; useful when two devices use different ones'],
  ['{{bodyHeading}}', 'the body heading set below, so the template and the setting cannot drift apart'],
  ['{{summary}}', 'source note name and a short excerpt'],
];

/** Asks before something is replaced or thrown away. */
class LinknoteConfirmModal extends Modal {
  constructor(app, title, body, confirmText, onConfirm) {
    super(app);
    this.title = title;
    this.body = body;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('lkn-modal');
    this.setTitle(this.title);
    contentEl.empty();
    contentEl.createEl('p', { text: this.body });

    const buttons = contentEl.createDiv({ cls: 'lkn-buttons' });
    buttons.createDiv({ cls: 'lkn-hint' });
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const go = buttons.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
    go.addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class LinknoteSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * A slider's value, spelled out beside its description.
   *
   * setDynamicTooltip() shows the number only while it is dragged with a
   * pointer, so a keyboard user never learns what the value is.
   */
  showValue(setting, text) {
    const el = setting.descEl.createDiv({ cls: 'lkn-value', text: text });
    return (next) => el.setText(next);
  }

  /** Replaces the template, asking first when there is work to lose. */
  replaceTemplate(next, what) {
    const s = this.plugin.settings;
    const apply = async () => {
      s.noteTemplate = next;
      await this.plugin.saveSettings();
      this.redraw();
      new Notice('Note template replaced with: ' + what);
    };
    const known =
      TEMPLATE_PRESETS.some((preset) => preset.template === s.noteTemplate) ||
      LEGACY_NOTE_TEMPLATES.indexOf(s.noteTemplate) !== -1;
    if (known || s.noteTemplate === next) {
      apply();
      return;
    }
    new LinknoteConfirmModal(
      this.app,
      'Replace the note template?',
      'What is in the template box now is not one of the presets, so it looks like your own. ' +
        'Replacing it cannot be undone — copy anything you want to keep first.',
      'Replace',
      apply
    ).open();
  }

  /**
   * Draws the tab again, keeping the reader where they were.
   *
   * Some rows only exist while another is on, so switching one of those means
   * rebuilding the tab. Rebuilding empties the pane, which sends it back to
   * the top — halfway down a long settings screen that is a jolt, and it is
   * not obvious the toggle even worked. So the scroll position is put back.
   */
  redraw() {
    const el = this.containerEl;
    let top = 0;
    try {
      top = el.scrollTop || 0;
    } catch (e) {
      top = 0;
    }
    this.display();
    if (!top) return;
    const restore = () => {
      try {
        el.scrollTop = top;
      } catch (e) {
        /* the tab has closed */
      }
    };
    restore();
    // The rows arrive as the browser gets to them, so on the first try the
    // pane may not yet be tall enough to scroll that far.
    try {
      window.requestAnimationFrame(restore);
    } catch (e) {
      /* no frames here */
    }
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    /* ------------------------------------------------ new linknotes */

    new Setting(containerEl).setName('New linknotes').setHeading();

    new Setting(containerEl)
      .setName('Linknote folder')
      .setDesc(
        'Where new linknotes are created, and created if it is missing. Everyone sharing a vault ' +
          'should use the same folder. To see the linknotes of the note you are reading, open the ' +
          'sidebar list from the ribbon icon or the command "Show the linknotes in this note".'
      )
      .addText((t) => {
        t.setPlaceholder(DEFAULT_SETTINGS.folder)
          .setValue(s.folder)
          .onChange(async (v) => {
            // safeFolder refuses a path that climbs out of the vault, so a typo
            // like ../Documents cannot send new notes outside it. What is kept
            // is the safe reading; what is shown is left alone until the field
            // is done with, or clearing it to type a new name would snap back
            // to the old one on the first keystroke.
            s.folder = safeFolder(v) || DEFAULT_SETTINGS.folder;
            renderPreview();
            await this.plugin.saveSettings();
          });
        // Now the typing has stopped, show what was actually kept.
        t.inputEl.addEventListener('blur', () => {
          if (t.inputEl.value !== s.folder) t.inputEl.value = s.folder;
        });
      });

    new Setting(containerEl)
      .setName('Filename template')
      .setDesc(
        'The variables are listed under the note template below, and the .md extension is added ' +
          'for you. {{anchor}} is what keeps two linknotes on the same note apart. {{title}} is cut ' +
          'to ' + FILENAME_TITLE_MAX_CHARS + ' characters here only, and the finished name to ' +
          FILENAME_MAX_BYTES + ' bytes.'
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.filenameTemplate)
          .setValue(s.filenameTemplate)
          .onChange(async (v) => {
            s.filenameTemplate = v.trim() || DEFAULT_SETTINGS.filenameTemplate;
            renderPreview();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Date format')
      .setDesc('Tokens: YYYY, YY, MMMM, MMM, MM, DD, dddd, ddd, HH, mm, ss.')
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
          .setValue(s.dateFormat)
          .onChange(async (v) => {
            s.dateFormat = v.trim() || DEFAULT_SETTINGS.dateFormat;
            renderPreview();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Author')
      .setDesc(
        'Available in templates as {{author}}, and shown at the head of every card and sidebar row. ' +
          'Set it on each device where several people share a vault.'
      )
      .addText((t) =>
        t
          .setPlaceholder('(empty)')
          .setValue(s.author)
          .onChange(async (v) => {
            s.author = v.trim();
            renderPreview();
            await this.plugin.saveSettings();
          })
      );

    // Last in this group, so it reflects every field above it.
    const preview = containerEl.createDiv({ cls: 'lkn-preview' });
    const renderPreview = () => preview.setText('Example: ' + previewFilename(s));
    renderPreview();

    /* ------------------------------------------------- note template */

    new Setting(containerEl).setName('The note template').setHeading();

    new Setting(containerEl)
      .setName('Start from a preset')
      .setDesc('Five starting points. Loading one replaces the template below; rewrite it in whatever language you write in.')
      .addDropdown((d) => {
        TEMPLATE_PRESETS.forEach((preset, i) => d.addOption(String(i), preset.name));
        d.setValue(String(this.presetIndex || 0));
        d.onChange((v) => {
          this.presetIndex = Number(v);
        });
      })
      .addButton((b) =>
        b.setButtonText('Replace template').onClick(() => {
          const preset = TEMPLATE_PRESETS[this.presetIndex || 0];
          this.replaceTemplate(preset.template, preset.name);
        })
      );

    new Setting(containerEl)
      .setName('Note template')
      .setDesc('The whole linknote, frontmatter included. Blank runs left by empty variables are collapsed.')
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
          .onClick(() => this.replaceTemplate(DEFAULT_NOTE_TEMPLATE, TEMPLATE_PRESETS[0].name))
      );

    const help = containerEl.createEl('details', { cls: 'lkn-varhelp' });
    help.createEl('summary', { text: 'Template variables' });
    const list = help.createEl('ul');
    for (const [name, desc] of TEMPLATE_VARIABLES) {
      const li = list.createEl('li');
      li.createEl('code', { text: name });
      li.appendText(' — ' + desc);
    }

    new Setting(containerEl)
      .setName('Body heading')
      .setDesc(
        'The heading inside a linknote that marks your own note, as opposed to the quoted source. ' +
          'It has to match the heading your template writes — put {{bodyHeading}} in the template ' +
          'and it always will. Cards and sidebar rows read the section under it; where there is no ' +
          'such heading they fall back to the body property, and then to the whole note, which is ' +
          'why changing this alone can look as though nothing happened.'
      )
      .addText((t) =>
        t.setPlaceholder(DEFAULT_SETTINGS.bodyHeading).setValue(s.bodyHeading).onChange(async (v) => {
          s.bodyHeading = v.trim() || DEFAULT_SETTINGS.bodyHeading;
          await this.plugin.saveSettings();
          this.plugin.settleCards();
        })
      );

    new Setting(containerEl)
      .setName('Keep the body property in step with the note')
      .setDesc(
        'The note is the original and the property is a copy, rewritten from the section under the ' +
          'body heading so a query sees what the note now says. An edit made to the property itself ' +
          'is overwritten. Only linknotes that already carry a body property are touched.'
      )
      .addToggle((t) =>
        t.setValue(s.syncBodyProperty).onChange(async (v) => {
          s.syncBodyProperty = v;
          await this.plugin.saveSettings();
        })
      );

    /* ---------------------------------- the marker in the source note */

    new Setting(containerEl).setName('The marker in the source note').setHeading();

    new Setting(containerEl)
      .setName('Marker character')
      .setDesc(
        'Left at the anchored spot in the source note. One or two characters — † · ¶ — or an emoji. ' +
          'A longer one is not recognised on a device set to a different marker, and | or ] would ' +
          'break the link.'
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.marker)
          .setValue(s.marker)
          .onChange(async (v) => {
            s.marker = v || DEFAULT_SETTINGS.marker;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Add a link marker')
      .setDesc(
        'Leaves a small link at the anchored spot. It is what the cards, the sidebar list and Remove ' +
          'find a linknote by — with this off, new linknotes get a block ID only and appear in none of them.'
      )
      .addToggle((t) =>
        t.setValue(s.useInlineLink).onChange(async (v) => {
          s.useInlineLink = v;
          await this.plugin.saveSettings();
          if (!v && !s.useBlockId) {
            new Notice(
              'Linknote: with both the marker and the block ID off, nothing is written to the source note and a new linknote cannot be found again.'
            );
          }
        })
      );

    new Setting(containerEl)
      .setName('Add a block ID')
      .setDesc(
        'Writes a ^blockid into the source note at the anchored spot, so a linknote can point at the ' +
          'exact block and keep pointing at it as the note is revised. Headings are referenced by ' +
          'their own anchor and never get one. With this off, {{embed}} is empty.'
      )
      .addToggle((t) =>
        t.setValue(s.useBlockId).onChange(async (v) => {
          s.useBlockId = v;
          await this.plugin.saveSettings();
          if (!v && !s.useInlineLink) {
            new Notice(
              'Linknote: with both the marker and the block ID off, nothing is written to the source note and a new linknote cannot be found again.'
            );
          }
        })
      );

    new Setting(containerEl)
      .setName('Marker style')
      .setDesc('How the marker looks while reading. Rendering only — nothing is written to your notes.')
      .addDropdown((d) => {
        d.addOption('chip', 'Chip — small badge');
        d.addOption('plain', 'Plain — an ordinary link');
        d.setValue(s.markerStyle || DEFAULT_SETTINGS.markerStyle);
        d.onChange(async (v) => {
          s.markerStyle = v;
          await this.plugin.saveSettings();
          this.plugin.applyCardStyle();
        });
      });

    new Setting(containerEl)
      .setName('Highlight annotated blocks')
      .setDesc(
        'Draws a thin rule beside any block that carries a linknote, so annotated passages stand out ' +
          'while reading. On mobile an annotated list item gets none: there is no room beside the number.'
      )
      .addToggle((t) =>
        t.setValue(s.highlightAnchored).onChange(async (v) => {
          s.highlightAnchored = v;
          await this.plugin.saveSettings();
          this.plugin.applyCardStyle();
        })
      );

    /* ------------------------------------------------------- the cards */

    new Setting(containerEl).setName('Cards beside the text').setHeading();

    new Setting(containerEl)
      .setName('Show linknotes as cards')
      .setDesc(
        'Draws each linknote beside the passage it annotates — in the margin where the pane is wide ' +
          'enough, under the block where it is not. Reading view only, and nothing is written to your ' +
          'notes. Cards are not drawn on mobile, where tapping a marker opens a sheet instead.'
      )
      .addToggle((t) =>
        t.setValue(s.showCards).onChange(async (v) => {
          s.showCards = v;
          await this.plugin.saveSettings();
          if (v) this.plugin.settleCards();
          else this.plugin.clearCardLayout();
          // The rows below only apply when cards are drawn.
          this.redraw();
        })
      );

    if (Platform.isMobile) {
      containerEl.createDiv({
        cls: 'lkn-hint',
        text: 'Cards are not drawn on mobile. Tap a marker to open the linknote in a sheet.',
      });
    } else if (s.showCards) {
      new Setting(containerEl)
        .setName('Card placement')
        .setDesc(
          'In the margin, the text column is narrowed to make room, which is what a margin note ' +
            'costs. A pane too narrow for that falls back to inline whichever is chosen.'
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

      const widthSetting = new Setting(containerEl)
        .setName('Card width')
        .setDesc('How wide a card in the margin is. The room made for it follows, so a narrower card leaves more of the pane to the text.');
      const widthLabel = this.showValue(
        widthSetting,
        (Number(s.cardWidth) || DEFAULT_SETTINGS.cardWidth) + 'px — needs a pane about ' +
          cardMinPane(s.cardWidth) + 'px wide'
      );
      widthSetting.addSlider((sl) =>
        sl
          .setLimits(160, 400, 20)
          .setValue(Number(s.cardWidth) || DEFAULT_SETTINGS.cardWidth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardWidth = v;
            widthLabel(v + 'px — needs a pane about ' + cardMinPane(v) + 'px wide');
            await this.plugin.saveSettings();
            this.plugin.applyCardStyle();
            this.plugin.refitCards();
          })
      );

      const linesSetting = new Setting(containerEl)
        .setName('Lines shown per card')
        .setDesc('How much of a card is shown before it starts to scroll.');
      const linesLabel = this.showValue(
        linesSetting,
        (Number(s.cardMaxLines) || DEFAULT_SETTINGS.cardMaxLines) + ' lines'
      );
      linesSetting.addSlider((sl) =>
        sl
          .setLimits(3, 24, 1)
          .setValue(Number(s.cardMaxLines) || DEFAULT_SETTINGS.cardMaxLines)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardMaxLines = v;
            linesLabel(v + ' lines');
            await this.plugin.saveSettings();
            this.plugin.applyCardStyle();
            this.plugin.scheduleRelayout();
          })
      );

      const perSetting = new Setting(containerEl)
        .setName('Cards shown per block')
        .setDesc('A block can carry several linknotes. Any beyond this many are reached by scrolling the group.');
      const perLabel = this.showValue(
        perSetting,
        (Number(s.cardsPerStack) || 0) === 0 ? 'all of them' : Number(s.cardsPerStack) + ' cards'
      );
      perSetting.addSlider((sl) =>
        sl
          .setLimits(0, 10, 1)
          .setValue(Number(s.cardsPerStack) || 0)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardsPerStack = v;
            perLabel(v === 0 ? 'all of them' : v + ' cards');
            await this.plugin.saveSettings();
            this.plugin.scheduleRelayout();
          })
      );

      const sizeSetting = new Setting(containerEl)
        .setName('Card text size')
        .setDesc('As a percentage of the size Obsidian uses for small interface text. Above about 130% a narrow card holds very little, so widen the card to match.');
      const sizeLabel = this.showValue(
        sizeSetting,
        (Number(s.cardFontScale) || DEFAULT_SETTINGS.cardFontScale) + '%'
      );
      sizeSetting.addSlider((sl) =>
        sl
          .setLimits(70, 200, 5)
          .setValue(Number(s.cardFontScale) || DEFAULT_SETTINGS.cardFontScale)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.cardFontScale = v;
            sizeLabel(v + '%');
            await this.plugin.saveSettings();
            this.plugin.applyCardStyle();
          })
      );

      new Setting(containerEl)
        .setName('Card text color')
        .setDesc('Normal, Muted, Faint and Accent follow your theme and stay readable in light and dark. A custom color does not.')
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
            // The custom colour is only offered once it is the one in use.
            this.redraw();
          });
        });

      if (s.cardTextColour === 'custom') {
        // The box and the swatch are two ways into one value, so each writes
        // the other's face. Redrawing the tab instead would shut the picker
        // on the first drag.
        let colourBox = null;
        new Setting(containerEl)
          .setName('Custom card text color')
          .setDesc('Used while Card text color is set to Custom. It does not follow your theme, so check it in both light and dark mode.')
          .addText((t) => {
            colourBox = t;
            t.setPlaceholder('#888888')
              .setValue(s.cardTextColourCustom || '')
              .onChange(async (v) => {
                s.cardTextColourCustom = v.trim();
                await this.plugin.saveSettings();
                this.plugin.applyCardStyle();
              });
          })
          .addColorPicker((c) =>
            c.setValue(s.cardTextColourCustom || '#888888').onChange(async (v) => {
              s.cardTextColourCustom = v;
              await this.plugin.saveSettings();
              this.plugin.applyCardStyle();
              if (colourBox) colourBox.inputEl.value = v;
            })
          );
      }

      new Setting(containerEl)
        .setName('Start with cards stowed')
        .setDesc(
          'Stowed cards are drawn as thin strips beside their passages, leaving the text its full ' +
            'width. Press a strip, or run "Show or stow the linknote cards", to open them again.'
        )
        .addToggle((t) =>
          t.setValue(s.cardsCollapsed).onChange(async (v) => {
            this.plugin.toggleCardsCollapsed(v);
          })
        );
    }

    /* ---------------------------------------------------------- behaviour */

    new Setting(containerEl).setName('Behavior').setHeading();

    new Setting(containerEl)
      .setName('Show the Linknote button when text is selected')
      .setDesc(
        'Appears next to a selection in Reading view — on mobile, as a bar along the bottom of the ' +
          'screen. Turn it off to work from the command palette or a hotkey instead.'
      )
      .addToggle((t) =>
        t.setValue(s.showFloatingButton).onChange(async (v) => {
          s.showFloatingButton = v;
          if (!v) this.plugin.hideFloatingButton();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Open the linknote after creating it')
      .setDesc('Opens it in a split beside the note you were reading, once the block reference resolves.')
      .addToggle((t) =>
        t.setValue(s.openAfterCreate).onChange(async (v) => {
          s.openAfterCreate = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Count a linknote as read')
      .setDesc(
        'When another person’s linknote stops counting as unread. "When you say so" waits for the ' +
          'tick on the card or the row, or for the linknote to be opened as a note — seeing a card go ' +
          'past is not the same as having taken it in. "When it is shown" clears it as soon as a card ' +
          'or a this-note row draws it.'
      )
      .addDropdown((d) => {
        d.addOption('open', 'When you say so');
        d.addOption('shown', 'When it is shown');
        d.setValue(s.readOn === 'shown' ? 'shown' : 'open');
        d.onChange(async (v) => {
          s.readOn = v === 'shown' ? 'shown' : 'open';
          await this.plugin.saveSettings();
          this.plugin.refreshListViews();
          this.plugin.settleCards();
        });
      });

    new Setting(containerEl)
      .setName('Notify when linknotes change')
      .setDesc(
        'One notice sums up linknotes that other people add or edit — as they arrive over sync, ' +
          'and on start-up for whatever came in while the vault was closed. Linknotes whose author ' +
          'matches the Author above are yours and are never announced. Unread linknotes are dotted ' +
          'in the sidebar list, where the whole-vault scope shows everything; the dots stay either ' +
          'way, this only quiets the notices.'
      )
      .addToggle((t) =>
        t.setValue(s.notifyOthers).onChange(async (v) => {
          s.notifyOthers = v;
          await this.plugin.saveSettings();
        })
      );

    /* ------------------------------------------------ chat notifications */

    new Setting(containerEl).setName('Chat notifications').setHeading();

    containerEl.createEl('p', {
      cls: 'setting-item-description lkn-preview',
      text:
        'Everything above stays inside Obsidian. This one part does not: when someone else ' +
        'annotates a note you wrote, a single line is posted to a chat channel of your choosing — ' +
        'so it reaches you when Obsidian is not what you are looking at. It is off until you turn ' +
        'it on and give it an address.',
    });

    const chat = this.plugin.chat || { on: false, webhook: '' };

    containerEl.createEl('p', {
      cls: 'setting-item-description lkn-preview',
      text: chatIsLive(chat)
        ? 'Ready: a linknote written by someone else on one of your notes will be posted.'
        : chat.on
          ? 'Switched on, but nothing will be sent: there is no webhook address yet.'
          : 'Switched off. Nothing is sent.',
    });

    new Setting(containerEl)
      .setName('Post to a chat channel')
      .setDesc(
        'Only for linknotes written by someone else on a note whose author is you — both judged by ' +
          'the author property, so set Author above on every device. Desktop only: a phone does not ' +
          'keep a plugin running, and the chat app is already there. Nothing else about the plugin ' +
          'sends anything anywhere.'
      )
      .addToggle((t) =>
        t.setValue(chat.on).onChange((v) => {
          chat.on = v;
          this.plugin.chat = chat;
          this.plugin.saveChatConfig();
          // Said, not silently corrected: the switch keeps what you set, and
          // starts working the moment an address is there.
          if (v && !safeWebhook(chat.webhook)) {
            new Notice('Linknote: nothing will be sent until an https:// webhook address is set below.');
          }
          this.redraw();
        })
      );

    new Setting(containerEl)
      .setName('Your name in note properties')
      .setDesc(
        'How a note of yours says it is yours — the name in its own author property. That is often ' +
          'not the name above: the Author is per device, so that a linknote written on your phone ' +
          'can be told from one written at your desk, while your notes name you once as a person. ' +
          'Several names can be given, separated by commas, and a note naming you among others ' +
          'counts as yours. Left empty, the Author above is used.'
      )
      .addText((t) =>
        t
          .setPlaceholder(s.author || '(the Author above)')
          .setValue(s.noteAuthor)
          .onChange(async (v) => {
            s.noteAuthor = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Webhook address')
      .setDesc(
        'A WeCom (企业微信) group robot address, or anything else that accepts the same JSON. HTTPS ' +
          'only — the address is itself the secret, which is why it is kept on this device and never ' +
          'in the vault: in a shared vault, an address in the settings file would become everyone’s, ' +
          'and all three of you would post into one person’s channel. Each person sets their own, and ' +
          'a second machine needs it typing again.'
      )
      .addText((t) => {
        t.setPlaceholder('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…')
          .setValue(chat.webhook)
          .onChange((v) => {
            chat.webhook = safeWebhook(v);
            this.plugin.chat = chat;
            this.plugin.saveChatConfig();
          });
        t.inputEl.type = 'password';
        t.inputEl.addClass('lkn-wide-input');
        // What was actually kept, once the typing has stopped — the same
        // courtesy the folder field gets.
        t.inputEl.addEventListener('blur', () => {
          if (t.inputEl.value !== chat.webhook) t.inputEl.value = chat.webhook;
        });
      });

    new Setting(containerEl)
      .setName('Send a test message')
      .setDesc(
        'Posts one line now, so you can see it arrive before relying on it. What a real message ' +
          'says is the count and the authors — never a note name and never any of the text.'
      )
      .addButton((b) =>
        b.setButtonText('Send').onClick(async () => {
          const url = safeWebhook(chat.webhook);
          if (!url) {
            new Notice('Linknote: enter an https:// webhook address first.');
            return;
          }
          b.setDisabled(true);
          const failed = await this.plugin.sendChat(
            url,
            chatText([{ author: s.author || '(no author)', kind: 'new' }]) + ' — test'
          );
          b.setDisabled(false);
          new Notice(
            failed ? 'Linknote: the test was not sent — ' + failed : 'Linknote: the test was sent.'
          );
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
module.exports.markerMatch = markerMatch;
module.exports.markerOfLink = markerOfLink;
module.exports.blockOccurrences = blockOccurrences;
module.exports.spliceAnchored = spliceAnchored;
module.exports.markerBlockOf = markerBlockOf;
module.exports.quotedSelectionOf = quotedSelectionOf;
module.exports.selectionShown = selectionShown;
module.exports.runInText = runInText;
module.exports.collapseWithMap = collapseWithMap;
module.exports.sanitizeSettings = sanitizeSettings;
module.exports.authorOf = authorOf;
module.exports.isOwnAuthor = isOwnAuthor;
module.exports.diffKnown = diffKnown;
module.exports.noticeText = noticeText;
module.exports.sanitizeSeenState = sanitizeSeenState;
module.exports.headSlot = headSlot;
module.exports.badgeText = badgeText;
module.exports.readsOnShowing = readsOnShowing;
module.exports.chatText = chatText;
module.exports.safeWebhook = safeWebhook;
module.exports.sanitizeChatConfig = sanitizeChatConfig;
module.exports.chatIsLive = chatIsLive;
module.exports.isOwnNote = isOwnNote;
module.exports.chatWorthy = chatWorthy;
module.exports.namesOf = namesOf;
module.exports.rowMatches = rowMatches;
module.exports.sortRows = sortRows;
module.exports.unreadOnly = unreadOnly;
module.exports.safeFolder = safeFolder;
module.exports.linkDisplayText = linkDisplayText;
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
