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
  const selection = '保存先のフォルダ名と日付の書式をもう一度確認し、必要であれば設定を初期値に戻してからお試しください。';
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
{
  // Two markers to the same note on one line: neither is picked.
  const r = m.removeLinkFromLine('[[Note_abc123|†]] and [[Note_abc123|†]]', NAMES);
  check('two markers on a line: nothing is removed', !r.removed);
  eq('and the count says why', r.count, 2);
  eq('the line is returned untouched', r.line, '[[Note_abc123|†]] and [[Note_abc123|†]]');
}
{
  // A marker and a prose link to the same note: the marker is the small one.
  const r = m.removeLinkFromLine('See [[Note_abc123]] for detail. [[Note_abc123|†]]', NAMES);
  check('the marker is found', r.removed);
  eq('and the prose link survives', r.line, 'See [[Note_abc123]] for detail.');
}
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

console.log('\nsearching the sidebar list');
{
  const row = { author: 'Tsune', text: 'PCR は三段階です', selection: '変性', name: 'Biology_abc123' };
  check('an empty query keeps everything', m.rowMatches(row, '   '), '');
  check('the author matches', m.rowMatches(row, 'tsune'), '');
  check('the note matches', m.rowMatches(row, 'PCR'), '');
  check('the passage matches', m.rowMatches(row, '変性'), '');
  check('the file name matches', m.rowMatches(row, 'abc123'), '');
  check('two words narrow rather than widen', m.rowMatches(row, 'tsune pcr'), '');
  check('a word that is nowhere fails', !m.rowMatches(row, 'tsune ribosome'), '');
  check('nothing to search is not a match', !m.rowMatches(null, 'x'), '');
  check('a regular expression is taken literally', !m.rowMatches(row, 'p.r'), '');
}

console.log('\nordering the sidebar list');
{
  const rows = [
    { index: 0, author: 'Ono', created: 300, modified: 100, name: 'a' },
    { index: 1, author: '', created: 100, modified: 300, name: 'b' },
    { index: 2, author: 'Abe', created: 200, modified: 200, name: 'c' },
  ];
  const names = (mode) => m.sortRows(rows, mode).map((r) => r.name).join('');
  eq('the note order is the default', names('position'), 'abc');
  eq('an unknown order falls back to it', names('whatever'), 'abc');
  eq('newest first', names('created'), 'acb');
  eq('most recently changed first', names('modified'), 'bca');
  eq('by author, with the nameless last', names('author'), 'cab');
  eq('the source array is left alone', rows.map((r) => r.name).join(''), 'abc');
}

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
    selectionYaml: m.toYamlBlock('the tenth business day'),
    titleShort: 'Close is the tenth business day',
    body: 'Confirmed with Finance.\nTwice.',
    bodyHeading: 'Linknote',
  };
  eq(
    'renders frontmatter, the folded source and the note',
    tidy(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars)),
    '---\ntype: Linknote\ncreated: 2026-08-12 09:05\nsource: "[[Team handbook#^k3n8v1]]"\nauthor: A. Reader\n' +
      'selection: |-\n  the tenth business day\nbody: |-\n  Confirmed with Finance.\n  Twice.\n---\n' +
      '> [!NOTE]- Close is the tenth business day... [[Team handbook#^k3n8v1]]\n> the tenth business day\n' +
      '## Linknote\nConfirmed with Finance.\nTwice.\n'
  );
}

console.log('\nthe body heading comes from the setting, not from the template text');
{
  const vars = {
    date: '2026-08-12', time: '09:05', sourceBlock: '[[Doc]]', author: '', selectionYaml: '',
    bodyYaml: '', titleShort: 'T', selectionQuote: '> x', body: 'note', bodyHeading: 'Comment',
  };
  const out = renderTemplate(DEFAULT_NOTE_TEMPLATE, vars);
  check('the shipped template writes the heading it is given', out.includes('\n## Comment\n'), '    out: ' + out);
  check('and does not hard-code one', DEFAULT_NOTE_TEMPLATE.includes('{{bodyHeading}}'), '');
  check('the filename preview offers it too',
    'bodyHeading' in m.sampleFilenameVars({ dateFormat: 'YYYY-MM-DD', author: '', bodyHeading: 'Linknote' }, new Date()),
    '');
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
    selectionYaml: '',
    titleShort: 'Close date',
    body: '',
    bodyHeading: 'Linknote',
  };
  const out = tidy(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars));
  // Empty properties are valid YAML nulls; what matters is that nothing dangles.
  check('the empty properties are left as nulls', out.includes('\nauthor:\nselection:\nbody:\n'), '    out: ' + out);
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
    selectionQuote: '> the tenth business day', selectionYaml: '|-\n  the tenth business day',
    embed: '![[Team handbook#^k3n8v1]]', blockId: 'k3n8v1',
    author: 'A. Reader', summary: 'Team handbook — the tenth business day',
    titleShort: 'Close date', bodyQuote: '> Confirmed.', bodyYaml: '|-\n  Confirmed.',
    bodyHeading: 'Linknote',
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

console.log('\nfinding a block by whole lines, not by prefix');
{
  const doc = 'The paragraph to annotate. [[A|†]] ^u8f82g\n\nOther.\n';
  eq('a stale selection no longer matches its own anchored line',
    m.blockOccurrences(doc, 'The paragraph to annotate.').length, 0);
  eq('the whole line does match', m.blockOccurrences(doc, 'The paragraph to annotate. [[A|†]] ^u8f82g').length, 1);

  const spaced = m.blockOccurrences('Text here.  \n\nNext.\n', 'Text here.');
  eq('trailing spaces are part of the match', spaced.length, 1);
  eq('and are counted in its length', spaced[0].len, 12);

  eq('two identical blocks are both reported',
    m.blockOccurrences('Same.\n\nSame.\n', 'Same.').length, 2);
  eq('a block at the very end, with no closing newline',
    m.blockOccurrences('One.\n\nLast.', 'Last.').length, 1);
  eq('a fragment inside a line is not a block',
    m.blockOccurrences('A long sentence here.\n', 'long sentence').length, 0);
}

console.log('\nan own-line marker gets a blank line after it as well as before');
{
  const put = (doc, block) => {
    const spot = m.blockOccurrences(doc, block)[0];
    const anchored = m.buildAnchoredBlock(block, LINK, '');
    return m.spliceAnchored(doc, spot.at, spot.len, block, anchored);
  };

  eq('a heading written straight above its list',
    put('## Heading\n1. item one\n2. item two\n', '## Heading'),
    '## Heading\n\n' + LINK + '\n\n1. item one\n2. item two\n');

  eq('a blank line already there is not doubled',
    put('## Heading\n\n1. item one\n', '## Heading'),
    '## Heading\n\n' + LINK + '\n\n1. item one\n');

  eq('at the end of the note there is nothing to separate from',
    put('## Heading', '## Heading'), '## Heading\n\n' + LINK);

  // An inline anchor stays on its line, so nothing is inserted after it.
  const doc = 'Para text.\nNext line.\n';
  const spot = m.blockOccurrences(doc, 'Para text.\nNext line.')[0];
  eq('an inline anchor is spliced as it always was',
    m.spliceAnchored(doc, spot.at, spot.len, 'Para text.\nNext line.',
      m.buildAnchoredBlock('Para text.\nNext line.', LINK, 'abc123')),
    'Para text.\nNext line. ' + LINK + ' ^abc123\n');
}

console.log('\na block ID written on its own line survives');
{
  eq('it is read back', m.existingBlockId('A pinned paragraph.\n^keepme'), 'keepme');
  eq('the marker goes on the text, the ID stays put',
    m.buildAnchoredBlock('A pinned paragraph.\n^keepme', LINK, 'newid1'),
    'A pinned paragraph. ' + LINK + '\n^keepme');
  eq('a table keeps its ID last on the line',
    m.buildAnchoredBlock('| A | B |\n| 1 | 2 |\n^tblid', LINK, 'newid1'),
    '| A | B |\n| 1 | 2 |\n' + LINK + ' ^tblid');
}

console.log('\nblank lines that are not empty still separate blocks');
{
  eq('a separator holding a space', m.findBlockContaining('Alpha para.\n \nBravo para.\n', 'Alpha para.'), 'Alpha para.');
  eq('a file saved with CRLF', m.findBlockContaining('Alpha para.\r\n\r\nBravo para.\r\n', 'Alpha para.'), 'Alpha para.');
  eq('a separator holding a tab', m.findBlockContaining('Alpha para.\n\t\nBravo para.\n', 'Bravo para.'), 'Bravo para.');
}

console.log('\nsettings read back from data.json are not trusted');
{
  eq('a folder that climbs out of the vault is refused', m.safeFolder('../../Documents'), '');
  eq('so is one hidden in the middle', m.safeFolder('A/../B'), '');
  eq('a leading slash is dropped', m.safeFolder('/Linknotes/'), 'Linknotes');
  eq('a plain folder is kept', m.safeFolder('Notes/Linknotes'), 'Notes/Linknotes');

  const clean = m.sanitizeSettings({ folder: '../x', cardWidth: '300', showCards: 'yes', marker: 5, nope: 1 });
  check('a bad folder is dropped, so the default stands', !('folder' in clean));
  eq('a numeric string becomes a number', clean.cardWidth, 300);
  eq('a truthy string becomes a boolean', clean.showCards, true);
  check('a number where a string belongs is dropped', !('marker' in clean));
  check('an unknown key is dropped', !('nope' in clean));
  eq('nothing at all is not an error', JSON.stringify(m.sanitizeSettings(null)), '{}');
}

console.log('\nwhat a link shows');
{
  eq('a wikilink alias', m.linkDisplayText('[[Note|†]]'), '†');
  eq('a wikilink with no alias', m.linkDisplayText('[[Note]]'), 'Note');
  eq('a markdown link', m.linkDisplayText('[†](Note.md)'), '†');
}

console.log('\nfinding the passage inside its block');
{
  const raw = 'The quarterly close lands on\n the tenth business day.';
  const run = m.runInText(raw, 'the tenth  business day');
  check('a line break in the text is no obstacle', !!run);
  eq('and the offsets point at the words', raw.slice(run.start, run.end).replace(/\s+/g, ' '), 'the tenth business day');

  eq('a passage that is no longer there is refused', m.runInText(raw, 'the ninth business day'), null);
  eq('an empty passage is refused', m.runInText(raw, '   '), null);

  // The passage was recorded from rendered text, so it carries no markup.
  eq('the whole block matches itself', m.runInText('Just one sentence.', 'Just one sentence.').start, 0);

  const map = m.collapseWithMap('  a   b  ');
  eq('leading space is dropped, inner runs become one', map.text, 'a b');
  eq('and the map points back at the original', map.map[0], 2);
}

console.log('\nthe passage a linknote is about');
{
  const shipped = '---\ncreated: x\nselection: |-\n  the tenth business day\n---\n' +
    '> [!NOTE]- Close date... [[Doc#^abc]]\n> the tenth business day\n\n## Linknote\nMy note.\n';
  eq('the property wins when it is there',
    m.selectionShown({ selection: 'the tenth business day' }, shipped, 'Linknote'), 'the tenth business day');

  // Every linknote written before the property existed.
  const older = '---\ncreated: x\n---\n> [!NOTE]- Close date\n> the tenth business day\n\n## Linknote\nMy note.\n';
  eq('with no property, the quote above the body is read',
    m.selectionShown(null, older, 'Linknote'), 'the tenth business day');
  eq('the callout title is not the passage',
    m.quotedSelectionOf(older, 'Linknote').indexOf('Close date'), -1);

  const many = '---\n---\n> [!NOTE]- T\n> first line\n> second line\n\n## Linknote\nMy note.\n';
  eq('a passage of several lines reads as one', m.quotedSelectionOf(many, 'Linknote'), 'first line second line');

  const quoteInBody = '---\n---\n## Linknote\n> a quote I wrote myself\n';
  eq('a quote inside the note itself is not the passage',
    m.quotedSelectionOf(quoteInBody, 'Linknote'), '');

  eq('nothing recorded, nothing shown', m.selectionShown(null, '---\n---\n\nJust text.\n', 'Linknote'), '');
  eq('an empty property falls back to the quote',
    m.selectionShown({ selection: '  ' }, older, 'Linknote'), 'the tenth business day');
}

console.log('\nthe block a marker has to itself');
{
  // The post-processor case: the marker alone in a paragraph.
  const a = fakeEl('a', { text: '†', attrs: { href: 'Note.md' } });
  const p = fakeEl('p');
  p.append(a);
  check('the paragraph is the block', m.markerBlockOf(a, '†') === p);

  // The sweep case: the same paragraph inside Reading view's wrapper.
  const wrap = fakeEl('div');
  wrap.append(p);
  const sizer = fakeEl('div', { classes: ['markdown-preview-sizer'] });
  sizer.append(wrap);
  check('the wrapper is climbed to, but not the sizer', m.markerBlockOf(a, '†') === wrap);

  // A marker sharing its block with prose has no block of its own.
  const mixed = fakeEl('p');
  const b = fakeEl('a', { text: '†', attrs: { href: 'Note.md' } });
  mixed.append(fakeEl('span', { text: 'Real prose. ' }), b);
  check('a marker among prose is not alone', m.markerBlockOf(b, '†') === null);
}

console.log('\nhow much a link looks like a marker');
{
  eq('the configured character is exact', m.markerMatch('†', '†'), 'exact');
  eq('surrounding space is ignored', m.markerMatch(' † ', '†'), 'exact');
  eq('an emoji marker is exact too', m.markerMatch('🙆', '🙆'), 'exact');
  eq('another emoji is a maybe', m.markerMatch('📱', '🙆'), 'maybe');
  eq('an emoji counts as one character', m.markerMatch('📱📱📱📱', '🙆'), 'maybe');
  eq('five is too many', m.markerMatch('📱📱📱📱📱', '🙆'), 'no');
  eq('a short word is a maybe', m.markerMatch('note', '†'), 'maybe');
  eq('prose with a space is not', m.markerMatch('see this', '†'), 'no');
  eq('a long alias is not', m.markerMatch('Quarterly close', '†'), 'no');
  eq('empty text is not', m.markerMatch('   ', '†'), 'no');
  eq('with no marker set, short text is still a maybe', m.markerMatch('†', ''), 'maybe');
}

console.log('\nthe marker a link was written with');
{
  eq('the alias is the marker',
    m.markerOfLink({ original: '[[Linknotes/A|📱]]', displayText: '📱' }), '📱');
  eq('a dagger too',
    m.markerOfLink({ original: '[[A#^b1|†]]', displayText: '†' }), '†');
  eq('no alias, no marker',
    m.markerOfLink({ original: '[[Linknotes/A]]', displayText: 'Linknotes/A' }), '');
  eq('a long alias is not a marker',
    m.markerOfLink({ original: '[[Linknotes/A|Quarterly close]]', displayText: 'Quarterly close' }), '');
  eq('nothing at all', m.markerOfLink(null), '');
}

console.log('\na marker written on another device is still a marker');
{
  const decorate = m.prototype.decorateMarkers;
  const settings = { marker: '🙆', markerStyle: 'chip', highlightAnchored: true, folder: 'Linknotes' };

  const mine = fakeEl('a', { text: '🙆', attrs: { href: 'Linknotes/A.md' } });
  const theirs = fakeEl('a', { text: '📱', attrs: { href: 'Linknotes/B.md' } });
  const prose = fakeEl('a', { text: 'ok', attrs: { href: 'Elsewhere.md' } });
  const p = fakeEl('p');
  p.append(fakeEl('span', { text: 'A paragraph. ' }), mine, theirs, prose);

  let attached = 0;
  decorate.call({
    settings,
    ctxMap: new Map([[p, { sourcePath: 'Doc.md' }]]),
    // Only the two links in the linknote folder resolve there.
    pointsAtLinknote: (a) => String(a.getAttribute('href')).startsWith('Linknotes/'),
    scheduleHeadingAttach: () => { attached++; },
  }, p);

  check('this device’s marker is decorated', mine._classes.has('lkn-marker'));
  check('the other device’s marker is decorated too', theirs._classes.has('lkn-marker'));
  check('a short link to an ordinary note is left alone', !prose._classes.has('lkn-marker'));
  check('the block is flagged as anchored', p._classes.has('lkn-anchored'));
  eq('two markers in a block: nothing is moved to a heading', attached, 0);
}

console.log('\na foreign marker alone in its block still reaches the heading');
{
  const decorate = m.prototype.decorateMarkers;
  const a = fakeEl('a', { text: '📱', attrs: { href: 'Linknotes/B.md' } });
  const p = fakeEl('p');
  p.append(a);

  let seen = null;
  decorate.call({
    settings: { marker: '🙆', markerStyle: 'chip', highlightAnchored: false, folder: 'Linknotes' },
    ctxMap: new Map([[p, { sourcePath: 'Doc.md' }]]),
    pointsAtLinknote: () => true,
    scheduleHeadingAttach: (el, text) => { seen = text; },
  }, p);

  check('it is decorated', a._classes.has('lkn-marker'));
  eq('the heading move is asked for with the text found, not the setting', seen, '📱');
}

/* --------------------------------------------------------------------
 * Card placement: margin or inline.
 *
 * A pane just wide enough is the whole question, and it is asked again
 * every time something might have changed the answer. 0.20.0 shipped
 * with cards that fell inline in a narrow pane and stayed there however
 * wide it was made afterwards, so the way back is tested as well as the
 * way out.
 * ------------------------------------------------------------------ */

function paneEl(tag, classes) {
  const n = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentElement: null,
    isConnected: true,
    width: 0,
    _c: new Set(classes || []),
    style: {
      _p: {},
      setProperty(k, v) { this._p[k] = v; },
      removeProperty(k) { delete this._p[k]; },
    },
  };
  n.classList = {
    add: (c) => n._c.add(c),
    remove: (c) => n._c.delete(c),
    contains: (c) => n._c.has(c),
    toggle: (c, on) => (on ? n._c.add(c) : n._c.delete(c)),
  };
  n.append = (k) => { k.parentElement = n; n.children.push(k); return n; };
  n.closest = (sel) => {
    const want = sel.replace('.', '');
    for (let cur = n; cur; cur = cur.parentElement) if (cur._c.has(want)) return cur;
    return null;
  };
  n.getBoundingClientRect = () => ({ width: n.width, top: 0, bottom: 0, height: 10 });
  n.querySelectorAll = () => [];
  return n;
}

function makePane() {
  const frames = [];
  const win = { requestAnimationFrame: (fn) => frames.push(fn) };
  const doc = { defaultView: win };

  const view = paneEl('div', ['markdown-preview-view']);
  const host = paneEl('p');
  const stack = paneEl('div', ['lkn-card-stack']);
  view.append(host);
  host.append(stack);
  for (const n of [view, host, stack]) n.ownerDocument = doc;

  const asked = { later: 0, observed: [] };
  const plugin = {
    settings: { cardPlacement: 'margin', cardWidth: 240, cardsPerStack: 3, showCards: true },
    observeStack() {},
    observeView(v) { asked.observed.push(v); },
    scheduleRelayout() {},
    capStack() {},
    laterCardPass() { asked.later += 1; },
  };

  return {
    view, host, stack, asked,
    // A pane of this width, decided to the end.
    fitAt(px) {
      view.width = px;
      m.prototype.fitStack.call(plugin, stack);
      for (let i = 0; i < 12 && frames.length; i += 1) {
        for (const fn of frames.splice(0)) fn();
      }
    },
    detach() { stack.isConnected = false; },
    inMargin: () => view._c.has('lkn-cards') && !stack._c.has('lkn-card-inline'),
    inline: () => !view._c.has('lkn-cards') && stack._c.has('lkn-card-inline'),
  };
}

console.log('\ncard placement — the way out and the way back');
{
  const pane = makePane();

  pane.fitAt(1200);
  check('a wide pane puts the card in the margin', pane.inMargin());

  pane.fitAt(500);
  check('a narrow pane drops it inline', pane.inline());

  pane.fitAt(1200);
  check('widening the pane again brings it back to the margin', pane.inMargin());

  // 660px is the threshold for a 240px card: 240 + 24 + 16 + 380.
  pane.fitAt(659);
  check('a pane one pixel short is inline', pane.inline());
  pane.fitAt(660);
  check('a pane exactly wide enough is margin', pane.inMargin());
}

console.log('\ncard placement — the pane is watched, and a stall is retried');
{
  const pane = makePane();
  pane.fitAt(1200);
  check('the pane itself is observed, so a width change re-decides', pane.asked.observed.indexOf(pane.view) !== -1);

  const stalled = makePane();
  stalled.detach();
  stalled.fitAt(1200);
  eq('a stack still detached after every frame asks for a later pass', stalled.asked.later, 1);
  stalled.fitAt(1200);
  eq('but only once, so a stack that never attaches cannot ask forever', stalled.asked.later, 1);

  const zero = makePane();
  zero.fitAt(0);
  eq('a pane with no width yet also asks for a later pass', zero.asked.later, 1);
  zero.fitAt(1200);
  check('and settles once the pane has been measured', zero.inMargin());
  zero.detach();
  zero.fitAt(1200);
  eq('a decided card that stalls later may ask again', zero.asked.later, 2);
}

console.log('\nupdate notices — who a linknote belongs to');
{
  const { authorOf, isOwnAuthor } = m;
  eq('a plain string author', authorOf({ author: 'Yamada' }), 'Yamada');
  eq('a YAML list author', authorOf({ author: ['Yamada'] }), 'Yamada');
  eq('a list with several names', authorOf({ author: ['Yamada', 'Sato'] }), 'Yamada, Sato');
  eq('surrounding whitespace is dropped', authorOf({ author: '  Yamada ' }), 'Yamada');
  eq('no frontmatter names nobody', authorOf(null), '');
  eq('no author property names nobody', authorOf({}), '');
  eq('a numeric author is still a name', authorOf({ author: 42 }), '42');

  check('the same name is own', isOwnAuthor('Yamada', 'Yamada'));
  check('a different name is not', !isOwnAuthor('Yamada', 'Sato'));
  check('with no Author set, nothing is own', !isOwnAuthor('Yamada', ''));
  check('a nameless linknote is not claimed as own', !isOwnAuthor('', 'Yamada'));
  check('whitespace does not defeat the match', isOwnAuthor(' Yamada ', 'Yamada'));
}

console.log('\nupdate notices — what changed since this device looked');
{
  const { diffKnown } = m;
  const known = { 'L/a.md': 100, 'L/b.md': 200, 'L/gone.md': 50 };

  const same = diffKnown(known, { 'L/a.md': 100, 'L/b.md': 200 });
  eq('nothing new when nothing moved', same.added.length + same.edited.length, 0);

  const one = diffKnown(known, { 'L/a.md': 100, 'L/b.md': 300, 'L/c.md': 400 });
  eq('a path not yet known is new', one.added.join(','), 'L/c.md');
  eq('a later mtime is an edit', one.edited.join(','), 'L/b.md');

  const back = diffKnown(known, { 'L/a.md': 90 });
  eq('an earlier mtime is not an edit', back.edited.length, 0);
  check('what disappeared is not reported', !JSON.stringify(one).includes('gone'));

  const fresh = diffKnown({}, { 'L/a.md': 1 });
  eq('an empty memory makes everything new', fresh.added.length, 1);
}

console.log('\nupdate notices — the sentence a notice says');
{
  const { noticeText } = m;
  eq('one new linknote', noticeText([{ author: 'Yamada', kind: 'new' }]), '1 linknote updated (Yamada: 1 new)');
  eq('one edited linknote', noticeText([{ author: 'Yamada', kind: 'edited' }]), '1 linknote updated (Yamada: 1 edited)');
  eq(
    'several changes group by author, in the order first seen',
    noticeText([
      { author: 'Yamada', kind: 'new' },
      { author: 'Sato', kind: 'edited' },
      { author: 'Yamada', kind: 'new' },
    ]),
    '3 linknotes updated (Yamada: 2 new · Sato: 1 edited)'
  );
  eq(
    'new and edited from one author sit together',
    noticeText([
      { author: 'Yamada', kind: 'new' },
      { author: 'Yamada', kind: 'edited' },
    ]),
    '2 linknotes updated (Yamada: 1 new, 1 edited)'
  );
  eq(
    'a linknote that names nobody is still counted',
    noticeText([{ author: '', kind: 'new' }]),
    '1 linknote updated ((no author): 1 new)'
  );
  eq('no changes, no sentence', noticeText([]), '');
}

console.log('\nthe inbox — what heads a row');
{
  const { headSlot } = m;
  eq('unread shows the dot', headSlot(true, '📱'), 'dot');
  eq('the dot wins over the marker, never both', headSlot(true, '🙆'), 'dot');
  eq('once read, the marker takes the slot', headSlot(false, '📱'), 'marker');
  eq('read with no marker leaves it empty', headSlot(false, ''), 'none');
  eq('a marker of only spaces is no marker', headSlot(false, '   '), 'none');
  eq('unread with no marker still shows the dot', headSlot(true, ''), 'dot');
}

console.log('\nthe inbox — a tick anywhere clears the marks everywhere');
{
  // Acknowledging in the sidebar used to clear the row and leave the card in
  // the note still wearing its accent and its tick, because each tick only
  // tidied itself. Both now go through clearUnreadMarks.
  const cardFor = (path, unread) => {
    const classes = new Set(['lkn-card']);
    if (unread) classes.add('lkn-card-unread');
    const ack = unread ? { removed: false, remove() { this.removed = true; } } : null;
    return {
      path,
      ack,
      _c: classes,
      classList: { remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      querySelector: (sel) => (sel === '.lkn-card-ack' ? ack : null),
    };
  };

  const mine = cardFor('L/a.md', true);
  const alsoMine = cardFor('L/a.md', true); // the same linknote in a second pane
  const theirs = cardFor('L/b.md', true);
  const cards = [mine, alsoMine, theirs];

  const plugin = {
    openDocuments: () => [
      {
        querySelectorAll: (sel) =>
          sel === '.lkn-card.lkn-card-unread'
            ? cards.filter((c) => c._c.has('lkn-card-unread'))
            : cards.filter((c) => sel.indexOf('"' + c.path + '"') !== -1),
      },
    ],
  };

  m.prototype.clearUnreadMarks.call(plugin, { path: 'L/a.md' });
  check('the card that was pressed is cleared', !mine._c.has('lkn-card-unread'));
  check('and its tick is gone', mine.ack.removed);
  check('the same linknote in another pane is cleared too', !alsoMine._c.has('lkn-card-unread'));
  check('a different linknote is left alone', theirs._c.has('lkn-card-unread'));
  check('and keeps its tick', !theirs.ack.removed);

  m.prototype.clearUnreadMarks.call(plugin);
  check('marking everything read clears what is left', !theirs._c.has('lkn-card-unread'));
  check('including its tick', theirs.ack.removed);
}

console.log('\nthe inbox — showing only what is unread');
{
  const { unreadOnly, sortRows } = m;
  check('the unread choice narrows the list', unreadOnly('unread'));
  check('an ordinary order does not', !unreadOnly('modified'));
  check('nor does the default', !unreadOnly('position'));
  check('nor an unknown one', !unreadOnly('whatever'));

  // What is left after the filter is ordered newest first, like any inbox.
  const rows = [
    { index: 0, modified: 100, unread: true },
    { index: 1, modified: 300, unread: false },
    { index: 2, modified: 200, unread: true },
  ];
  const kept = rows.filter((r) => r.unread);
  eq('only the unread rows survive', kept.length, 2);
  eq(
    'and they come newest first',
    sortRows(kept, 'unread').map((r) => r.modified).join(','),
    '200,100'
  );
  eq(
    'rows with the same time keep the order they had',
    sortRows(
      [
        { index: 0, modified: 50, unread: true },
        { index: 1, modified: 50, unread: true },
      ],
      'unread'
    )
      .map((r) => r.index)
      .join(','),
    '0,1'
  );
}

console.log('\nchat notifications — what may leave the vault');
{
  const { chatText, safeWebhook } = m;

  eq(
    'who wrote it, and whose note they wrote it on',
    chatText([{ author: 'Yamada', kind: 'new', noteAuthor: 'Tsuneyama' }]),
    "Linknote — 1 linknote\nYamada → Tsuneyama's notes: 1"
  );
  eq(
    'the same pair is counted together, different pairs are not',
    chatText([
      { author: 'Yamada', kind: 'new', noteAuthor: 'Tsuneyama' },
      { author: 'Sato', kind: 'edited', noteAuthor: 'Panyin' },
      { author: 'Yamada', kind: 'new', noteAuthor: 'Tsuneyama' },
    ]),
    "Linknote — 3 linknotes\nYamada → Tsuneyama's notes: 2\nSato → Panyin's notes: 1"
  );
  eq(
    'one person on two people’s notes is two lines',
    chatText([
      { author: 'Yamada', kind: 'new', noteAuthor: 'Tsuneyama' },
      { author: 'Yamada', kind: 'new', noteAuthor: 'Panyin' },
    ]),
    "Linknote — 2 linknotes\nYamada → Tsuneyama's notes: 1\nYamada → Panyin's notes: 1"
  );
  eq(
    'a note signed by nobody says so',
    chatText([{ author: 'Yamada', kind: 'new', noteAuthor: '' }]),
    'Linknote — 1 linknote\nYamada → unsigned notes: 1'
  );
  eq(
    'a linknote signed by nobody says so too',
    chatText([{ author: '', kind: 'new', noteAuthor: 'Tsuneyama' }]),
    "Linknote — 1 linknote\n(no author) → Tsuneyama's notes: 1"
  );
  eq('nothing to say, nothing said', chatText([]), '');

  // However many people are at work, the message stays a message.
  const many = [];
  for (let i = 0; i < 12; i += 1) many.push({ author: 'P' + i, kind: 'new', noteAuthor: 'Tsuneyama' });
  const capped = chatText(many);
  eq('the list is capped', capped.split('\n').length, 10);
  check('and says how many it left out', capped.indexOf('and 4 more') !== -1);
  check('while the total is still right', capped.indexOf('12 linknotes') !== -1);

  // The whole point of the format: the message carries no content.
  const line = chatText([
    {
      author: 'Yamada',
      kind: 'new',
      noteAuthor: 'Tsuneyama',
      note: 'NEC negotiating position',
      text: 'confidential',
    },
  ]);
  check('the note name does not leave the vault', line.indexOf('NEC') === -1);
  check('nor does any of the text', line.indexOf('confidential') === -1);

  check('an https address is kept', !!safeWebhook('https://qyapi.weixin.qq.com/x?key=k'));
  eq('a plain http address is refused', safeWebhook('http://example.com/hook'), '');
  eq('so is a bare word', safeWebhook('not-a-url'), '');
  eq('and an empty setting', safeWebhook(''), '');
  eq('and one that is only spaces', safeWebhook('   '), '');
  eq('surrounding space is trimmed', safeWebhook('  https://a.example/h  '), 'https://a.example/h');
  eq('an address with a space inside is refused', safeWebhook('https://a.example/h k'), '');
}

console.log('\nchat notifications — who gets an @');
{
  const { parseMentionMap, mentionsFor } = m;

  const map = parseMentionMap('Tsuneyama=tsuneyama, 潘寅=panyin, 山口亜土=13800001111');
  eq('three people are read', map.size, 3);
  eq('a name maps to an account', map.get('Tsuneyama'), 'tsuneyama');
  eq('spacing around either side is trimmed', map.get('潘寅'), 'panyin');

  const broken = parseMentionMap('no equals sign, =missing name, missing account=, , ');
  eq('entries that name nobody are dropped', broken.size, 0);
  eq('nothing at all is an empty directory', parseMentionMap('').size, 0);
  eq('and so is nothing', parseMentionMap(null).size, 0);

  const one = mentionsFor([{ noteAuthor: 'Tsuneyama' }], map);
  eq('an account goes in the account list', one.ids.join(','), 'tsuneyama');
  eq('and nowhere else', one.mobiles.length, 0);

  const phone = mentionsFor([{ noteAuthor: '山口亜土' }], map);
  eq('digits are taken for a phone number', phone.mobiles.join(','), '13800001111');
  eq('and not for an account', phone.ids.length, 0);

  const both = mentionsFor(
    [{ noteAuthor: 'Tsuneyama, 潘寅' }, { noteAuthor: 'Tsuneyama' }],
    map
  );
  eq('a note with two authors mentions both', both.ids.join(','), 'tsuneyama,panyin');
  eq('and nobody twice, however many linknotes', both.ids.length, 2);

  const unknown = mentionsFor([{ noteAuthor: 'Someone Else' }], map);
  eq('a name the directory does not know is not mentioned', unknown.ids.length, 0);
  eq('an empty directory mentions nobody', mentionsFor([{ noteAuthor: 'Tsuneyama' }], new Map()).ids.length, 0);

  // A thread of one person: an account nobody can look up is not needed to
  // reach the only person there. This is what the directory could not do —
  // WeCom took the accounts above without complaint and quietly omitted the @,
  // because a name a note signs itself with is not an account it issued.
  const all = mentionsFor([{ noteAuthor: 'Tsuneyama' }], map, true);
  eq('everyone in the thread is one mention', all.ids.join(','), '@all');
  eq('and no phone number besides', all.mobiles.length, 0);

  const allUnknown = mentionsFor([{ noteAuthor: 'Someone the directory never heard of' }], map, true);
  eq('a name nobody wrote down still reaches the thread', allUnknown.ids.join(','), '@all');

  const allEmpty = mentionsFor([{ noteAuthor: '' }], new Map(), true);
  eq('with no directory at all it still works', allEmpty.ids.join(','), '@all');

  const allTwice = mentionsFor(
    [{ noteAuthor: 'Tsuneyama' }, { noteAuthor: '潘寅' }, { noteAuthor: 'Tsuneyama' }],
    map,
    true
  );
  eq('and everyone is not said three times', allTwice.ids.length, 1);

  eq(
    'off, the directory decides as before',
    mentionsFor([{ noteAuthor: 'Tsuneyama' }], map, false).ids.join(','),
    'tsuneyama'
  );
}

console.log('\nchat notifications — whose note is it');
{
  const { isOwnNote, namesOf } = m;

  // The case that shipped broken: the vault's notes are signed "Tsuneyama",
  // the plugin's Author is the per-device "Tsune", and judging both by the
  // one setting meant no note was ever recognised as the reader's own.
  check('the device name alone does not match the note name', !isOwnNote('Tsuneyama', ['Tsune']));
  check('naming the note author explicitly does', isOwnNote('Tsuneyama', ['Tsuneyama']));
  check('several names may be given', isOwnNote('Tsuneyama', ['Tsune', 'Tsuneyama']));

  // authorOf joins a YAML list with ", ", so a note written by two people
  // arrives here as one string.
  check('a note naming you among others is yours', isOwnNote('Sato, Tsuneyama', ['Tsuneyama']));
  check('a note naming only other people is not', !isOwnNote('Sato, Yamada', ['Tsuneyama']));
  check('spacing does not decide it', isOwnNote('  Sato ,  Tsuneyama  ', ['Tsuneyama']));

  check('a note naming nobody is nobody’s', !isOwnNote('', ['Tsuneyama']));
  check('and with no name of your own, nothing is yours', !isOwnNote('Tsuneyama', []));
  check('a partial name is not a match', !isOwnNote('Tsuneyamada', ['Tsuneyama']));

  eq('one name', namesOf('Tsuneyama').join('|'), 'Tsuneyama');
  eq('several, trimmed', namesOf(' A , B ,, C ').join('|'), 'A|B|C');
  eq('nothing at all', namesOf('').length, 0);
  eq('nothing is not a name', namesOf(null).length, 0);
}

console.log('\nchat notifications — whose annotation is it');
{
  const { chatWorthy } = m;
  // The real note: signed by one person under two names.
  const NOTE = 'Tsuneyama, Tsune';
  const ME = ['Tsuneyama', 'Tsune'];

  check('a colleague annotating my note is told', chatWorthy(NOTE, 'Panyin', ME));
  check('another of my own devices is told', chatWorthy(NOTE, 'Tsuney_iPhone', ME));

  // The rule this version is about: any name the note itself lists is one of
  // its authors annotating their own note, whichever device they used.
  check('a name the note lists is not told — I annotated my own note', !chatWorthy(NOTE, 'Tsune', ME));
  check('the other name it lists, likewise', !chatWorthy(NOTE, 'Tsuneyama', ME));

  // A note that does not happen to list my device name still must not
  // announce my own desk to me.
  check('my device name is mine even when the note omits it', !chatWorthy('Tsuneyama', 'Tsune', ME));

  check('a note that is not mine is never told', !chatWorthy('Panyin, Ado', 'Yamada', ME));

  // Several names, which is the ordinary case: one person answers to more
  // than one, and the note may only use one of them.
  check('any one of my names makes the note mine', chatWorthy('Tsuneyama', 'Panyin', ['Tsune', 'Tsuneyama']));
  check('and so does another', chatWorthy('常山宏彰', 'Panyin', ['Tsuneyama', '常山宏彰']));
  check('a name I did not claim does not', !chatWorthy('常山宏彰', 'Panyin', ['Tsuneyama']));

  // A note naming nobody: a guess either way, so it is asked, not assumed.
  check('an unsigned note is nobody’s unless asked for', !chatWorthy('', 'Panyin', ME));
  check('asked for, it is mine — which is how the setting ships', chatWorthy('', 'Panyin', ME, true));
  check('and even then my own writing on one is not news', !chatWorthy('', 'Tsune', ME, true));
  check('nor from the name my notes use', !chatWorthy('', 'Tsuneyama', ME, true));
  check('and with no name of my own, nothing is told', !chatWorthy(NOTE, 'Panyin', []));

  // Better to hear about an unsigned annotation than to swallow it.
  check('an unsigned linknote is told', chatWorthy(NOTE, '', ME));

  // A note written with a colleague: they are one of its authors, so their
  // annotation is not news. Reverse this if it should be.
  check('a co-author annotating our shared note is not told', !chatWorthy('Tsuneyama, Panyin', 'Panyin', ME));

  // Widened to the whole vault: whose note it is stops mattering, but who
  // wrote the linknote still does.
  const ALL = [ME, true, true];
  check('someone else on someone else’s note is told', chatWorthy('Panyin', 'Ado', ...ALL));
  check('and on a note of mine, as before', chatWorthy('Tsuneyama', 'Ado', ...ALL));
  check('my own writing is still never told', !chatWorthy('Panyin', 'Tsune', ...ALL));
  check('nor is an author annotating their own note', !chatWorthy('Panyin', 'Panyin', ...ALL));
  check('an unsigned note needs no permission when every note counts', chatWorthy('', 'Ado', ME, false, true));
  check('but a fourth person on that note is', chatWorthy('Tsuneyama, Panyin', 'Ado', ME));
}

console.log('\nchat notifications — the address is this device’s alone');
{
  const { sanitizeChatConfig, sanitizeSettings } = m;

  // The whole point: a shared vault must not carry one person's channel to
  // everyone. sanitizeSettings keeps only the keys it knows, so an address
  // arriving in a synced settings file is dropped rather than adopted.
  const kept = sanitizeSettings({ chatWebhook: 'https://a.example/h', chatNotify: true, author: 'Yamada' });
  check('a webhook in the settings file is not kept', !('chatWebhook' in kept));
  check('nor is the switch that goes with it', !('chatNotify' in kept));
  eq('the settings that do belong there survive', kept.author, 'Yamada');

  const sound = sanitizeChatConfig({ on: true, webhook: 'https://a.example/h' });
  check('a sound configuration is on', sound.on);
  eq('and keeps its address', sound.webhook, 'https://a.example/h');

  // 0.22.0 folded "asked for" and "can happen" into one flag, so switching it
  // on before pasting the address recorded off, and pasting the address
  // afterwards did not put it back: a switch that looked on, and a feature
  // that was not. The two are kept apart now.
  const noUrl = sanitizeChatConfig({ on: true, webhook: '' });
  check('switching it on is remembered even with no address yet', noUrl.on);
  check('but nothing is live until there is one', !m.chatIsLive(noUrl));
  check('and it goes live once the address arrives', m.chatIsLive({ on: true, webhook: 'https://a.example/h' }));
  check('an address without the switch is not live', !m.chatIsLive({ on: false, webhook: 'https://a.example/h' }));
  check('nothing at all is not live', !m.chatIsLive(null));

  const httpOnly = sanitizeChatConfig({ on: true, webhook: 'http://a.example/h' });
  check('an http address is refused', !httpOnly.webhook);
  check('so it is not live', !m.chatIsLive(httpOnly));

  const nothing = sanitizeChatConfig(null);
  check('nothing stored means off', !nothing.on);
  eq('and no address', nothing.webhook, '');
  check('a bare string means off too', !sanitizeChatConfig('yes').on);
}

console.log('\nthe inbox — when a linknote counts as read');
{
  const { readsOnShowing } = m;
  check('by default, showing a card decides nothing', !readsOnShowing({ readOn: 'open' }));
  check('an unset preference is the careful one', !readsOnShowing({}));
  check('a nonsense value is the careful one too', !readsOnShowing({ readOn: 'yes please' }));
  check('only "shown" clears a linknote by drawing it', readsOnShowing({ readOn: 'shown' }));
  check('no settings at all decides nothing', !readsOnShowing(null));
}

console.log('\nout of sight — hiding every mark');
{
  const { marksAreHidden } = m;
  // A reader who cannot see the marks cannot know they are there, so the
  // safe answer to every unclear value is to keep drawing them.
  check('by default the marks are drawn', !marksAreHidden({ marksHidden: false }));
  check('a vault saved before this setting existed draws them', !marksAreHidden({}));
  check('so does a value nobody recognises', !marksAreHidden({ marksHidden: 'yes' }));
  check('so do no settings at all', !marksAreHidden(null));
  check('only a plain true hides them', marksAreHidden({ marksHidden: true }));
}

console.log('\ncards on paper — how an exported PDF carries them');
{
  const { printMode } = m;
  // The failure to guard against is a document that quietly lost the
  // annotations, so anything unrecognised keeps them where they are on screen.
  eq('the margin, as on screen', printMode({ printCards: 'margin' }), 'margin');
  eq('a vault saved before this setting existed', printMode({}), 'margin');
  eq('a value nobody recognises', printMode({ printCards: 'sideways' }), 'margin');
  eq('no settings at all', printMode(null), 'margin');
  eq('under the block, when asked for', printMode({ printCards: 'inline' }), 'inline');
  eq('left out, when asked for', printMode({ printCards: 'off' }), 'off');
}

console.log('\nthe inbox — the count on the ribbon');
{
  const { badgeText } = m;
  eq('nothing unread, no badge', badgeText(0), '');
  eq('one unread', badgeText(1), '1');
  eq('ninety-nine is shown as itself', badgeText(99), '99');
  eq('past a hundred it stops counting', badgeText(100), '99+');
  eq('a negative count is no badge', badgeText(-3), '');
  eq('a count that is not a number is no badge', badgeText(undefined), '');
}

console.log('\nupdate notices — the read state is checked before use');
{
  const { sanitizeSeenState } = m;
  eq('nothing stored means start over', sanitizeSeenState(null), null);
  eq('a bare string means start over', sanitizeSeenState('known'), null);
  eq('a state without known means start over', sanitizeSeenState({ told: {} }), null);

  const kept = sanitizeSeenState({ known: { 'L/a.md': 100 }, told: { 'L/a.md': 90 } });
  eq('a sound state keeps its marks', kept.known['L/a.md'], 100);
  eq('and what it was told', kept.told['L/a.md'], 90);

  const mixed = sanitizeSeenState({
    known: { 'L/a.md': 100, 'L/b.md': 'soon', 'L/c.md': -5, 'L/d.md': null },
    told: 'everything',
  });
  eq('a mark that is not a time is dropped', Object.keys(mixed.known).join(','), 'L/a.md');
  eq('a told that is not a map is an empty one', Object.keys(mixed.told).length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
