/*
 * Unit tests for the pure helpers in main.js.
 * Run with:  node test.js      (no dependencies)
 */

// main.js requires 'obsidian', which only exists inside the app. Point that
// specifier at a local stub so the module can be loaded in plain Node.
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'obsidian') return require.resolve('./test/obsidian-stub.js');
  return resolve.call(this, request, ...rest);
};

const m = require('./main.js');
const {
  buildAnchoredBlock,
  existingBlockId,
  headingTextOf,
  sanitizeFileName,
  clampChars,
  clampBytes,
  previewFilename,
  formatDate,
  narrowToListItem,
  normalizeInline,
  looseKey,
  findBlockContaining,
  renderTemplate,
  tidy,
  DEFAULT_NOTE_TEMPLATE,
  TEMPLATE_PRESETS,
} = m;

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name);
  } else {
    fail++;
    console.log('  NG  ' + name + (detail ? '\n' + detail : ''));
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, '    actual  : ' + JSON.stringify(actual) + '\n    expected: ' + JSON.stringify(expected));
}

const LINK = '[[My linknote|†]]';

console.log('\nanchoring — paragraphs');
eq('plain paragraph', buildAnchoredBlock('A sentence.', LINK, 'ab12cd'), 'A sentence. ' + LINK + ' ^ab12cd');
eq('multi-line paragraph anchors the last line', buildAnchoredBlock('one\ntwo', LINK, 'ab12cd'), 'one\ntwo ' + LINK + ' ^ab12cd');
eq('trailing whitespace is normalised', buildAnchoredBlock('A sentence.   ', LINK, 'ab12cd'), 'A sentence. ' + LINK + ' ^ab12cd');

console.log('\nanchoring — existing block IDs');
eq('reads an existing ID', existingBlockId('A sentence. ^zzz999'), 'zzz999');
eq('null when there is none', existingBlockId('A sentence.'), null);
eq('an existing ID survives and stays last', buildAnchoredBlock('A sentence. ^zzz999', LINK, ''), 'A sentence. ' + LINK + ' ^zzz999');
eq('an existing ID is not duplicated when one is supplied', buildAnchoredBlock('A sentence. ^zzz999', LINK, 'zzz999'), 'A sentence. ' + LINK + ' ^zzz999');
eq('nothing to add leaves an ID-bearing line untouched', buildAnchoredBlock('A sentence. ^zzz999', '', ''), 'A sentence. ^zzz999');

console.log('\nheadings are referenced by their anchor');
eq('plain heading', headingTextOf('## Background'), 'Background');
eq('deeper heading', headingTextOf('#### 2.1 準備'), '2.1 準備');
eq('a trailing block ID is dropped', headingTextOf('## Background ^abc123'), 'Background');
eq('not a heading', headingTextOf('A paragraph.'), '');
eq('a hash inside text is not a heading', headingTextOf('see #tag here'), '');
eq('a heading with inline code', headingTextOf('## Use `getSectionInfo()`'), 'Use `getSectionInfo()`');
eq('leading blank lines are skipped', headingTextOf('\n## Later'), 'Later');

console.log('\nanchoring — lists');
eq('list item', buildAnchoredBlock('- an item', LINK, 'ab12cd'), '- an item ' + LINK + ' ^ab12cd');
eq('nested list item', buildAnchoredBlock('  - a child', LINK, 'ab12cd'), '  - a child ' + LINK + ' ^ab12cd');

console.log('\nanchoring — blocks that need their own line');
eq('heading', buildAnchoredBlock('## Background', LINK, 'ab12cd'), '## Background\n\n' + LINK + ' ^ab12cd');
eq('table', buildAnchoredBlock('| A | B |\n| --- | --- |\n| 1 | 2 |', LINK, 'ab12cd'), '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n' + LINK + ' ^ab12cd');
eq('fenced code', buildAnchoredBlock('```js\nconst a = 1;\n```', LINK, 'ab12cd'), '```js\nconst a = 1;\n```\n\n' + LINK + ' ^ab12cd');
eq('math block', buildAnchoredBlock('$$\na = b\n$$', LINK, 'ab12cd'), '$$\na = b\n$$\n\n' + LINK + ' ^ab12cd');

console.log('\nanchoring — callouts');
eq('callout anchors its last line', buildAnchoredBlock('> [!note] Heads up\n> Body text.', LINK, 'ab12cd'), '> [!note] Heads up\n> Body text. ' + LINK + ' ^ab12cd');

console.log('\nanchoring — options');
eq('block ID only', buildAnchoredBlock('A sentence.', '', 'ab12cd'), 'A sentence. ^ab12cd');
eq('link only', buildAnchoredBlock('A sentence.', LINK, ''), 'A sentence. ' + LINK);
eq('neither leaves the block untouched', buildAnchoredBlock('A sentence.', '', ''), 'A sentence.');

console.log('\nnarrowing a list block to the selected item');
const LIST = '- first item\n- second item\n- third item';
eq('picks the selected bullet', narrowToListItem(LIST, 'second item'), '- second item');
eq('picks the first', narrowToListItem(LIST, 'first item'), '- first item');
eq('picks the last', narrowToListItem(LIST, 'third item'), '- third item');
const TASKS = '- [ ] wire up the button\n- [x] read the settings\n- [ ] ship it';
eq('picks the selected task', narrowToListItem(TASKS, 'read the settings'), '- [x] read the settings');
eq('a numbered item', narrowToListItem('1. alpha\n2. beta', 'beta'), '2. beta');
eq('a nested item', narrowToListItem('- parent\n  - child one\n  - child two', 'child two'), '  - child two');
eq('ambiguous selection leaves the block alone', narrowToListItem('- same\n- same', 'same'), '- same\n- same');
eq('no match leaves the block alone', narrowToListItem(LIST, 'nowhere'), LIST);
eq('a single-line block is untouched', narrowToListItem('- only one', 'only one'), '- only one');
eq('a paragraph is untouched', narrowToListItem('line one\nline two', 'line two'), 'line one\nline two');

console.log('\nnormalising inline markup before matching');
eq('inline code', normalizeInline('`Annotations/` に `補足.md` が作られる'), 'Annotations/ に 補足.md が作られる');
eq('bold and italics', normalizeInline('**bold** and ~~struck~~ and ==marked=='), 'bold and struck and marked');
eq('wikilink with alias', normalizeInline('see [[Some Note|the note]] please'), 'see the note please');
eq('plain wikilink', normalizeInline('see [[Some Note]] please'), 'see Some Note please');
eq('markdown link', normalizeInline('see [the docs](https://example.com) please'), 'see the docs please');
eq('embed is dropped', normalizeInline('![[Some Note#^abc123]] tail'), 'tail');
eq('task marker is dropped', normalizeInline('- [ ] do the thing'), 'do the thing');
eq('checked task marker is dropped', normalizeInline('- [x] done already'), 'done already');
eq('bullet marker is dropped', normalizeInline('- a bullet'), 'a bullet');
eq('numbered marker is dropped', normalizeInline('2. second'), 'second');

console.log('\nthe line that failed in the field');
{
  const line = '- [ ] `Annotations/` に `補足 …… 2026-08-12-Wednesday.md` が作られる';
  const rendered = 'Annotations/ に 補足 …… 2026-08-12-Wednesday.md が作られる';
  const block = '- [ ] 段落をドラッグで選ぶと、選択の下に「† Linknote」が出る\n' + line + '\n- [ ] `Esc` で小窓を閉じると、何も作られない';
  eq('the code-span line is now matched', narrowToListItem(block, rendered), line);
}

console.log('\nloose matching, for when rendering differs beyond markup');
eq('punctuation and spaces fall away', looseKey('a, b — c!'), 'abc');
eq('a heading link keeps only its words', looseKey('see [[#4.1 Existing IDs]] again'), 'see41ExistingIDsagain');
{
  // Obsidian may or may not show the leading # of a same-note heading link.
  const line = '- [x] **Existing block IDs** → kept（[[#4.1 The loss of block IDs]] recheck） ✅ 2026-08-13';
  const withHash = 'Existing block IDs → kept（#4.1 The loss of block IDs recheck） ✅ 2026-08-13';
  const without = 'Existing block IDs → kept（4.1 The loss of block IDs recheck） ✅ 2026-08-13';
  eq('normalised matching handles the # form', m.listItemMatches(line, withHash).length, 1);
  eq('loose matching rescues the other form', m.listItemMatches(line, without).length, 1);
}
{
  // Loose matching must not start guessing between similar items.
  const block = '- [ ] alpha beta\n- [ ] alpha beta gamma';
  eq('an ambiguous loose match returns both', m.listItemMatches(block, 'alpha beta').length, 2);
  eq('so the block is left alone', narrowToListItem(block, 'alpha beta'), block);
}

console.log('\nlocating a block by its text');
{
  const doc = '# Title\n\nAlpha paragraph.\n\nBeta paragraph.\n';
  eq('unique match returns the containing block', findBlockContaining(doc, 'Beta'), 'Beta paragraph.');
  eq('missing text returns empty', findBlockContaining(doc, 'Gamma'), '');
  eq('duplicate text returns empty', findBlockContaining('Same.\n\nSame.\n', 'Same.'), '');
  const marked = '# Title\n\nA **bold** claim here.\n\nSomething else.\n';
  eq('falls back to a normalised line match', findBlockContaining(marked, 'A bold claim here.'), 'A **bold** claim here.');
  const listDoc = '- [ ] first `thing`\n- [ ] second `thing`\n';
  eq('a matched list line is returned on its own', findBlockContaining(listDoc, 'second thing'), '- [ ] second `thing`');
}

console.log('\nfile names');
eq('illegal characters are dropped', sanitizeFileName('A/B:C*D?E"F<G>H|I#J^K[L]M'), 'ABCDEFGHIJKLM');
eq('whitespace is collapsed', sanitizeFileName('a  b\nc'), 'a b c');
eq('leading and trailing dots and spaces go', sanitizeFileName('  ..name..  '), 'name');
eq('long names are not truncated here', sanitizeFileName('x'.repeat(200)).length, 200);

console.log('\nlength limits');
eq('short text is untouched', clampChars('abc', 10), 'abc');
eq('cuts on a word boundary', clampChars('alpha beta gamma delta', 16), 'alpha beta gamma');
eq('cuts mid-word when a boundary would lose too much', clampChars('supercalifragilistic', 10), 'supercalif');
eq('Japanese is cut by character', clampChars('あいうえおかきくけこ', 5), 'あいうえお');
eq('bytes: ASCII', clampBytes('abcdef', 4), 'abcd');
eq('bytes: Japanese runs three bytes each', clampBytes('あいうえお', 9), 'あいう');
eq('bytes: nothing fits', clampBytes('あ', 2), '');

console.log('\nthe filename that was truncated in the field');
{
  // No title typed, so the whole selected sentence becomes the title.
  const selection = '設定が空の既定値になっていたら、data.json が読まれていません。その場合は報告してください。';
  const template = '補足 {{title}} {{date}}';
  const date = '2026-08-12-Wednesday';
  // Old behaviour cut the assembled name at 60 characters, landing inside the date.
  const oldWay = ('補足 ' + selection + ' ' + date).slice(0, 60);
  check('the old way lost the date', oldWay.endsWith('2026-0'), '    got: ' + oldWay);
  // New behaviour clamps the title first.
  const newWay = renderTemplate(template, { title: clampChars(sanitizeFileName(selection), 50), date });
  check('the date now survives', newWay.endsWith(date), '    got: ' + newWay);
  eq('nothing is lost from the assembled name', newWay, '補足 ' + selection + ' ' + date);
  // A longer selection does get shortened, but only in the title part.
  const longer = selection + 'さらに続く文章がここに入ります。';
  const clamped = renderTemplate(template, { title: clampChars(sanitizeFileName(longer), 50), date });
  check('an over-long title is trimmed, the date is not', clamped.endsWith(date) && clamped.length < ('補足 ' + longer + ' ' + date).length, '    got: ' + clamped);
}

console.log('\ndate formatting');
const D = new Date(2026, 7, 12, 9, 5, 3); // 2026-08-12 Wednesday 09:05:03
eq('YYYY-MM-DD', formatDate(D, 'YYYY-MM-DD'), '2026-08-12');
eq('YYYY-MM-DD-dddd', formatDate(D, 'YYYY-MM-DD-dddd'), '2026-08-12-Wednesday');
eq('long month is not eaten by MM', formatDate(D, 'MMMM DD, YYYY'), 'August 12, 2026');
eq('short forms', formatDate(D, 'ddd MMM YY'), 'Wed Aug 26');
eq('time', formatDate(D, 'HH:mm:ss'), '09:05:03');

console.log('\ntemplate rendering');
eq('substitutes', renderTemplate('a {{x}} b', { x: '1' }), 'a 1 b');
eq('tolerates spaces in the braces', renderTemplate('{{ x }}', { x: '1' }), '1');
eq('unknown variables are left alone', renderTemplate('{{nope}}', { x: '1' }), '{{nope}}');
eq('repeats', renderTemplate('{{x}}{{x}}', { x: 'ab' }), 'abab');
eq('empty value', renderTemplate('[{{x}}]', { x: '' }), '[]');

console.log('\nblank-run tidying');
eq('collapses runs left by empty variables', tidy('a\n\n\n\n\nb'), 'a\n\nb\n');
eq('drops trailing spaces before newlines', tidy('a   \nb'), 'a\nb\n');
eq('trims and ends with a single newline', tidy('\n\n  a  \n\n\n'), 'a\n');

console.log('\na note as a YAML property value');
eq('empty stays empty, not "|-"', m.toYamlBlock(''), '');
eq('whitespace only stays empty', m.toYamlBlock('   \n  '), '');
eq('one line becomes a block scalar', m.toYamlBlock('just this'), '|-\n  just this');
eq('several lines keep their breaks', m.toYamlBlock('one\ntwo'), '|-\n  one\n  two');
// Written flat, either of these would make the frontmatter invalid.
eq('a colon is safe inside a block scalar', m.toYamlBlock('note: see this'), '|-\n  note: see this');
eq('a hash is safe too', m.toYamlBlock('see #tag'), '|-\n  see #tag');
eq('the indent can be set', m.toYamlBlock('one', '    '), '|-\n    one');
{
  const rendered = tidy(renderTemplate('body: {{bodyYaml}}\nnext: 1\n', { bodyYaml: m.toYamlBlock('one\ntwo') }));
  eq('it drops into a template as valid YAML', rendered, 'body: |-\n  one\n  two\nnext: 1\n');
}

console.log('\ntaking a linknote back out — reading a link');
eq('an alias is dropped', m.normaliseLinkTarget('Linknotes/Foo|†'), 'Linknotes/Foo');
eq('a subpath is dropped', m.normaliseLinkTarget('Foo#^abc123'), 'Foo');
eq('an extension is dropped', m.normaliseLinkTarget('Linknotes/Foo.md'), 'Linknotes/Foo');
eq('percent escapes are decoded', m.normaliseLinkTarget('Linknotes/Foo%20Bar.md'), 'Linknotes/Foo Bar');
eq('the names of a note', m.linkNamesFor('Linknotes/Foo.md').join('|'), 'Linknotes/Foo|Foo');

console.log('\ntaking a linknote back out — one line');
const NAMES = m.linkNamesFor('Linknotes/Note_abc123.md');
{
  const r = m.removeLinkFromLine('A sentence. [[Note_abc123|†]] ^abc123', NAMES);
  eq('the marker and its space go', r.line, 'A sentence. ^abc123');
  check('and it says so', r.removed);
}
eq('a full path is matched too',
  m.removeLinkFromLine('A sentence. [[Linknotes/Note_abc123|†]]', NAMES).line, 'A sentence.');
eq('a markdown link is matched',
  m.removeLinkFromLine('A sentence. [†](Linknotes/Note_abc123.md)', NAMES).line, 'A sentence.');
eq('an escaped markdown link is matched',
  m.removeLinkFromLine('A sentence. [†](Linknotes/Note_abc123.md)', m.linkNamesFor('Linknotes/Note_abc123.md')).line,
  'A sentence.');
{
  // A link to something else must not be touched.
  const r = m.removeLinkFromLine('See [[Another note]] here.', NAMES);
  eq('an unrelated link is left alone', r.line, 'See [[Another note]] here.');
  check('and nothing is reported', !r.removed);
}
eq('only the first match goes',
  m.removeLinkFromLine('[[Note_abc123|†]] and [[Note_abc123|†]]', NAMES).line, ' and [[Note_abc123|†]]');
eq('the block ID is read back', m.blockIdOfLine('A sentence. ^abc123'), 'abc123');
eq('no block ID, no answer', m.blockIdOfLine('A sentence.'), '');

console.log('\ntaking a linknote back out — the whole note');
{
  const doc = '# Doc\n\nA sentence. [[Note_abc123|†]] ^abc123\n\nAnother.\n';
  const r = m.removeAnchor(doc, NAMES, false);
  check('it succeeds', r.ok);
  eq('the block ID is reported', r.blockId, 'abc123');
  eq('the marker goes and the ID stays', r.content, '# Doc\n\nA sentence. ^abc123\n\nAnother.\n');
}
{
  const doc = '# Doc\n\nA sentence. [[Note_abc123|†]] ^abc123\n\nAnother.\n';
  eq('the ID goes when asked', m.removeAnchor(doc, NAMES, true).content,
    '# Doc\n\nA sentence.\n\nAnother.\n');
}
{
  // A heading takes the marker on a line of its own; the line goes with it.
  const doc = '# Doc\n\n## Background\n\n[[Note_abc123|†]]\n\nSome text.\n';
  const r = m.removeAnchor(doc, NAMES, false);
  check('it succeeds', r.ok);
  eq('the line goes, and one of its blank lines', r.content, '# Doc\n\n## Background\n\nSome text.\n');
}
{
  const doc = '# Doc\n\nA sentence.\n';
  const r = m.removeAnchor(doc, NAMES, false);
  check('a marker that is not there is refused', !r.ok);
  eq('and says why', r.reason, 'not-found');
  eq('leaving the note alone', r.content, null);
}
{
  const doc = 'One. [[Note_abc123|†]]\n\nTwo. [[Note_abc123|†]]\n';
  const r = m.removeAnchor(doc, NAMES, false);
  check('two markers to the same note are refused', !r.ok);
  eq('and says why', r.reason, 'ambiguous');
  eq('leaving the note alone', r.content, null);
}
{
  // The rest of the line must survive intact, markup and all.
  const doc = '- [ ] **bold** and `code` [[Note_abc123|†]] ^abc123\n';
  eq('the passage is untouched', m.removeAnchor(doc, NAMES, true).content,
    '- [ ] **bold** and `code`\n');
}

console.log('\nfinding the section a linknote calls its body');
{
  const note = [
    '---', 'body: old', '---', '',
    '> [!NOTE]- Quoted', '> the passage', '',
    '## Linknote', '',
    '- [ ] a task', 'and a line', '',
    '## Elsewhere', '', 'not this',
  ].join('\n');
  eq('the section under the heading is returned',
    m.sectionUnderHeading(note, 'Linknote'), '- [ ] a task\nand a line');
  eq('it stops at the next heading of the same level',
    m.sectionUnderHeading(note, 'Linknote').includes('not this'), false);
  eq('a heading that is not there gives nothing', m.sectionUnderHeading(note, 'Missing'), '');
  eq('an empty heading name gives nothing', m.sectionUnderHeading(note, ''), '');
}
{
  const note = '## Linknote\n\nkeep\n\n### Deeper\n\nalso keep\n\n# Top\n\nstop';
  eq('a deeper heading stays inside the section',
    m.sectionUnderHeading(note, 'Linknote'), 'keep\n\n### Deeper\n\nalso keep');
}
{
  // A # inside a fenced block is not a heading.
  const note = '## Linknote\n\n```bash\n# not a heading\n## nor this\n```\n\ntail\n\n## Next\n\nno';
  eq('fenced code is skipped',
    m.sectionUnderHeading(note, 'Linknote'), '```bash\n# not a heading\n## nor this\n```\n\ntail');
}
eq('a trailing block ID on the heading is ignored',
  m.sectionUnderHeading('## Linknote ^abc123\n\nthe note', 'Linknote'), 'the note');
eq('the last section runs to the end',
  m.sectionUnderHeading('## Linknote\n\nthe note', 'Linknote'), 'the note');
eq('an empty section is empty', m.sectionUnderHeading('## Linknote\n\n## Next\n\nx', 'Linknote'), '');

console.log('\nreading a note back without its frontmatter');
eq('frontmatter is removed', m.stripFrontmatter('---\na: 1\n---\n\nThe note.\n'), 'The note.');
eq('a note without frontmatter is returned whole', m.stripFrontmatter('The note.\n'), 'The note.');
eq('a stray --- inside the body survives', m.stripFrontmatter('---\na: 1\n---\n\nOne\n\n---\n\nTwo\n'), 'One\n\n---\n\nTwo');
eq('an unterminated block is left alone', m.stripFrontmatter('---\nnot closed\n'), '---\nnot closed');
eq('empty in, empty out', m.stripFrontmatter(''), '');

console.log('\nturning the line under the caret into a task');
{
  const r = m.toggleTaskLine('write it up', 5);
  eq('a plain line gains a task marker', r.text, '- [ ] write it up');
  eq('the caret follows the text', r.cursor, 11);
}
eq('the marker comes off again', m.toggleTaskLine('- [ ] write it up', 8).text, 'write it up');
eq('a checked marker comes off too', m.toggleTaskLine('- [x] done', 8).text, 'done');
eq('a bullet becomes a task', m.toggleTaskLine('- an item', 4).text, '- [ ] an item');
eq('indentation is kept', m.toggleTaskLine('  nested', 4).text, '  - [ ] nested');
{
  const text = 'first\nsecond\nthird';
  eq('only the line under the caret changes',
    m.toggleTaskLine(text, 8).text, 'first\n- [ ] second\nthird');
}

console.log('\nthe tag being typed at the caret');
eq('nothing outside a tag', m.tagQueryAt('plain text', 5), null);
{
  const r = m.tagQueryAt('see #pro', 8);
  eq('the query is what follows the hash', r.query, 'pro');
  eq('the range starts at the hash', r.start, 4);
  eq('and ends at the caret', r.end, 8);
}
eq('a bare hash gives an empty query', m.tagQueryAt('see #', 5).query, '');
eq('a hash at the start of the note counts', m.tagQueryAt('#pro', 4).query, 'pro');
eq('a hash mid-word is not a tag', m.tagQueryAt('a#b', 3), null);
eq('the caret must be inside the tag', m.tagQueryAt('#one two', 8), null);
{
  const r = m.applyTagPick('see #pro', m.tagQueryAt('see #pro', 8), 'project/alpha');
  eq('the picked tag replaces what was typed', r.text, 'see #project/alpha ');
  eq('the caret lands after it', r.cursor, 19);
}
eq('a leading hash on the pick is not doubled',
  m.applyTagPick('see #pro', m.tagQueryAt('see #pro', 8), '#project').text, 'see #project ');

console.log('\ncollecting the vault tags');
eq('inline and property tags are merged and sorted',
  m.collectTags([
    { tags: [{ tag: '#beta' }, { tag: '#alpha' }] },
    { frontmatter: { tags: ['gamma', '#alpha'] } },
    null,
    {},
  ]).join(','), 'alpha,beta,gamma');
eq('a string property is split', m.collectTags([{ frontmatter: { tags: 'one two' } }]).join(','), 'one,two');
eq('nothing in, nothing out', m.collectTags([]).length, 0);

console.log('\nfiltering the tag list');
const TAGS = ['alpha', 'alphabet', 'beta', 'project/alpha'];
eq('an empty query offers everything', m.filterTags(TAGS, '').length, 4);
eq('prefix matches come first', m.filterTags(TAGS, 'alpha').join(','), 'alpha,alphabet,project/alpha');
eq('matching ignores case', m.filterTags(TAGS, 'ALPHAB').join(','), 'alphabet');
eq('the list is capped', m.filterTags(TAGS, '', 2).length, 2);
eq('no match, no rows', m.filterTags(TAGS, 'zzz').length, 0);

console.log('\nshortening a title for a heading');
eq('short titles are untouched', m.shortenTitle('Close date'), 'Close date');
eq('whitespace is collapsed first', m.shortenTitle('Close   date\n again'), 'Close date again');
eq('a long English title is cut on a word boundary',
  m.shortenTitle('The quarterly close lands on the tenth business day'),
  'The quarterly close lands on…');
eq('Japanese is cut by character, not by byte',
  m.shortenTitle('段階 1 リリース前の点検について確認したことのまとめと今後の段取り'),
  '段階 1 リリース前の点検について確認したことのまとめと今後…');
eq('exactly at the limit keeps every character', m.shortenTitle('123456789012345678901234567890'), '123456789012345678901234567890');
eq('one over the limit gains an ellipsis', m.shortenTitle('1234567890123456789012345678901'), '123456789012345678901234567890…');
eq('the limit can be overridden', m.shortenTitle('abcdefghij', 5), 'abcde…');

console.log('\ntidying what a filename template leaves behind');
eq('an empty variable leaves no trailing separator', m.tidyFileName('Team handbook_'), 'Team handbook');
eq('nor a leading one', m.tidyFileName('_2026-08-12'), '2026-08-12');
eq('a run in the middle collapses', m.tidyFileName('Team handbook__k3n8v1'), 'Team handbook_k3n8v1');
eq('mixed separators collapse too', m.tidyFileName('Team handbook_-_k3n8v1'), 'Team handbook_k3n8v1');
eq('a date keeps its hyphens', m.tidyFileName('Close date_2026-08-12'), 'Close date_2026-08-12');
eq('everything empty leaves nothing', m.tidyFileName('_'), '');

console.log('\nthe shipped default template');
{
  const vars = {
    date: '2026-08-12', time: '09:05',
    sourceBlock: '[[Team handbook#^k3n8v1]]',
    author: 'A. Reader',
    bodyYaml: m.toYamlBlock('Confirmed with Finance.\nTwice.'),
    summary: 'Team handbook — the tenth business day',
    selectionQuote: '> the tenth business day',
    titleShort: 'Close is the tenth business day',
    body: 'Confirmed with Finance.\nTwice.',
  };
  eq(
    'renders frontmatter, the folded source and the note',
    tidy(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars)),
    '---\ncreated: 2026-08-12 09:05\nsource: "[[Team handbook#^k3n8v1]]"\nauthor: A. Reader\n' +
      'body: |-\n  Confirmed with Finance.\n  Twice.\n---\n\n' +
      '> [!NOTE]- Close is the tenth business day\n> the tenth business day\n\n' +
      '## Linknote\n\nConfirmed with Finance.\nTwice.\n'
  );
}

console.log('\nthe shipped default with an empty note and no author');
{
  const vars = {
    date: '2026-08-12', time: '09:05',
    sourceBlock: '[[Team handbook]]',
    author: '',
    bodyYaml: '',
    summary: 'Team handbook — the tenth business day',
    selectionQuote: '> the tenth business day',
    titleShort: 'Close date',
    body: '',
  };
  const out = tidy(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars));
  // Empty properties are valid YAML nulls; what matters is that nothing dangles.
  check('the empty properties are left as nulls', out.includes('\nauthor:\nbody:\n'), '    out: ' + out);
  check('the frontmatter still closes', out.split('---\n').length >= 3, '    out: ' + out);
  check('no unresolved variable', !/\{\{[a-z]/i.test(out), '    out: ' + out);
}

console.log('\nreplacing the block inside the whole note');
{
  const doc = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
  const blockSrc = 'Second paragraph.';
  const anchored = buildAnchoredBlock(blockSrc, LINK, 'ab12cd');
  const at = doc.indexOf(blockSrc);
  const out = doc.slice(0, at) + anchored + doc.slice(at + blockSrc.length);
  eq('splice result', out, '# Title\n\nFirst paragraph.\n\nSecond paragraph. ' + LINK + ' ^ab12cd\n');
}

console.log('\ntemplate presets');
{
  const vars = {
    date: '2026-08-12', time: '09:05', source: '[[Team handbook]]', sourceName: 'Team handbook',
    sourcePath: 'Team handbook.md', sourceBlock: '[[Team handbook#^k3n8v1]]', title: 'Close date', body: 'Confirmed.', selection: 'the tenth business day',
    selectionQuote: '> the tenth business day', embed: '![[Team handbook#^k3n8v1]]', blockId: 'k3n8v1',
    author: 'A. Reader', summary: 'Team handbook — the tenth business day',
    titleShort: 'Close date', bodyQuote: '> Confirmed.', bodyYaml: '|-\n  Confirmed.',
  };
  eq('five presets ship', TEMPLATE_PRESETS.length, 5);
  for (const preset of TEMPLATE_PRESETS) {
    const embedAt = preset.template.indexOf('{{embed}}');
    if (embedAt === -1) continue;   // the callout preset carries no embed
    const bodyAt = preset.template.indexOf('{{body}}');
    check('"' + preset.name + '" puts the note before the source embed',
      bodyAt !== -1 && bodyAt < embedAt,
      '    body at ' + bodyAt + ', embed at ' + embedAt);
  }
  eq('the first preset is the shipped default', TEMPLATE_PRESETS[0].template, DEFAULT_NOTE_TEMPLATE);
  for (const preset of TEMPLATE_PRESETS) {
    const out = tidy(renderTemplate(preset.template, vars));
    check('no variable is left unresolved in "' + preset.name + '"', !/\{\{[a-z]/i.test(out), '    out: ' + out);
    check('"' + preset.name + '" opens with frontmatter', out.startsWith('---\n'));
    check('"' + preset.name + '" carries the body', out.includes('Confirmed.'));
    check('"' + preset.name + '" points the source property at the anchored spot',
      out.includes('source: "[[Team handbook#^k3n8v1]]"'), '    out: ' + out);
    check('"' + preset.name + '" is free of CJK', !/[\u3040-\u30ff\u4e00-\u9fff]/.test(preset.template));
  }
}

console.log('\nfilename preview shown in settings');
{
  const at = new Date(2026, 7, 12, 9, 5, 3);
  const base = { folder: 'Linknotes', dateFormat: 'YYYY-MM-DD', author: '' };
  eq('the shipped default',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{sourceName}}_{{anchor}}' }), at),
    'Linknotes/Team handbook_k3n8v1.md');
  eq('the previous default still works',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{title}}_{{date}}' }), at),
    'Linknotes/Quarterly close_2026-08-12.md');
  // A heading has no block ID, so the separator would otherwise be left hanging.
  eq('an empty variable leaves no trailing separator',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{sourceName}}_{{embed}}' }), at),
    'Linknotes/Team handbook.md');
  eq('title only',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{title}}' }), at),
    'Linknotes/Quarterly close.md');
  eq('a custom date format follows through',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{title}} {{date}}', dateFormat: 'YYYY-MM-DD-dddd' }), at),
    'Linknotes/Quarterly close 2026-08-12-Wednesday.md');
  eq('a nested folder is shown',
    previewFilename(Object.assign({}, base, { folder: 'Notes/Linknotes', filenameTemplate: '{{title}}' }), at),
    'Notes/Linknotes/Quarterly close.md');
  // A typo in a variable name shows up literally, which is the point of the preview.
  eq('a misspelled variable is visible',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{titel}}_{{date}}' }), at),
    'Linknotes/{{titel}}_2026-08-12.md');
}

/* ------------------------------------------------------------------ *
 * Moving a marker up into the heading above it.
 *
 * This runs against a small fake DOM. The real thing needs a browser,
 * and the absence of a test here is exactly why the first attempt at
 * this shipped broken: it read el.previousElementSibling inside a
 * post processor, where the tree is still detached and every block is
 * about to be wrapped in a div of its own.
 * ------------------------------------------------------------------ */

function fakeEl(tag, opts) {
  const o = opts || {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    attrs: o.attrs || {},
    _classes: new Set(o.classes || []),
    _text: o.text || '',
    isConnected: o.isConnected !== false,
  };
  el.classList = {
    add: (c) => el._classes.add(c),
    contains: (c) => el._classes.has(c),
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      return el.children.length
        ? el.children.map((c) => c.textContent).join('')
        : el._text;
    },
  });
  Object.defineProperty(el, 'previousElementSibling', {
    get() {
      const p = el.parentElement;
      if (!p) return null;
      const i = p.children.indexOf(el);
      return i > 0 ? p.children[i - 1] : null;
    },
  });
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.matches = (sel) =>
    sel.split(',').map((s) => s.trim().toUpperCase()).indexOf(el.tagName) !== -1;
  el.append = (...kids) => {
    for (const k of kids) {
      if (k.parentElement) {
        const i = k.parentElement.children.indexOf(k);
        if (i !== -1) k.parentElement.children.splice(i, 1);
      }
      k.parentElement = el;
      el.children.push(k);
    }
    return el;
  };
  el.appendChild = (k) => (el.append(k), k);
  el.descendants = function* () {
    for (const c of el.children) {
      yield c;
      yield* c.descendants();
    }
  };
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
  el.querySelectorAll = (sel) => {
    const wants = sel.split(',').map((s) => s.trim());
    const hit = (n) =>
      wants.some((w) => {
        const [tag, cls] = w.split('.');
        if (tag && n.tagName !== tag.toUpperCase()) return false;
        return cls ? n._classes.has(cls) : true;
      });
    return Array.from(el.descendants()).filter(hit);
  };
  return el;
}

/** Reading view: every top-level block sits in a wrapper of its own. */
function readingView(blocks) {
  const section = fakeEl('div', { classes: ['markdown-preview-section'] });
  for (const b of blocks) {
    const wrap = fakeEl('div');
    wrap.append(b);
    section.append(wrap);
  }
  return section;
}

function markerBlock(marker, href) {
  const a = fakeEl('a', { text: marker, attrs: { href }, classes: ['lkn-marker'] });
  const p = fakeEl('p');
  p.append(a);
  return { block: p, link: a };
}

const attach = m.prototype
  ? m.prototype.attachMarkerToHeading
  : require('./main.js').prototype.attachMarkerToHeading;

console.log('\na marker alone under a heading is moved into it');
{
  const h = fakeEl('h2', { text: 'Background' });
  const { block, link } = markerBlock('†', 'Note.md');
  readingView([h, block]);

  const heading = attach.call({}, block, '†');
  check('the heading is returned', heading === h);
  check('the link now sits in the heading', h.children.indexOf(link) !== -1);
  check('the marker block is hidden', block.classList.contains('lkn-relocated'));
}

console.log('\nthe wrapper divs of Reading view are climbed');
{
  const h = fakeEl('h3', { text: 'Detail' });
  const { block, link } = markerBlock('†', 'Note.md');
  readingView([h, block]);
  // The block's own previous sibling is null: the heading is one level up.
  check('the block has no previous sibling of its own', block.previousElementSibling === null);
  check('yet the heading is found', attach.call({}, block, '†') === h);
  check('and the link moved', link.parentElement === h);
}

console.log('\na marker that does not follow a heading is left alone');
{
  const p0 = fakeEl('p', { text: 'Ordinary paragraph.' });
  const { block } = markerBlock('†', 'Note.md');
  readingView([p0, block]);
  check('nothing is returned', attach.call({}, block, '†') === null);
  check('the block is not hidden', !block.classList.contains('lkn-relocated'));
}

console.log('\na block that is more than the marker is left alone');
{
  const h = fakeEl('h2', { text: 'Background' });
  const p = fakeEl('p');
  p.append(fakeEl('span', { text: 'Real prose. ' }));
  p.append(fakeEl('a', { text: '†', attrs: { href: 'Note.md' }, classes: ['lkn-marker'] }));
  readingView([h, p]);
  check('nothing is returned', attach.call({}, p, '†') === null);
}

console.log('\na detached element is refused');
{
  const h = fakeEl('h2', { text: 'Background' });
  const { block } = markerBlock('†', 'Note.md');
  readingView([h, block]);
  block.isConnected = false;
  check('nothing happens before the tree is in the document',
    attach.call({}, block, '†') === null);
}

console.log('\na re-render does not add the marker twice');
{
  const h = fakeEl('h2', { text: 'Background' });
  const { block, link } = markerBlock('†', 'Note.md');
  readingView([h, block]);
  attach.call({}, block, '†');

  // Obsidian re-renders the paragraph; the heading still holds the old link.
  const again = markerBlock('†', 'Note.md');
  const wrap = fakeEl('div');
  wrap.append(again.block);
  h.parentElement.parentElement.append(wrap);

  attach.call({}, again.block, '†');
  const inHeading = h.children.filter((c) => c.tagName === 'A');
  eq('the heading carries one marker, not two', inHeading.length, 1);
  check('the first link is the one kept', inHeading[0] === link);
  check('the repeat block is hidden all the same',
    again.block.classList.contains('lkn-relocated'));
}

console.log('\ntwo different linknotes on one heading both move');
{
  const h = fakeEl('h2', { text: 'Background' });
  const first = markerBlock('†', 'One.md');
  const second = markerBlock('†', 'Two.md');
  readingView([h, first.block, second.block]);

  attach.call({}, first.block, '†');
  // The second block now follows the first, which is hidden but still there.
  check('the second block reaches the heading past the hidden first',
    attach.call({}, second.block, '†') === h);
  const inHeading = h.children.filter((c) => c.tagName === 'A');
  eq('both markers sit in the heading', inHeading.length, 2);
  check('they are in source order',
    inHeading[0] === first.link && inHeading[1] === second.link);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
