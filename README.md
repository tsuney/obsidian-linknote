# Linknote

Write a side note **without leaving Reading view**. Linknote saves what you write as its own note and leaves a small marker — plus a standard block ID — at the exact spot in the source note.

Requires Obsidian 1.6.6 or later. Works on desktop and mobile. Linknotes are made from Reading view, and because each one is its own file, several people sharing a vault can annotate the same note without writing over each other.

The point is that your commentary lives in a separate, ordinary note. It shows up in search, in the graph and in Bases, and it is anchored with plain Obsidian syntax rather than a private format. Remove the plugin and nothing breaks.

**What it does**

- Writes a side note without leaving Reading view, and saves it as its own note.
- Anchors it with Obsidian's own block reference, so it stays on its passage as the note is revised.
- Shows the linknotes of the note you are reading as cards beside the text, and as a list in the sidebar.
- Shows which words each one is about, and points at them in the text.
- Removes a linknote and its marker together, after saying exactly what will happen.
- Nothing is sent anywhere: the plugin makes no network requests and stores nothing outside your vault.

## How it works

1. Select some text in Reading view. A small button appears just below the selection — on mobile, a bar along the bottom of the screen.
2. Press the **† Linknote** button. A composer opens, titled **New linknote**.
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

### From Obsidian

Settings → Community plugins → Browse, search for **Linknote**, then install and enable it. (Pending review at the time of writing; until then, use one of the routes below.)

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
```

The passage you annotated sits in a folded callout whose title carries a link straight back to the anchored spot, so what you wrote is what you see when you open the note, and the source is one click away.

The body heading is not decoration. It is how a linknote says which part of itself is the note, as opposed to the quoted source — an explicit marker rather than a guess about layout. The cards read the section under it, and the `body` property is written from it.

Available variables:

| Variable | Meaning |
| --- | --- |
| `{{title}}` | the title you typed, or the start of the selection |
| `{{titleShort}}` | the same title cut to 30 characters, with an ellipsis when it is longer, for a heading or a callout |
| `{{body}}` | the note you typed |
| `{{bodyQuote}}` | the same, every line prefixed with `> ` so it stays inside a callout |
| `{{bodyYaml}}` | the same, as a YAML block scalar, safe to put in a property |
| `{{selection}}` | the selected text |
| `{{selectionQuote}}` | the selected text, every line prefixed with `> ` |
| `{{selectionYaml}}` | the selected text, as a YAML block scalar, safe to put in a property |
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
| `{{marker}}` | the marker character set in settings; useful when two devices are set to different ones |
| `{{bodyHeading}}` | the body heading set in settings, so the template and the setting cannot drift apart |
| `{{summary}}` | source note name and a short excerpt |

Five presets ship with the plugin — **Minimal — your note, with the source folded above**, **Just a callout**, **With the source embed**, **With the quoted selection** and **Detailed — properties, sections, source line**. Pick the closest one under Settings → Linknote → Start from a preset, then rewrite it. They are plain English starting points; the plugin has no opinion about the language you write in, and no layout of its own beyond the template you set.

The same variables work in the filename template. Runs of separators left by an empty variable are cleaned up, so `{{sourceName}}_{{anchor}}` reads correctly even where there is no anchor, and the finished name is capped at 180 bytes, so scripts that are not Latin are measured correctly.

## Reading a note that carries linknotes

The marker is rendered as a small chip, and the block it belongs to gets a thin rule beside it, so annotated passages are visible while you read. Hovering the marker previews the linknote.

Two exceptions. A heading gets no rule — a rule there reads as a quote bar — and its marker, which has to live on the line below it in the file, is drawn back up into the heading line while you read. On mobile an annotated list item gets no rule either: lists are indented less there, and the rule would land between the number and the text.

Both are drawn as the note is rendered. **Nothing extra is written to your notes**: turn off *Highlight annotated blocks*, or set *Marker style* to Plain, and the plain look is back at once. Popped-out windows work too: listeners are registered per window, and the composer opens in whichever window has focus.

### The list in the sidebar

**Show the linknotes in this note** — from the command palette, or the ribbon icon — opens a list of every linknote you are reading carries, in the order they appear in it. Each row is headed the same way a card is — the marker, then who wrote it and when — followed by the words the linknote is about, and then the note itself. Pressing the passage goes to it in the source; pressing the row opens the linknote.

Above the rows are a search box and an order. Typing narrows the list: every word has to appear somewhere in the row — the author, the note, the passage, or the file name — so two words narrow rather than widen, and nothing you type is treated as a pattern. The order can be the one in the note (the default), newest first, recently changed, or by author; **Unread only** narrows the list to what is still waiting, newest first. The choice is remembered between sessions, and rows with nothing to separate them keep the order they have in the note.

The cards answer "what is written here". The list answers "what has been written about this note, and where". On mobile it is the main answer, since a card has nowhere to go there.

The list has a scope: **This note**, or **Whole vault**. The vault-wide list — the **Linknote inbox** — is for a shared vault: every linknote anyone has written, ordered recently-changed first by default, with a **Mark all read** button. Each row is headed by a dot while this device has not shown it yet, and by the marker of whoever wrote it once it has been read — one slot, never both. Rows in this-note scope are marked read as they are listed; the inbox marks a row read only when you open it.

### Cards

Turn on **Show linknotes as cards** and each linknote is drawn beside the passage it annotates, headed by the marker it was written with, then who wrote it and when, then the words it is about on one line. Anchors are per block, so two linknotes on one paragraph are told apart by that line and nothing else; the whole passage is on hover. That line opens the full note; hovering it shows the file name. The marker is read from the link in your note rather than from a property, so it is the character actually used — which on a second device set to a different one tells you at a glance where the note came from.

A margin note needs a margin, and Obsidian does not leave one: the text column is centered with 70–150px either side, which no card fits into. So a note that carries cards has its text column narrowed and pushed left, and the cards live in the space that frees. That is what a margin note costs, and it applies only to notes that have linknotes. Where the pane is too narrow to afford it the cards go under the block they belong to instead, and **Card placement** can be set to that inline form permanently. **On mobile there are no cards at all** — tablets included: there is no margin to use, and inline cards interrupt the reading. Tapping a marker there opens a sheet — a panel from the bottom of the screen — with that block's linknotes.

The cards of one block are gathered behind a single rail. Where a group has to be pushed down to clear the one above it, a thin line traces the distance back up to the block it belongs to. A block shows three cards at a time and a card shows six lines, both settings; the rest is reached by scrolling.

Press the **–** on any card to stow them all. Each shrinks to a strip beside its passage, so you can still see which passages carry a note, and the text takes the room back. Pressing any strip brings them back, as does the command **Show or stow the linknote cards**. The state is remembered.

Press the quoted passage and the words are pointed at in the text beside the card. Nothing is written to your note and nothing in Obsidian's rendered page is altered: the range is handed to the browser's own highlight registry, which colors it for a few seconds and then lets go. A passage spanning bold text or a link highlights correctly for the same reason. **The anchor is still the block** — the recorded words only say which part of it was selected, and where the note has since been revised so those words are gone, pressing does nothing but say so. The same works from a sidebar row, after it jumps to the passage.

The words a linknote is about come from its `selection` property, and, for a linknote written without one, from the quote the shipped templates keep it in. Nothing is guessed from the source note: what is shown is what the linknote recorded when it was made.

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

## Several people on one note

A vault shared between people — Obsidian Sync, which is paid, or any file-sync tool, since a linknote is plain Markdown — lets several readers annotate one note. Each linknote is a file of its own, so two people writing at the same time do not overwrite each other: one note accumulates commentary from several authors, each piece anchored to the block it was made from, and each staying on its passage as the note is revised.

Set **Author** on each device, and give each person a different **Marker character**. Cards and sidebar rows are then headed by the marker, the author and the date, so who wrote what is clear at a glance. Everyone should use the same **Linknote folder**: that is how a marker written with someone else's character is recognized here. On a call, share the screen in Reading view and write the linknote as the point comes up.

Other people's linknotes announce themselves. As they arrive over sync — and on start-up, for whatever came in while the vault was closed — one notice sums them up by author: *3 linknotes updated (Yamada: 2 new · Sato: 1 edited)*. Clicking it opens the inbox. A notice does not wait for you, so the ribbon icon also carries the number of linknotes still unread, which stays until they have been read. Linknotes whose author matches your own **Author** setting are never announced, and read marks are kept per device, in the app's local storage — they are this device's memory of what it has shown you, and never travel over sync. The notice can be turned off in settings; the dots stay either way.

Linknote does nothing about conflicts. Two people editing one source note at the same time is left to your sync tool, and two linknotes written offline on the same block can end up wanting the same name. **Author** is a setting, not an identity, and it is empty by default — a row then shows the date alone. Cards are desktop Reading view only, so on a shared screen only the presenter sees them; everyone else sees the linknote when their vault next syncs.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Linknote folder | `Linknotes` | created if missing |
| Filename template | `{{sourceName}}_{{anchor}}` | `.md` is added for you. `{{title}}` is shortened to 50 characters here only; the note itself keeps the full text |
| Date format | `YYYY-MM-DD` | tokens: `YYYY YY MMMM MMM MM DD dddd ddd HH mm ss` |
| Author | empty | exposed as `{{author}}` |
| Note template | see above | the whole note, frontmatter included |
| Start from a preset | — | replaces the note template with one of five starting points; it asks first if the template is your own |
| Marker character | `†` | left at the anchored spot |
| Add a block ID | on | needed for `{{embed}}` |
| Add a link marker | on | what the cards, the list and Remove find a linknote by; off leaves only a block ID |
| Marker style | Chip | a chip, or an ordinary link |
| Highlight annotated blocks | on | a thin rule beside blocks that carry a linknote |
| Show linknotes as cards | off | draws each linknote beside the passage it annotates |
| Card width | 240px | the room made for a margin card follows |
| Lines shown per card | 6 | how much a card shows before it scrolls |
| Cards shown per block | 3 | any beyond that are reached by scrolling the group; 0 shows them all |
| Card text size | 100 | percentage of Obsidian's small interface text |
| Card text color | Normal | Normal, Muted, Faint and Accent follow the theme; a custom color does not |
| Custom card text color | — | shown only while Card text color is Custom |
| Start with cards stowed | off | stowed cards are thin strips beside their passages |
| Card placement | In the margin | a narrow pane falls back to inline either way; on mobile no cards are drawn at all |
| Body heading | `Linknote` | the heading marking your own note inside a linknote |
| Keep the body property in step with the note | on | the note wins; an edit made to the property is overwritten |
| Show the Linknote button when text is selected | on | turn off for hotkey-only use |
| Open the linknote after creating it | off | opens in a split, once the block reference resolves |
| Notify when linknotes change | on | one notice per burst of other people's additions and edits; unread dots stay either way |
| Count a linknote as read | When you say so | the tick on a card or row, or opening the linknote; *When it is shown* clears it as a card or row draws it |

## How the anchoring works

Reading view renders Markdown, so the hard part is mapping a rendered selection back to a position in the source. Linknote records the mapping between rendered elements and their render context while the note is drawn, then asks that context for the block's source range at the moment you select, using the public `MarkdownPostProcessorContext.getSectionInfo()` API.

The write-back does not use line numbers. It locates the block by matching its source text against the current file, normalizing inline markup on both sides, since Reading view hands back rendered text while the file still holds the markup. **If the block cannot be found, or the same text appears more than once, Linknote refuses to write rather than guessing.**

Anchors are placed at block granularity, matching Obsidian's own block references. Tables, code blocks and math blocks take their anchor on the following line, since appending inline would break the syntax. In a list, the anchor attaches to the selected item rather than to the list as a whole.

The marker character is a setting, and two devices need not agree on it. So a marker is recognized in two ways: it is written with this device's character, or it is a short link — four characters or fewer, no spaces — into your linknote folder as this device has it set. With no folder set, only the character decides. That second rule is why a linknote written on your phone still gets a card on your desktop, even when the two are set to different characters. A longer link into the folder is treated as ordinary prose and left alone.

Headings are a case of their own. Obsidian has no block ID for a heading, and appending anything to the heading line would change its text and break every `[[Note#Heading]]` pointing at it. So the marker goes on the line below, and in Reading view it is drawn back up next to the heading, so it reads as though it were part of it. For the same reason `{{embed}}` becomes a plain link when the anchor is a heading: embedding `![[Note#Heading]]` pulls in the entire section, which for a top-level heading is most of the note.

## Known limitations

- Reading view only. Live Preview is already editable, so there is nothing to solve there.
- Anchors are per block. Selecting one sentence inside a long paragraph anchors the paragraph. Keep `{{selection}}` in your template if you want the exact wording recorded.
- Inside a callout or a blockquote, the anchor attaches to that line rather than to the callout as a whole.
- A heading is referenced by its heading anchor rather than a block ID. Rename the heading later and the reference goes stale — unlike a block ID, which survives edits.
- If two blocks in a note have exactly the same text, or two list items do, Linknote stops instead of picking one.
- Cards are drawn in Reading view only, and never on mobile — tablets included. The list in the sidebar and the sheet a marker opens are the answer there.
- One card per linknote in a view. Where a linknote is anchored in two separate blocks of one note, only the first gets a card; the sidebar lists it once, as it always has.
- Pointing at a passage in the text needs the browser's highlight registry, which Obsidian has had for some time. Where it is missing, pressing the passage does nothing.
- A long note is not all drawn at once, so a passage far from where you are reading has to be brought into the page before it can be pointed at. From the sidebar that is what the jump does; the plugin waits about three seconds for it, and gives up quietly rather than colouring the wrong words.
- The tag list is built by walking the vault's file caches the first time it is needed.
- Removal stops rather than guesses. If the source note links to the same linknote from more than one place, or if the source note changed while the confirmation was open, Linknote removes nothing and says why.

## Contributing

Issues and pull requests are welcome. The plugin is plain JavaScript with no build step: edit `main.js` and reload Obsidian.

Two test suites run on plain Node, with no dependencies:

```bash
node test.js              # pure helpers: anchoring, dates, templates, tags
node test/integration.js  # note creation end to end, against a fake vault
```

## Changelog

The last few releases are below; the full history is in [CHANGELOG.md](CHANGELOG.md).

### 0.21.1

- The sidebar list can show only what is unread: *Unread only* joins the orders, and works in either scope.

### 0.21.0

- A linknote counts as read when you say so — the tick on its card or row, or opening it as a note — rather than merely by being drawn on screen. The old behaviour is a setting.
- An unread card carries the accent colour and a tick to clear it.
- The ribbon badge is larger, the icon takes the accent while anything is waiting, and on desktop the count also sits in the status bar.

### 0.20.2

- The ribbon icon carries the unread count, and notices stand for twenty seconds rather than eight.
- A row in the inbox is headed by the marker of whoever wrote it, once the unread dot has gone.
- The search box in the sidebar is usable again; the whole-vault list is named **Linknote inbox**.
- Editing someone else's linknote yourself no longer announces it back to you.

### 0.20.1

- A card that fell inline in a narrow pane comes back to the margin when the pane is made wide again — by any means, not only a window resize.
- A card whose pane could not be measured is retried rather than left inline for good.
- The sidebar list redraws once per burst rather than once per cause.

### 0.20.0

- **Linknotes from other people announce themselves.** One notice per burst, grouped by author — *3 linknotes updated (Yamada: 2 new · Sato: 1 edited)* — covering what sync delivers while the vault is open and, on start-up, what came in while it was closed. Your own linknotes are never news, and nothing is announced twice. Clicking the notice opens the vault-wide list.
- **The sidebar list has a scope: this note, or the whole vault.** The vault-wide list is the inbox: recently changed first, unread rows dotted, with a **Mark all read** button. Read marks are kept per device, in the app's local storage, and never travel over sync.
- New setting: **Notify when linknotes change** (on). It quiets the notices; the dots stay.

### 0.19.2

- The diagnostic line 0.19.1 wrote to the developer console when a passage could not be found is gone; it was there to find the cause and the cause is fixed. No other change.

### 0.19.1

- Pressing the passage on a card attached to a task highlights it. The card can be left hanging off a copy of the line that another plugin has since replaced — the Tasks plugin re-renders task lines — and nothing can be found inside a block that is no longer in the page. Rather than reason about which copy is which, the card now falls back to exactly what the sidebar does, which was working all along: find the marker again in the note as it stands, wait for the view if it is still drawing, and say so only at the end.

### 0.19.0

- **The sidebar list has a search box and an order.** Type to narrow the list — every word has to appear in the author, the note, the passage or the file name, so two words narrow rather than widen — and choose between the order in the note (the default), newest first, recently changed, and by author. The order is remembered; what you typed is not. Rows with nothing to separate them keep the order they have in the note, so the list never shuffles under you.
- **Card text size goes up to 200%.** It stopped at 130%, which is not enough on a large display.
- The floating **Linknote** button holds the theme's accent colour even under a theme that styles every button, and shows a focus ring when reached from the keyboard.
- Pressing the passage on a card attached to a task now highlights it. Where another plugin re-renders a line — the Tasks plugin does — the card could be left hanging off a copy that is no longer in the page; the marker is now looked up afresh in the pane, the way the sidebar does it.

### 0.18.3

- The floating **Linknote** button no longer comes back after Save. Pressing the button raises a mouseup, and the check that mouseup schedules ran once the composer had already gone — finding the selection still standing, it drew the button again, where it sat until something was clicked. The selection is now let go once the linknote has been written, and the button stays away for a moment after the composer closes.

