# Linknote

Write a side note **without leaving Reading view**. Linknote saves what you write as its own note and leaves a small link — plus a standard block ID — at the exact spot in the source note.

The point is that your commentary lives in a separate, ordinary note. It shows up in search, in the graph, and in Bases, and it is anchored with plain Obsidian syntax rather than a private format. Remove the plugin and nothing breaks.

## How it works

1. Select some text in Reading view. A small button appears just below the selection.
2. Press it. A composer opens.
3. Write your note and save.

The source note gains a marker and a block ID at the anchored spot:

```markdown
The quarterly close lands on the tenth business day. [[My linknote|†]] ^k3n8v1
```

And the linknote embeds the block it is attached to, so it follows along when you revise the source:

```markdown
![[Team handbook#^k3n8v1]]
```

## Why not just annotate inline

Most annotation plugins keep the comment inside the note it belongs to, or in a sidecar file with their own position format. Linknote takes the opposite route: the source note keeps only an anchor, and the commentary becomes a real note you can link, tag, and query like any other.

Anchoring uses Obsidian's own block references, so a linknote keeps pointing at the right paragraph after you revise the surrounding text.

## Installation

Linknote is not in the community directory yet.

### With BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then **Add beta plugin** and enter `tsuney/obsidian-linknote`. BRAT keeps it up to date, and this is the only practical route on mobile.

### Manually

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/tsuney/obsidian-linknote/releases/latest), put them in `<vault>/.obsidian/plugins/linknote/`, reload Obsidian and enable the plugin.

## Usage

The command **Create linknote from selection** is registered, so you can bind a hotkey and skip the floating button — turn the button off under Settings → Linknote if it gets in the way.

In the composer, `Ctrl/Cmd + Enter` saves and `Esc` cancels.

## Templates

The linknote is built from a template you control, frontmatter included. The default is deliberately minimal:

```markdown
---
created: {{date}}
source: "{{source}}"
---

# {{title}}

{{embed}}

{{body}}
```

Available variables:

| Variable | Meaning |
| --- | --- |
| `{{title}}` | the title you typed, or the start of the selection |
| `{{body}}` | the note you typed |
| `{{selection}}` | the selected text |
| `{{selectionQuote}}` | the selected text, every line prefixed with `> ` |
| `{{source}}` | link to the source note |
| `{{sourceName}}` | name of the source note |
| `{{sourcePath}}` | path of the source note |
| `{{embed}}` | embed of the anchored block; a plain link when the anchor is a heading; empty when block IDs are off |
| `{{blockId}}` | the block ID, without the caret |
| `{{date}}` | creation date, using the configured date format |
| `{{time}}` | creation time, as `HH:mm` |
| `{{author}}` | the author set in settings |
| `{{summary}}` | source note name and a short excerpt |

Three presets ship with the plugin — **Minimal**, **With the quoted selection** and **Detailed**. Pick the closest one under Settings → Linknote → Load a preset, then rewrite it. They are plain English starting points; the plugin has no opinion about the language you write in, and no built-in layout beyond the template you set.

The same variables work in the filename template. Blank runs left behind by empty variables are collapsed, so a template stays readable when block IDs are turned off.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Linknote folder | `Linknotes` | created if missing |
| Filename template | `{{title}}_{{date}}` | `.md` is added for you. `{{title}}` is shortened to 50 characters here only; the note itself keeps the full text |
| Date format | `YYYY-MM-DD` | tokens: `YYYY YY MMMM MMM MM DD dddd ddd HH mm ss` |
| Author | empty | exposed as `{{author}}` |
| Note template | see above | the whole note, frontmatter included |
| Load a preset | — | replaces the note template with one of three starting points |
| Link marker | `†` | the character left in the source note |
| Add a block ID | on | needed for `{{embed}}` |
| Insert the link marker | on | turn off to leave only a block ID |
| Show the floating button | on | turn off for hotkey-only use |
| Marker style | Chip | chip, or an ordinary link |
| Mark the annotated block | on | a thin rule beside blocks that carry a linknote |
| Open the linknote after creating it | off | opens in a split, once the block reference resolves |

## Appearance

The marker in the source note is rendered as a small chip, and the block it belongs to gets a thin rule beside it, so annotated passages are visible while you read. Both are drawn at render time: **nothing extra is written to your notes**, and turning either off restores the plain look immediately.

Hovering the marker previews the linknote. The shipped templates put your note above the source embed for that reason — the preview opens on what you wrote, not on the passage you are already looking at.

## How the anchoring works

Reading view renders Markdown, so the hard part is mapping a rendered selection back to a position in the source. Linknote records the mapping between rendered elements and their render context while the note is drawn, then asks that context for the block's source range at the moment you save, using the public `MarkdownPostProcessorContext.getSectionInfo()` API.

The write-back does not use line numbers. It locates the block by matching its source text against the current file. If the block cannot be found, or the same text appears more than once, Linknote refuses to write rather than guessing.

Anchors are placed at block granularity, matching Obsidian's own block references. Tables, code blocks and math blocks get their anchor on the following line, since appending inline would break the syntax.

Headings are a case of their own. Obsidian has no block ID for a heading, and appending anything to the heading line would change its text and break every `[[Note#Heading]]` pointing at it. So the marker goes on the line below, and in Reading view it is drawn back up next to the heading, so it reads as though it were part of it.

For the same reason `{{embed}}` becomes a plain link when the anchor is a heading. Embedding `![[Note#Heading]]` would pull in the entire section — every subsection down to the next heading of the same level — which for a top-level heading is most of the note. The link previews that section on hover instead.

## Known limitations

- Reading view only. Live Preview is already editable, so there is nothing to solve there.
- Anchors are per block. Selecting one sentence inside a long paragraph anchors the paragraph. Keep `{{selection}}` in your template if you want the exact wording recorded.
- Inside a callout or a blockquote, the anchor attaches to that line rather than to the callout as a whole.
- A heading is referenced by its heading anchor rather than a block ID, because Obsidian has no block IDs for headings and rewriting the heading would break links to it. Rename the heading later and the reference goes stale — unlike a block ID, which survives edits.
- In a list, the anchor attaches to the selected item. If two items have exactly the same text, Linknote stops rather than guessing.
- If two blocks in a note have exactly the same text, Linknote stops instead of picking one.
- There is no command to remove a linknote yet. Delete the note and remove the ` [[…]]` and ` ^id` from the source by hand.

## Multiple windows

Linknote works in popped-out windows. Listeners are registered per window, and the composer opens in whichever window has focus.

## Contributing

Issues and pull requests are welcome. The plugin is plain JavaScript with no build step: edit `main.js` and reload Obsidian.

Two test suites run on plain Node, with no dependencies:

```bash
node test.js              # pure helpers: anchoring, dates, template rendering
node test/integration.js  # note creation end to end, against a fake vault
```

## Changelog

### 0.9.0

- Headings are now referenced by their heading anchor. Previously a block ID landed on the line holding the marker, so the linknote embedded the marker and nothing else. The marker is also rendered next to the heading rather than under it, without touching the heading text.
- A heading anchor produces a link rather than an embed. `![[Note#Heading]]` embeds the whole section, which for a top-level heading is most of the note.
- Matching a selection falls back to a letters-and-digits-only comparison when markup normalisation is not enough. A passage carrying bold together with a same-note heading link could fail to match, because Obsidian's rendering differs from the source in ways that are not markup.
- The marker is rendered as a small chip, and the block it is attached to gets a thin rule beside it. Both are render-time only — your notes are untouched — and both can be turned off.
- The shipped templates now place your note above the source embed, so hovering the marker previews what you wrote rather than the passage you are already reading.

### 0.8.1

- Fixed: with "Open the linknote after creating it" on, the newly opened note embedded the whole source instead of the anchored block. The anchor reaches the source before the metadata cache does, and an unresolved block reference falls back to embedding everything. Opening now waits for the cache, with a two-second ceiling so a missed event cannot hang.

### 0.8.0

- The default filename template is now `{{title}}_{{date}}`. A date in the name keeps linknotes distinguishable when the same passage is annotated more than once, and keeps them ordered in the file list.
- The composer's title field is prefilled with the start of the selection, so it is visible and editable rather than an invisible fallback.
- The settings tab shows the filename your template will produce, updating as you type. A misspelled variable now shows up immediately instead of ending up in a filename.

### 0.7.2

- Each setting now states its shipped default, so a customised value is easy to tell apart from the one the plugin came with.

### 0.7.1

- Fixed: long filenames were truncated after the template had been assembled, which cut whatever the template put last — typically the date. The title is now shortened before the name is built (50 characters), and the finished name is capped by bytes rather than characters, so non-Latin scripts are measured correctly.

### 0.7.0

- Added three template presets, loadable from the settings tab.
- Removed the migration path for pre-0.6.0 installs, along with the localised template it carried. Nothing shipped before 0.6.0, so nothing needed migrating.

### 0.6.3

- Fixed: a passage containing inline markup — `code`, **bold**, `[[wikilinks]]`, `[text](links)` — could not be matched, because Reading view hands back rendered text while the source still holds the markup. Matching now normalises both sides. A list item wrapped in backticks was the case that surfaced it.

### 0.6.2

- Fixed: the source position was resolved when you pressed Save, so a re-render while the composer was open — triggered by focus changes, by another plugin redrawing task lines, or by an external edit to the file — made it fail with "the position in the source could not be determined". The position is now captured the moment you select, with two fallbacks behind it.
- Fixed: in a list with several items, the anchor landed on the last item instead of the one you selected. Obsidian reports a whole list as a single block; Linknote now narrows it to the selected line. Task lines are covered by the same fix.
- Identical list items abort instead of anchoring the wrong one.

### 0.6.1

- Fixed: adding a linknote to a block that already had a block ID removed that ID, breaking any existing block references to it. The ID is now preserved.

### 0.6.0

- Linknotes and filenames are built from templates you control, frontmatter included.
- The interface is in English.
- Groundwork for mobile: touch selection, button placement, no autofocus fighting the keyboard.

## License

[MIT](LICENSE)
