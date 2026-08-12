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
  sanitizeFileName,
  clampChars,
  clampBytes,
  previewFilename,
  formatDate,
  narrowToListItem,
  normalizeInline,
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

console.log('\ndefault template end to end');
{
  const vars = {
    date: '2026-08-12',
    source: '[[Team handbook]]',
    title: 'Close is the tenth business day',
    embed: '![[Team handbook#^k3n8v1]]',
    body: 'Confirmed with Finance on 2026-08-10.',
  };
  eq(
    'renders the shipped default',
    tidy(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars)),
    '---\ncreated: 2026-08-12\nsource: "[[Team handbook]]"\n---\n\n' +
      '# Close is the tenth business day\n\n' +
      '![[Team handbook#^k3n8v1]]\n\n' +
      'Confirmed with Finance on 2026-08-10.\n'
  );
}

console.log('\ndefault template with block IDs turned off');
{
  const vars = {
    date: '2026-08-12',
    source: '[[Team handbook]]',
    title: 'Close is the tenth business day',
    embed: '',
    body: 'Confirmed with Finance.',
  };
  eq(
    'no stray blank block where the embed would be',
    tidy(renderTemplate(DEFAULT_NOTE_TEMPLATE, vars)),
    '---\ncreated: 2026-08-12\nsource: "[[Team handbook]]"\n---\n\n' +
      '# Close is the tenth business day\n\n' +
      'Confirmed with Finance.\n'
  );
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
    sourcePath: 'Team handbook.md', title: 'Close date', body: 'Confirmed.', selection: 'the tenth business day',
    selectionQuote: '> the tenth business day', embed: '![[Team handbook#^k3n8v1]]', blockId: 'k3n8v1',
    author: 'A. Reader', summary: 'Team handbook — the tenth business day',
  };
  eq('three presets ship', TEMPLATE_PRESETS.length, 3);
  eq('the first preset is the shipped default', TEMPLATE_PRESETS[0].template, DEFAULT_NOTE_TEMPLATE);
  for (const preset of TEMPLATE_PRESETS) {
    const out = tidy(renderTemplate(preset.template, vars));
    check('no variable is left unresolved in "' + preset.name + '"', !/\{\{[a-z]/i.test(out), '    out: ' + out);
    check('"' + preset.name + '" opens with frontmatter', out.startsWith('---\n'));
    check('"' + preset.name + '" carries the body', out.includes('Confirmed.'));
    check('"' + preset.name + '" is free of CJK', !/[\u3040-\u30ff\u4e00-\u9fff]/.test(preset.template));
  }
}

console.log('\nfilename preview shown in settings');
{
  const at = new Date(2026, 7, 12, 9, 5, 3);
  const base = { folder: 'Linknotes', dateFormat: 'YYYY-MM-DD', author: '' };
  eq('the shipped default',
    previewFilename(Object.assign({}, base, { filenameTemplate: '{{title}}_{{date}}' }), at),
    'Linknotes/Quarterly close_2026-08-12.md');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
