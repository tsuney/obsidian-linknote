# Changelog

### 0.20.0

- **Linknotes from other people announce themselves.** A linknote someone else adds or edits — arriving over sync while the vault is open, or found on start-up among what came in while it was closed — is announced by one notice that groups the changes by author: *3 linknotes updated (Yamada: 2 new · Sato: 1 edited)*. Sync delivers in bursts, so changes are gathered for a few seconds — half a minute right after start-up, when sync catches up on everything at once — and told once. Your own linknotes, the ones whose author matches the **Author** setting, are never news; neither is anything a previous notice already covered, so a restart does not repeat itself. Clicking the notice opens the vault-wide list. Detection sits out a vault with no Linknote folder set, where every note would count as a linknote.
- **The sidebar list has a scope: this note, or the whole vault.** The vault-wide list is the inbox for a shared vault — every linknote anyone has written, recently changed first by default (the in-the-note order means nothing across a vault), with the search box and the other orders working as before, and a **Mark all read** button. Rows this device has not shown yet wear a dot in the theme's accent colour; the dot also says so in words, for anyone the colour alone would not tell.
- **Read marks are per device and stay out of the vault.** What has been shown here is remembered in the app's local storage, keyed by vault — not in `data.json`, which sync can carry to another device, where your reading would mark theirs; and not in any note, which would sync one person's reading to everyone. A linknote counts as read once its body has been on screen: opened as a note, painted as a card, listed in the this-note sidebar or the sheet, or opened from the vault-wide list, which lists without reading — it is the inbox, and an inbox that reads its own mail defeats the dot and the button both. Edited again later, a read linknote comes back as unread. The first run starts with everything read: announcing months of history as news would be worse than missing a beat.
- A renamed linknote is the same note under a new path, not news; a deleted one is forgotten, not announced.
- New setting: **Notify when linknotes change** (on). It quiets the notices; the unread dots stay either way.

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

### 0.18.2

- **Esc with the tag list open really does keep the composer open now.** Which handler sees the key first is not the plugin's to decide — Obsidian watches for Esc in two places of its own — so instead of racing, all three ways in are covered and they agree: the key on its way down, the modal's scope, and the close itself. The first Esc puts the list away, the second closes the composer.
- **A highlighted passage is scrolled to when it is off screen.** A long note is not all drawn at once, so from the sidebar the words were often painted where nobody could see them, or not found at all because that part of the note had not been drawn yet. The jump is given about three seconds to land, the linknote's own block is preferred throughout, and the passage is brought to the middle of the pane. A passage already on screen is left where it is.
- A task inside a card starts at the card's edge, whether or not the list is wrapped by the renderer; nested lists keep their step in.
- **Body heading** says in settings that `{{bodyHeading}}` in the template keeps the two in step, and that the body property is what is shown when the heading is not found — which is why changing the heading alone can look as though nothing happened.
- The shipped template puts the body heading directly under the quoted passage, with no blank line between them.

### 0.18.1

- **Esc** in the composer is decided in one place: it puts the tag list away while the list is on screen, and closes the composer otherwise. Whether the list is open is read from the list itself rather than from the matches behind it, so a stale match can no longer swallow the key and leave the box unclosable.

### 0.18.0

- **Pressing the passage highlights it even when the marker sits on a line of its own.** After a table, a code block or a heading the marker has to go on its own line, and that line is a block containing nothing but the marker — so the words were looked for in a block that never held them and Linknote said they were gone. The search now widens to the blocks just above and then to the note.
- The highlight no longer lands in the backlinks pane. Backlinks quote the same passage back, so from the sidebar the colour could appear down there instead of in the text.
- The **Linknote folder** field can be edited again. What was typed was corrected on every keystroke, so clearing the field snapped it back to the old name. It is corrected when you leave the field instead.
- The settings screen stays where you left it. Turning cards on or off, or switching the card text colour, redraws the tab, which used to throw the pane back to the top; and the colour picker no longer closes itself on the first drag.
- **Esc** with the tag list open puts the list away rather than closing the composer and losing what was typed.
- The floating **Linknote** button goes the moment the composer opens. The selection is still there while the box is up, and the events that raise the button fire after the press that opened it, so it came back and hung over the composer until something cleared the selection.
- **Create linknote from selection** asks for a selection instead of using the last one. With nothing selected — or with an image selected, which is no text — it used to annotate whatever had been read before.
- Ticking a task in the text no longer disturbs the cards. Obsidian redraws that one list item, taking the card hanging off it, and nothing asked for it back until the note was reopened.
- A task list at the top of a card starts at the card's edge, so a narrow card does not lose a third of its width to the indent.
- New template variable **`{{bodyHeading}}`**, so the heading the template writes and the **Body heading** setting cannot drift apart. The shipped template uses it.

### 0.17.2

- A task in a linknote is a checkbox in the sidebar too. The rows showed the note as plain text, so `- [ ]` stayed as written and a tag stayed as `#tag`; they render the same markdown a card does.
- Room for that checkbox inside a card. Obsidian draws it in the space a list's indent leaves, which inside a card was the card's own edge, so the box was cut in half.

### 0.17.1

- Turning cards back on shows them again. Everything is rebuilt by the pass that runs over the whole view, and that pass hung each card off the view itself rather than off its block, which put it out of sight. A card now finds its own block whichever way it is drawn.
- Pressing the passage on a card highlights it again. The highlight was registered under one name and the stylesheet was still looking for the old one, so the range was painted with nothing.

### 0.17.0

- **Requires Obsidian 1.6.6.** Removing a linknote uses `trashFile`, which arrived in that version; on anything older the note could not be sent to the trash after its marker had already been taken out.
- The settings screen is in the order the ideas arrive, grouped under five headings, and every change now shows at once. Turning cards on, switching the marker style, turning the rule beside annotated blocks on or off, and changing the body heading all used to wait for the note to be re-rendered. Turning cards off now takes them off the screen rather than leaving them until it is.
- Clearer settings: **Add a link marker** says that the cards, the sidebar list and Remove all find a linknote by it; **Add a block ID** says what it writes and that a heading never gets one; **Marker character**, **Body heading**, **Open the linknote after creating it** and the card settings say what they do to the note or the screen. Sliders show their value, so it can be read without dragging them. The card settings appear only when cards are on, and never on mobile, where cards are not drawn.
- Replacing the note template asks first when what is in the box is not one of the presets.
- Custom card colour is its own setting with a text field beside the swatch, instead of quietly switching the dropdown behind it.
- The passage on a card and the rows in the sidebar can be reached and used from the keyboard.
- Cleanup on unload is thorough: the highlight, the observers, the marks left on Obsidian's own elements, and every deferred pass. A pending pass no longer works on behalf of a plugin that has been disabled.
- Popped-out windows place their cards on their own animation frames, so a popout keeps working while the main window is hidden.
- A block that ends in trailing spaces gets its blank line after an own-line marker, as every other block already did.

### 0.16.0

- **Press the passage on a card and it is pointed at in the text.** The words the linknote was made from are highlighted where they sit, for a few seconds. Nothing is written to the note and nothing in the rendered page is changed — the range goes to the browser's highlight registry — so a passage that spans bold text or a link works too. Anchoring is unchanged: a linknote is still pinned to its block, and the recorded words only narrow down which part of it was selected. Where they are no longer there, nothing is highlighted and Linknote says so.
- The same from a sidebar row, after it jumps to the passage — and it highlights inside that linknote's own block, not the first paragraph that happens to hold the same words.

### 0.15.2

- The shading behind a passage is the theme's accent colour at low opacity. The `==highlight==` yellow was too loud for something that appears on every card.

### 0.15.1

- The passage a linknote is about is shaded and in quotation marks, on cards and on sidebar rows alike. It was set in the same face as the note itself, so on a card the two ran together and neither could be told from the other. The shading is the theme's accent colour at low opacity, so it follows whatever theme you use.

### 0.15.0

- **Cards and sidebar rows show the words the linknote is about.** Anchors are per block, so two linknotes on one paragraph looked identical; now each carries the passage it was made from. Read from a new `selection` property, and for linknotes written before it existed, from the quote the shipped templates keep the passage in — so older linknotes show it too.
- The shipped template records `type: Linknote` and `selection:`. Added `{{selectionYaml}}`. **Existing settings are untouched** — this changes what a fresh install starts with, and what the first preset loads.

### 0.14.8

- A marker on a heading is drawn up into the heading line more reliably. The move was attempted once, on the frame after the block was rendered; if the block was not yet in the document, nothing tried again and the marker stayed on its own line. It is now attempted per marker rather than per rendered block — so a later pass over the view can also do it — and retried a few times.

### 0.14.7

- One card per linknote in a view. Another plugin may render the same list item twice — the Tasks plugin does — and each copy carried its own marker, so one linknote ended up with two identical cards while the sidebar correctly showed one. The extra is now cleared once everything is on screen.

### 0.14.6

- A marker that goes on a line of its own now gets a blank line after it as well as before. A heading written straight above its list left the marker glued to the list, which made it part of that block: it could not be drawn up beside the heading, and it read as part of the list.
- One card per marker, whichever way the block is redrawn. A marker could end up with two identical cards while the sidebar correctly showed one.
- Cards are no longer drawn inside cards. A card's contents are rendered markdown too, and the pass that rebuilds cards was descending into them.

### 0.14.5

- **A block ID written on its own line is no longer destroyed.** Obsidian's own form for a table or a code block puts `^id` on the line below the block. Linknote did not recognise it, appended the marker after it and added a second ID — which silently broke every link pointing at that block. The marker now goes on the text and the existing ID stays where it is.
- **A blank line that is not empty separates blocks again.** A separator line holding a space or a tab, and any note saved with CRLF line endings, ran two paragraphs together, so the marker could land on the paragraph below the one selected.
- **A stale selection can no longer be anchored twice.** Saving a second linknote from a selection that had already been anchored wrote the marker into the middle of the line and stranded the first block ID. Blocks are now matched whole lines at a time, and the position is checked again at the moment of writing.
- Removing a linknote refuses when one line holds two links to it, and prefers the marker over a mention of the same note in your prose.
- A block ID referenced only from another linknote's properties is no longer stripped.
- Cards are drawn for linknotes only, so the delete button cannot reach a note this plugin does not own; and removal checks the folder again before anything is trashed.
- Settings read back from `data.json` are checked before use: a folder that would climb out of the vault is refused, and a value of the wrong type falls back to the default.
- Disabling the plugin now puts every open note back as it was — cards, gutters, classes and a marker moved up into a heading.
- Rendered card contents belong to a child of their own and are released when the card is redrawn, rather than accumulating until the plugin unloads.

### 0.14.4

- New shipped default template. The folded callout that holds the source now carries a link to the anchored block in its title, and the layout is tighter. **Existing settings are untouched** — this changes what a fresh install starts with, and what the first preset loads.

### 0.14.3

- Cards and sidebar rows are headed by the marker the linknote was written with, then the author and the date. Set two devices to different markers and it is obvious at a glance which wrote what.
- Added `{{marker}}`, so a template can record the marker in a property of its own.

### 0.14.2

- A new linknote no longer appears twice in the sidebar. Three workspace events and the metadata cache can all ask the list to redraw at once, and a redraw that emptied the list and then waited on a file read had its rows appended after the next redraw had already refilled it. The rows are now built away from the screen and put in place in one step.

### 0.14.1

- A linknote written on another device is recognised here. The marker character is a per-device setting, and a marker was matched by that character alone, so a note anchored with a different one got no card and no chip — though it did appear in the sidebar, which has always gone by the link's target. Both now agree: a short link into the linknote folder is a marker whatever character it wears.

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
