# Changelog

### 0.24.0

- **Show or hide every Linknote mark**, a command, and a setting of the same name beside it. The markers, the rules beside annotated passages, the cards and the gutter that held them, the line tracing a moved stack, the floating button — all out of sight, and the note reads exactly as it would with the plugin uninstalled. In print as well: a reader who turned the marks off and then exported would not expect them back.
- **Nothing is written to any note.** The markers and block IDs stay in the Markdown; this only decides whether they are drawn. Hiding an annotation must never be a way of losing one, so the two are kept apart — remove a linknote when you mean to remove it, hide the marks when you only mean not to see them.
- The **sidebar list and the ribbon icon stay**, so the linknotes remain reachable while the notes look untouched — which is the point of a reading state rather than an uninstall. The state is said out loud both ways, because a note with no marks is indistinguishable from a note nobody has annotated, and a reader who cannot tell which they are looking at cannot get back.

### 0.23.2

- **The printed card fills the margin it was given.** 0.23.1 reserved 36% of the page for the cards and then put a card in it barely half that wide, leaving a strip of blank paper down the right edge. The two numbers are percentages of different things — the gutter of the page, the card of the text column that is left over after it — and treating them as the same scale is what shrank the card. Stated against the right base, the card now reaches the margin.
- **A card is as wide as the width you set it.** `.lkn-card` sized its padding and border on top of its width instead of inside it, so every card has been 22px wider than the stack holding it since cards were introduced. On screen that only ate into the gap beside the text, which is why it survived twenty versions unnoticed; in print it pushed the card past the edge of the sheet, which is how it was found. Cards on screen are correspondingly 22px narrower now — that is the width in the setting, at last meaning what it says.

### 0.23.1

- **Cards keep the margin on paper.** 0.23.0 fixed the overlapping by putting every card under its block, which threw away the thing that makes a margin note a margin note. The offsets were the problem, not the margin: a stack now becomes a right float in a gutter reserved on the page, so it sits beside its passage as it does on screen. A float paginates, and `clear: right` is what keeps two stacks apart — the collision the on-screen code solves by measuring, solved here by the layout itself, which needs no numbers that a different page size would invalidate. The gutter is a share of the page rather than a pixel count, so it follows the paper and its margins instead of the pane the note happened to be read in.
- **Stowed cards are not printed.** Stowing them is the reader saying *not now*, and a strip carries nothing on paper. A note read with the cards stowed now exports as the document without them — which is also the quickest way to get a clean copy, without going near the settings.
- **Cards in an exported PDF** gains *Beside the block, as on screen*, and ships that way. *Under the block* remains for notes whose cards are long enough that a narrow column would run them far down the page from what they annotate.

### 0.23.0

- **Cards print properly.** Exporting a note to PDF piled the cards on top of one another, or pushed them off the sheet entirely. On screen a card is positioned in the margin beside its passage, at an offset that JavaScript works out by measuring the rendered page; a printed page is a different width and is cut into sheets, so every one of those measurements is wrong, and an absolutely positioned box does not paginate — it keeps its offset and lands wherever that falls. Printing now abandons the positioning rather than trying to correct it: each card falls into the flow directly under its own block, which is the shape a narrow pane has always used.
- **A card prints in full.** The six-line limit is a scrollbar on screen and would be a deletion on paper, so it is dropped for printing. A card is kept whole on one sheet where it fits and split across two where it does not — never truncated. The tick, stow and remove buttons are left out, as is the unread marking, which is this device's state and says nothing about the document. Cards left stowed print in full: stowing is a reading state, and on paper there is nothing to click to bring them back.
- **Cards in an exported PDF**, a new setting, prints them under the block (the default) or leaves them out for a clean copy of the document as written. Anything the setting has never been given — a vault saved before this version, an unrecognised value — prints them: a PDF that quietly lost the annotations is worse than one carrying more than you wanted, because only one of the two is visible in the result.

### 0.22.8

- **Mention everyone in the thread** — one switch that reaches your phone without a directory. The mentions added in 0.22.7 turned out to be unusable as posted: WeCom will only @ someone by the 帐号 (UserID) it issued, a string no note carries and nobody knows offhand, and it accepts a wrong one with a 200 and quietly omits the @ — so the failure looks exactly like success. `@all` needs nothing written down, and in the thread this feature is meant for there is only one person in it anyway. Off by default; the directory is what a shared group still uses, and is ignored while this is on.
- The directory now says what the right-hand side has to be: the 帐号 (UserID) as the chat service spells it, not a display name and not a phone number the company directory does not hold. It also says that a wrong one is accepted in silence, because that is the part that costs an afternoon.

### 0.22.7

- **Whoever wrote the annotated note is @-mentioned**, so the message reaches their phone rather than sitting in a channel. A new setting, **Who to @ in the message**, holds a small directory written as `Tsuneyama=tsuneyama, 潘寅=panyin`: the name a note signs itself with on the left, the chat account on the right. Nothing can work that out on its own — a vault knows people by what its notes call them, a chat service by an account — so a name that is not listed is simply not mentioned. A value of digits is taken for a phone number instead of an account.
- Messages are sent as **text** rather than markdown, because markdown carries no mentions and there was nothing here that markdown was rendering.

### 0.22.6

- **The chat message says whose notes were annotated, as well as by whom.** One line per pair — *Yamada → Tsuneyama's notes: 2* — which is what makes it possible to decide whether to look now or later. Both halves are people's names: still no note name and still none of the text, so nothing about what was said leaves the vault. A note signed by nobody is listed as *unsigned notes*. Long lists stop at eight lines and sum up the rest, because a message that scrolls is not read.

### 0.22.5

- **Which notes to be told about** — your own, or every note in the vault. Told about every note, the message answers *what is happening in the vault*; told about your own, it answers *has anyone replied to me*, and is much quieter. Both are reasonable to want, and they differ in volume more than in kind, so it is a setting rather than a decision. Your own linknotes are never announced either way, and neither is anyone annotating a note they wrote themselves.

### 0.22.3 / 0.22.4

- **Notes with no author at all count as yours**, under a new setting of that name. Most notes in most vaults carry no author property — in one vault of two and a half thousand notes, nine in ten of them — so without this the chat message would only ever fire on the few that are signed. It ships on for that reason, and can be turned off in a vault several people write into, where an unsigned note is as likely to be theirs as yours. Your own annotations on such a note are still not announced to you.
- **Your names in note properties** is plural, and always was: give as many names as you answer to, separated by commas. The wording said "name", which read as though only one was allowed.

### 0.22.2

- **A name the note itself lists is one of its authors, whichever device it came from.** A chat message is now skipped when the linknote's author appears among the source note's own authors — that is an author annotating their own note, not news. Until now the linknote was compared only against the Author of *this* device, which is per device by design, so a note signed `Tsuneyama, Tsune` annotated under the name `Tsuneyama` was announced back to the person who wrote both. A note declares who it belongs to; that declaration is now what decides.
- One consequence worth knowing: on a note you wrote **with** someone, that person's annotations are no longer announced, because they are one of its authors. A fourth person annotating the same note still is.

### 0.22.1

- **The chat switch no longer lies.** Switching it on before pasting the webhook address recorded it as off — the switch and the address were folded into one flag — and pasting the address afterwards did not put it back. The result was a switch that looked on, a test button that worked, and nothing ever sent. Asking for it and being able to do it are now two separate things, and the settings screen says plainly which state it is in: *Ready*, *Switched on, but nothing will be sent: there is no webhook address yet*, or *Switched off*.

### 0.22.0

- **A chat notification, for when Obsidian is not what you are looking at.** When someone else annotates a note *you* wrote, one line can be posted to a chat channel: a WeCom (企业微信) group robot address, or anything else accepting the same JSON. Both halves of the condition are judged by the author property — the linknote's author is not you, and the source note's author is — so **Author** has to be set on every device for it to work at all.
- **Whose note it is, and who wrote the linknote, are two questions with two answers.** A new setting, **Your name in note properties**, says how a note of yours signs itself. The Author above it is per device on purpose — so that a linknote written on a phone can be told from one written at a desk — while your notes name you once, as a person, and often not by the same word. Judged by the one setting, a note signed `Tsuneyama` was never recognised as belonging to `Tsune`, and the message it should have raised silently never went. Several names can be given, separated by commas; a note naming you among others counts as yours. Left empty, the Author is used.
- **The message carries a count and the authors. Nothing else.** No note name, no passage, no text. What gets annotated is often the part of a vault that should least leave it, and a title alone can carry that; the line says enough to make you open Obsidian, which is where the content stays.
- **The address is kept on the device, not in the vault.** A shared vault is exactly the case this feature is for, and Obsidian can be told to sync plugin settings — so an address in `data.json` would become everyone's, and three people would post their news into one person's channel. It goes where the read marks go: this device's local storage, per vault. Each person sets their own; a second machine needs it typing again, which for a per-person destination is the right way round.
- Off by default, with no address until you give it one, and **HTTPS only** — a webhook address is itself a secret, and over plain HTTP it would travel in clear. Switching it on without an address does nothing, so it does not switch on. Desktop only: a phone does not keep a plugin running in the background, and the chat app is already on it.
- A **Send a test message** button in settings, so the address can be proved before it is relied on. A failure to send is always said out loud: a notification that quietly stops arriving is worse than none, because it is trusted.
- The README no longer says the plugin sends nothing anywhere, because with this turned on it is not true. It says what is sent, and what never is.

### 0.21.2

- **Acknowledging a linknote in one place clears it everywhere.** The tick in the sidebar marked the linknote read and brought the count down, but the card in the note went on wearing its accent and its own tick, because each tick only tidied the thing it sat on. Both now clear every card of that linknote, in every open pane — as does opening the linknote as a note, and **Mark all read**.

### 0.21.1

- **The sidebar list can show only what is unread.** *Unread only* joins the orders, and narrows the list to the linknotes still waiting — in this note, or across the vault, depending on the scope. What is left is ordered newest first. It sits among the orders because that is where you look to change what the list shows, and one control is easier to find than two. When nothing is waiting the list says so, rather than looking like a search that found nothing.

### 0.21.0

- **A linknote is read when you say it has been read.** Until now a card drawing itself on screen was enough, which counted a linknote as taken in whether or not anyone had looked at it — and a count that clears itself by scrolling counts nothing. An unread linknote now stays unread until its card's tick is pressed, until the tick on its sidebar row is pressed, or until the linknote itself is opened as a note. The old behaviour is still available: **Count a linknote as read → When it is shown**.
- **An unread card is marked as unread.** It carries the accent colour down its edge and a tick in its header; both go the moment it is read, and the ribbon count comes down in the same breath rather than on the next pass.
- **The unread count is harder to miss.** The badge on the ribbon is larger and stands clear of the icon, the icon itself takes the accent colour while anything is waiting, and on desktop the count also sits along the bottom of the window — where nothing overlaps it and it does not depend on which pane is in front. Clicking either opens the inbox.
- New setting: **Count a linknote as read** (*When you say so* / *When it is shown*).

### 0.20.2

- **The ribbon icon carries the unread count.** A notice is gone in seconds and only reaches whoever happened to be looking; the count stays until the linknotes behind it have been read. Clicking it opens the inbox when something is waiting. Notices now stand for twenty seconds rather than eight, and say that clicking opens the inbox.
- **A row in the inbox is headed by the marker of whoever wrote it, once the unread dot has gone.** One slot, never both: while a linknote is unread the dot is what matters, and after that the character says whose it is, the way a card is headed. The character is read from the marker left in the source note — the same place a card reads it — so it works for every linknote already written, with no change to the template.
- **The search box is usable again.** Four controls on one line squeezed it to a couple of characters in a sidebar of ordinary width. The scope and the order share the top row; the search box and **Mark all read** have the second to themselves.
- **The whole-vault list is named Linknote inbox**, so what it is does not have to be inferred from the scope dropdown.
- **Editing someone else's linknote yourself no longer announces it to you.** Typing into a linknote goes through Obsidian's own save rather than this plugin's writes, so the edit came back as news — under the other person's name, since the name shown is the author of the note, not whoever last touched it. A linknote open in front of you on this device is now taken as yours to change. A change arriving over sync for the note on screen is missed this way, but it is the one change already in plain sight.

### 0.20.1

- **A card that fell inline comes back to the margin when the pane is made wide again.** Margin or inline was decided when something remembered to ask, and a window resize was the only thing that asked — so widening the pane any other way (collapsing a sidebar, closing a split, changing the zoom or the readable line width) left the cards in the text however much room they had been given. Each pane is now watched for its own size, so the question is asked again whenever the answer could have changed.
- **A card whose pane could not be measured no longer stays inline for good.** The measurement is retried for a handful of frames and then, if the view is still being drawn, once more a moment later — rather than silently keeping whatever placement was last decided. Once per stall, so a card that never attaches cannot ask forever.
- The sidebar list is redrawn once per burst rather than once per cause. Reading a linknote is announced from wherever it was shown, painting a card included, and a redraw begun in the middle of a card pass renders markdown — which set the card machinery going again while it was still measuring.

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
