# Linknote

Write a side note **without leaving Reading view**. Linknote saves what you write as its own note and leaves a small marker — plus a standard block ID — at the exact spot in the source note.

The point is that your commentary lives in a separate, ordinary note. It shows up in search, in the graph and in Bases, and it is anchored with plain Obsidian syntax rather than a private format. Remove the plugin and nothing breaks.

## How it works

1. Select some text in Reading view. A small button appears just below the selection — on mobile, a bar along the bottom of the screen.
2. Press it. A composer opens.
3. Write your note and save.

The source note gains a marker and a block ID at the anchored spot:

```markdown
The quarterly close lands on the tenth business day. [[Team handbook_k3n8v1|†]] ^k3n8v1
```

And the linknote points back at that exact block, not merely at the note:

```markdown
---
source: "[[Team handbook#^k3n8v1]]"
---
```

Nothing else is added to the source note. Both the marker and the block ID are ordinary Obsidian syntax.

## Why not annotate inline

Most annotation plugins keep the comment inside the note it belongs to, or in a sidecar file with a position format of their own. Linknote takes the opposite route: the source note keeps only an anchor, and the commentary becomes a real note you can link, tag and query like any other.

Anchoring uses Obsidian's own block references, so a linknote keeps pointing at the right paragraph after you revise the surrounding text.

## Installation

Linknote is not in the community directory yet.

### With BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then **Add beta plugin** and enter `tsuney/obsidian-linknote`. BRAT keeps it up to date, and this is the only practical route on mobile.

### Manually

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/tsuney/obsidian-linknote/releases/latest), put them in `<vault>/.obsidian/plugins/linknote/`, reload Obsidian and enable the plugin.

## Writing a linknote

The command **Create linknote from selection** is registered, so you can bind a hotkey and skip the floating button — turn the button off under Settings → Linknote if it gets in the way.

In the composer, `Ctrl/Cmd + Enter` saves and `Esc` cancels.

Two buttons sit above the note field. **Task** turns the line the caret is on into `- [ ] …`, and pressing it again takes the marker off. **Tag** starts a tag; typing `#` anywhere does the same. Either way a list of the tags already in your vault appears, arrow keys move through it and Enter picks one. That list is built from Obsidian's public file caches, not from an undocumented API.

## Templates

The linknote is built from a template you control, frontmatter included. The shipped one:

```markdown
---
created: {{date}} {{time}}
source: "{{sourceBlock}}"
author: {{author}}
body: {{bodyYaml}}
---

> [!NOTE]- {{titleShort}}
{{selectionQuote}}

## Linknote

{{body}}
```

The passage you annotated sits in a folded callout, so what you wrote is what you see when you open the note.

The `Linknote` heading is not decoration. It is how a linknote says which part of itself is the note, as opposed to the quoted source — an explicit marker rather than a guess about layout. The cards read the section under it, and the `body` property is written from it.

Available variables:

| Variable | Meaning |
| --- | --- |
| `{{title}}` | the title you typed, or the start of the selection |
| `{{titleShort}}` | the same title cut to 30 characters, with an ellipsis, for a heading or a callout |
| `{{body}}` | the note you typed |
| `{{bodyQuote}}` | the same, every line prefixed with `> ` so it stays inside a callout |
| `{{bodyYaml}}` | the same, as a YAML block scalar, safe to put in a property |
| `{{selection}}` | the selected text |
| `{{selectionQuote}}` | the selected text, every line prefixed with `> ` |
| `{{source}}` | link to the source note |
| `{{sourceName}}` | name of the source note |
| `{{sourcePath}}` | path of the source note |
| `{{sourceBlock}}` | link to the anchored spot rather than to the note; falls back to the note link when there is no anchor |
| `{{embed}}` | embed of the anchored block; a plain link when the anchor is a heading; empty when block IDs are off |
| `{{blockId}}` | the block ID, without the caret; empty on a heading, which has none |
| `{{anchor}}` | what the linknote is pinned to: the block ID, or the heading text |
| `{{date}}` | creation date, using the configured date format |
| `{{time}}` | creation time, as `HH:mm` |
| `{{author}}` | the author set in settings |
| `{{summary}}` | source note name and a short excerpt |

Five presets ship with the plugin — **Minimal**, **Just a callout**, **With the source embed**, **With the quoted selection** and **Detailed**. Pick the closest one under Settings → Linknote → Load a preset, then rewrite it. They are plain English starting points; the plugin has no opinion about the language you write in, and no layout of its own beyond the template you set.

The same variables work in the filename template. Runs of separators left by an empty variable are cleaned up, so `{{sourceName}}_{{anchor}}` reads correctly even where there is no anchor.

## Reading a note that carries linknotes

The marker is rendered as a small chip, and the block it belongs to gets a thin rule beside it, so annotated passages are visible while you read. Hovering the marker previews the linknote.

Two exceptions. A heading takes the marker into its own line and gets no rule, since a rule there reads as a quote bar. On mobile an annotated list item gets no rule either: lists are indented less there, and the rule would land between the number and the text.

Both are drawn as the note is rendered. **Nothing extra is written to your notes**, and turning either off restores the plain look immediately.

### The list in the sidebar

**Show the linknotes in this note** — from the command palette, or the ribbon icon — opens a list of every linknote the note in front carries, in the order they appear in it. Each row is headed by who wrote it and when, then the passage it is attached to, then the note itself. Pressing the passage goes to it; pressing the row opens the linknote.

The cards answer "what is written here". The list answers "what has been written about this note, and where". On a phone it is the main answer, since a card has nowhere to go there.

### Cards

Turn on **Show linknotes as cards** and each linknote is drawn beside the passage it annotates, headed by who wrote it and when. That line opens the full note; hovering it shows the file name.

A margin note needs a margin, and Obsidian does not leave one: the text column is centred with 70–150px either side, which no card fits into. So a note that carries cards has its text column narrowed and pushed left, and the cards live in the space that frees. That is what a margin note costs, and it applies only to notes that have linknotes. Where the pane is too narrow to afford it the cards go under the block they belong to instead, and **Card placement** can be set to that inline form permanently. **On a phone there are no cards at all**: there is no margin to use, and inline cards interrupt the reading. Tapping a marker there opens a sheet with that block's linknotes.

The cards of one block are gathered behind a single rail. Where a group has to be pushed down to clear the one above it, a thin line traces the distance back up to the block it belongs to. A block shows three cards at a time and a card shows six lines, both settings; the rest is reached by scrolling.

Press the **–** on any card to stow them all. Each shrinks to a strip beside its passage, so you can still see which passages carry a note, and the text takes the room back. Pressing any strip brings them back, as does the command **Show or stow the linknote cards**. The state is remembered.

The text on a card comes from the section under the **body heading** — `Linknote` by default. Edit the linknote and the card follows, without reopening the note it sits in. A linknote with no such heading falls back to its `body` property, and then to its whole contents.

### Removing a linknote

Press the **×** on a card, or on a row in the sidebar or the sheet. A window first says exactly what will happen: the linknote goes to wherever your vault sends deleted files, its marker comes out of the source note, and the block ID goes with it — unless something else in your vault points at that block, in which case the ID stays and only the marker is removed. Nothing else in either note is touched.

Two things stop a removal rather than guess at it. If the source note links to that linknote from more than one place, Linknote will not choose which marker to take out. And if the source note changed while the window was open, the removal is abandoned so that your edit is not written over.

## Using your linknotes

A linknote is an ordinary note, which is the whole point. It appears in search, in the graph and in backlinks without any help from this plugin. Two properties make it useful beyond that:

- `source` points at the exact block it annotates, so following it lands on the passage rather than on the top of a long note.
- `body` holds what you wrote as plain text, so a query can filter and display your commentary rather than the whole file.

With the shipped template, a Bases view over the `Linknotes` folder showing `source`, `author` and `body` gives you every annotation you have made, in one table. The same properties are what the cards read, so anything a query can show you can also sit beside the text.

The note is the original and the property is a copy of it. **Editing the property directly has no lasting effect** — it is overwritten from the note the next time Linknote reads the file. To change the text, change the note. Turning off *Write the body property from the note* stops both the copying and the overwriting.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Linknote folder | `Linknotes` | created if missing |
| Filename template | `{{sourceName}}_{{anchor}}` | `.md` is added for you. `{{title}}` is shortened to 50 characters here only; the note itself keeps the full text |
| Date format | `YYYY-MM-DD` | tokens: `YYYY YY MMMM MMM MM DD dddd ddd HH mm ss` |
| Author | empty | exposed as `{{author}}` |
| Note template | see above | the whole note, frontmatter included |
| Load a preset | — | replaces the note template with one of five starting points |
| Link marker | `†` | the character left at the anchored spot |
| Add a block ID | on | needed for `{{embed}}` |
| Insert the link marker | on | turn off to leave only a block ID |
| Marker style | Chip | a chip, or an ordinary link |
| Mark the annotated block | on | a thin rule beside blocks that carry a linknote |
| Show linknotes as cards | off | draws each linknote beside the passage it annotates |
| Cards shown per block | 3 | any beyond that are reached by scrolling the group; 0 shows them all |
| Card width | 240px | the room made for a margin card follows |
| Card height | 6 lines | how much a card shows before it scrolls |
| Card text size | 100 | percentage of Obsidian's small interface text |
| Card text colour | Normal | Normal, Muted, Faint and Accent follow the theme; a custom colour does not |
| Card placement | In the margin | a narrow pane and a phone fall back to inline either way |
| Body heading | `Linknote` | the heading marking your own note inside a linknote |
| Write the body property from the note | on | the note wins; an edit made to the property is overwritten |
| Show the floating button | on | turn off for hotkey-only use |
| Open the linknote after creating it | off | opens in a split, once the block reference resolves |

## How the anchoring works

Reading view renders Markdown, so the hard part is mapping a rendered selection back to a position in the source. Linknote records the mapping between rendered elements and their render context while the note is drawn, then asks that context for the block's source range at the moment you select, using the public `MarkdownPostProcessorContext.getSectionInfo()` API.

The write-back does not use line numbers. It locates the block by matching its source text against the current file, normalising inline markup on both sides, since Reading view hands back rendered text while the file still holds the markup. **If the block cannot be found, or the same text appears more than once, Linknote refuses to write rather than guessing.**

Anchors are placed at block granularity, matching Obsidian's own block references. Tables, code blocks and math blocks take their anchor on the following line, since appending inline would break the syntax. In a list, the anchor attaches to the selected item rather than to the list as a whole.

Headings are a case of their own. Obsidian has no block ID for a heading, and appending anything to the heading line would change its text and break every `[[Note#Heading]]` pointing at it. So the marker goes on the line below, and in Reading view it is drawn back up next to the heading, so it reads as though it were part of it. For the same reason `{{embed}}` becomes a plain link when the anchor is a heading: embedding `![[Note#Heading]]` pulls in the entire section, which for a top-level heading is most of the note.

## Known limitations

- Reading view only. Live Preview is already editable, so there is nothing to solve there.
- Anchors are per block. Selecting one sentence inside a long paragraph anchors the paragraph. Keep `{{selection}}` in your template if you want the exact wording recorded.
- Inside a callout or a blockquote, the anchor attaches to that line rather than to the callout as a whole.
- A heading is referenced by its heading anchor rather than a block ID. Rename the heading later and the reference goes stale — unlike a block ID, which survives edits.
- If two blocks in a note have exactly the same text, or two list items do, Linknote stops instead of picking one.
- Cards are drawn in Reading view only, and the tag list is built by walking the vault's file caches the first time it is needed.
- Removal stops rather than guesses. If the source note links to the same linknote from more than one place, Linknote will not choose which marker to take out, and says so.

## Multiple windows

Linknote works in popped-out windows. Listeners are registered per window, and the composer opens in whichever window has focus.

## Contributing

Issues and pull requests are welcome. The plugin is plain JavaScript with no build step: edit `main.js` and reload Obsidian.

Two test suites run on plain Node, with no dependencies:

```bash
node test.js              # pure helpers: anchoring, dates, templates, tags
node test/integration.js  # note creation end to end, against a fake vault
```

## Changelog

### 0.14.0

- **Removing a linknote.** The **×** on a card, on a sidebar row or on a sheet row removes the linknote and its marker together. A window says what will happen first: the note goes to wherever your vault sends deleted files, the marker comes out of the source, and the block ID goes with it only when nothing else in the vault points at that block.
- Removal refuses rather than guesses. Two markers for the same note in one source, or an edit to the source while the window is open, and nothing is removed.

### 0.13.1

- The rows in the sidebar are headed by the author and date, with the passage below. A linknote on a heading has no passage to quote, so that row was headed differently from the rest; a heading anchor now shows the heading itself.

### 0.13.0

- **A list in the sidebar.** Every linknote the note in front carries, in the order they appear in it, with the passage each is attached to. Pressing the passage goes to it; pressing the row opens the note. Opened from the ribbon or from **Show the linknotes in this note**.
- **On a phone, tapping a marker opens a sheet** with that block's linknotes, and cards are not drawn at all. A margin card has no margin to use there, and an inline card interrupts the reading.

### 0.12.10

- **Cards.** A linknote can be drawn beside the passage it annotates: in the margin where the pane is wide enough, inline where it is not, and always inline on a phone. Cards can be stowed to strips, sized and coloured, limited to a few per block, and they follow the linknote as it is edited. Off by default, and nothing is written to your notes.
- **The composer gained two buttons.** *Task* turns the current line into a task and back again. *Tag* opens a list of the tags already in your vault.
- **A new shipped template.** The annotated passage sits in a folded callout above your note, and a `Linknote` heading marks which part of the note is yours — which is what the cards read, and what the `body` property is written from.
- Added `{{titleShort}}`, `{{bodyQuote}}` and `{{bodyYaml}}`, and a **Just a callout** preset carrying the previous default.

### 0.10.1

- Added `{{anchor}}`: the block ID, or the heading text when the anchor is a heading. The shipped filename template uses it. `{{blockId}}` is empty on a heading, so `{{sourceName}}_{{blockId}}` gave every linknote on a heading in the same note the same name, and the second one onwards was numbered.

### 0.10.0

- New shipped defaults. The linknote is a callout carrying your note, and the filename is `{{sourceName}}_{{blockId}}`, so a linknote is named after the spot it annotates. **Existing settings are untouched** — this changes what a fresh install starts with, and what the first preset loads.
- Added `{{bodyQuote}}`: the note with every line prefixed with `> `. Without it a note of more than one line falls out of a callout after its first line.
- Added `{{titleShort}}`: the title cut to 30 characters with an ellipsis. Measured in characters rather than bytes, so a Japanese title is not cut to a third of the length of an English one.
- The presets are now four: the callout, the source embed (the previous default), the quoted selection, and the detailed one.
- Filename separators left behind by an empty variable are cleaned up. `{{sourceName}}_{{blockId}}` on a heading, which has no block ID, produced `Note_`; it now produces `Note`.

### 0.9.5

- Added `{{sourceBlock}}`: a link to the anchored spot rather than to the note as a whole. `{{source}}` points at the note, `{{embed}}` pulls the block in; this points at it. With block IDs off it falls back to the note link, so a template that uses it still reads correctly.
- The shipped templates now put `{{sourceBlock}}` in the `source` property, so the frontmatter points at the annotated passage rather than at the note. Existing templates are untouched; load a preset to pick up the change.

### 0.9.4

- Mobile: no rule beside an annotated list item. Lists are indented less there, so the rule fell between the number and the text. The marker chip on the item is signal enough; on desktop the rule is unchanged.

### 0.9.3

- Fixed: a numbered list item carrying a linknote lost its number in Reading view. The rule beside an annotated block was drawn with a border and a negative margin, which moves the content box; a list marker is laid out against that box, so the number was pushed past the left edge wherever the margin is narrow — mobile, most visibly. The rule is now a positioned pseudo-element and changes no layout.
- A heading no longer gets a rule beside it. The marker sits in the heading line itself, which is signal enough, and a rule there read as a quote bar.

### 0.9.2

- Mobile: the composer is pinned to the top of the visible area rather than merely capped in height. Obsidian's modal is a sheet anchored to the bottom of the screen, so shrinking it trimmed the top and left the note field under the keyboard.
- Mobile: the bar is drawn above Obsidian's own bottom navigation, which was covering it.

### 0.9.1

- Mobile: the button is now a bar along the bottom of the screen. Next to the selection there was nowhere to put it — the OS selection menu takes the space above, and below when there is no room above, so a one-line selection left no free spot and the button could not be reached at all.
- Mobile: Save and Cancel moved above the note field, and the composer is sized from `visualViewport`. The keyboard covers about half the screen while the layout viewport stays full height, so the lower half of the composer — the note field past its second line, and the buttons — was out of reach.

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
