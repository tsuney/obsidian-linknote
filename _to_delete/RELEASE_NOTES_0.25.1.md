**Dates in plain language, in the composer**, if you have [Natural Language Dates](https://github.com/argenos/nldates-obsidian) installed.

## How it works

Type `@next friday` in the note field, or press the new **Date** button. The date it resolves to is offered as a suggestion showing **both the phrase and the date** — `next fri — 2026-08-28-Friday` — so what was understood is visible before it is committed. Arrow keys move through the list, Enter picks. With nothing typed after the trigger you get *today*, *tomorrow*, *yesterday*, *next monday* and *next week*.

## Linknote holds no date settings

Not one. The format, whether the date is wrapped in a wikilink, and which character opens the suggestion are all read from that plugin, where you have already answered them. Asking again here would put two answers to one question in one vault, and the two would drift apart the first time either was changed. Turning off that plugin's own autosuggest turns off ours as you type, and leaves the button.

## Borrowed carefully

This is the first thing Linknote takes from another plugin, so:

- The **Date button appears only when that plugin is installed and enabled**. A button that never does anything is worse than none.
- Only `parseDate` is documented as an API. The settings are read off the plugin instance, which is not, so each is checked for the type it should be and falls back to that plugin's own default. If it renames one, dates keep working in the shape most people have.
- **A phrase it cannot read is not offered.** That plugin does not return nothing for a phrase it fails on — it returns one, formatted, reading *Invalid date*, because that is what a moment that failed prints. Taken at face value it looks like a date; 0.25.0 offered it as one, and it went into the note as `[[Invalid date]]` — a broken link recording only that a parser had shrugged. The moment is now asked whether it worked rather than its output being read as though it had.
- Which is also what keeps an email address typed mid-sentence an email address: nothing parses, so nothing is offered, and the `@` stays the character it was.

---

**Install**: drop `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/linknote/`, then reload Obsidian.
