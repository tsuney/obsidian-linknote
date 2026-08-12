/*
 * End-to-end smoke test for the note-creation path, with a fake vault.
 * Exercises createLinknote() the way the plugin does at runtime, so that
 * template rendering, link generation, anchoring and the write-back are all
 * checked together without launching Obsidian.
 *
 * Run with:  node test/integration.js
 */

const path = require('path');
const Module = require('module');
const stubPath = require.resolve('./obsidian-stub.js');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'obsidian') return stubPath;
  return resolve.call(this, request, ...rest);
};

const obsidian = require(stubPath);
const LinknotePlugin = require(path.join(__dirname, '..', 'main.js'));

let pass = 0;
let fail = 0;
const notices = [];

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

/* ------------------------------------------------------------- fake vault */

class FakeFile extends obsidian.TFile {
  constructor(p) {
    super();
    this.path = p;
    this.basename = path.basename(p, '.md');
    this.extension = 'md';
  }
}

function makeApp(files) {
  const store = new Map(Object.entries(files));
  const folders = new Set();
  const handles = new Map();
  for (const p of store.keys()) handles.set(p, new FakeFile(p));

  return {
    _store: store,
    vault: {
      getAbstractFileByPath: (p) => handles.get(p) || (folders.has(p) ? { path: p, children: [] } : null),
      read: async (f) => store.get(f.path),
      create: async (p, content) => {
        if (store.has(p)) throw new Error('already exists: ' + p);
        store.set(p, content);
        const h = new FakeFile(p);
        handles.set(p, h);
        return h;
      },
      createFolder: async (p) => folders.add(p),
      process: async (f, fn) => {
        const next = fn(store.get(f.path));
        store.set(f.path, next);
        return next;
      },
    },
    fileManager: {
      // Mirrors Obsidian's shortest-path wikilink output.
      generateMarkdownLink: (file, sourcePath, subpath, alias) =>
        '[[' + file.basename + (subpath || '') + (alias ? '|' + alias : '') + ']]',
    },
    workspace: {
      getLeaf: () => ({ openFile: async () => {} }),
    },
  };
}

function makePlugin(app, data) {
  const p = new LinknotePlugin();
  p.app = app;
  p.loadData = async () => data || null;
  p.saveData = async () => {};
  return p;
}

/** Builds the snapshot the plugin would capture from a Reading-view selection. */
function makeSnapshot(app, sourcePath, selection, blockLineStart, blockLineEnd, opts) {
  const o = opts || {};
  const text = app._store.get(sourcePath);
  const info = { text, lineStart: blockLineStart, lineEnd: blockLineEnd };
  // o.stale mimics a recycled render context: getSectionInfo() returns null.
  const ctx = {
    sourcePath,
    getSectionInfo: () => (o.stale ? null : info),
  };
  return {
    text: selection,
    ctxEl: {},
    ctx,
    sourcePath,
    blockSrc: o.noBlockSrc
      ? ''
      : text.split('\n').slice(blockLineStart, blockLineEnd + 1).join('\n'),
  };
}

/* -------------------------------------------------------------- scenarios */

async function main() {
  console.log('\n1. default template, plain paragraph');
  {
    const src = 'Team handbook.md';
    const app = makeApp({
      [src]: '# Team handbook\n\nThe quarterly close lands on the tenth business day.\n\nExpenses are filed weekly.\n',
    });
    const p = makePlugin(app, null);
    await p.loadSettings();

    const snap = makeSnapshot(app, src, 'the tenth business day', 2, 2);
    const file = await p.createLinknote(snap, { title: 'Close date', body: 'Confirmed with Finance.' });

    const note = app._store.get(file.path);
    const source = app._store.get(src);

    check('the linknote lands in the default folder', file.path.startsWith('Linknotes/'), '    got: ' + file.path);
    eq('filename comes from {{title}}', file.path, 'Linknotes/Close date.md');

    const idMatch = source.match(/\^([a-z0-9]{6})/);
    check('a block ID was appended to the source', !!idMatch, '    source: ' + JSON.stringify(source));
    const id = idMatch && idMatch[1];

    eq(
      'the source paragraph carries marker then block ID',
      source,
      '# Team handbook\n\nThe quarterly close lands on the tenth business day. [[Close date|†]] ^' + id + '\n\nExpenses are filed weekly.\n'
    );
    eq(
      'the linknote renders the default template',
      note,
      '---\ncreated: ' + note.match(/created: (.+)/)[1] + '\nsource: "[[Team handbook]]"\n---\n\n' +
        '# Close date\n\n![[Team handbook#^' + id + ']]\n\nConfirmed with Finance.\n'
    );
    check('the other paragraph was left alone', source.includes('\nExpenses are filed weekly.\n'));
  }

  console.log('\n2. legacy settings migrated from a pre-0.6.0 install');
  {
    const src = '運用ルール.md';
    const app = makeApp({ [src]: '# 運用ルール\n\n四半期の締めは翌月 10 営業日目とします。\n' });
    // What a 0.5.0 data.json looked like.
    const p = makePlugin(app, {
      folder: 'Annotations',
      filenamePrefix: '補足',
      noteTag: '補足メモ',
      marker: '†',
      author: 'Tsuneyama',
      useBlockId: true,
      useInlineLink: true,
    });
    await p.loadSettings();

    eq('filenamePrefix became a filename template', p.settings.filenameTemplate, '補足 {{title}} {{date}}');
    eq('date format switched to the vault convention', p.settings.dateFormat, 'YYYY-MM-DD-dddd');
    check('the legacy note template was installed', p.settings.noteTemplate.includes('## 1. 対象箇所[^1]'));
    check('the old tag was carried into the template', p.settings.noteTemplate.includes('  - 補足メモ'));
    check('no placeholder leaked into the template', !p.settings.noteTemplate.includes('__TAG__'));
    check('obsolete keys were dropped', p.settings.filenamePrefix === undefined && p.settings.noteTag === undefined);

    const snap = makeSnapshot(app, src, '四半期の締めは翌月 10 営業日目とします。', 2, 2);
    const file = await p.createLinknote(snap, { title: '締め日の根拠', body: '経理と確認済み。' });
    const note = app._store.get(file.path);

    check('filename keeps the old shape', /^Annotations\/補足 締め日の根拠 \d{4}-\d{2}-\d{2}-[A-Za-z]+\.md$/.test(file.path), '    got: ' + file.path);
    check('frontmatter keeps type', note.startsWith('---\ntype: 補足メモ\n'));
    check('author is still a YAML list', note.includes('author:\n  - Tsuneyama\n'));
    check('the quote callout is intact', note.includes('> [!quote] 選択した文\n> 四半期の締めは翌月 10 営業日目とします。'));
    check('the four sections are present',
      note.includes('## 1. 対象箇所[^1]') && note.includes('## 2. 補足') && note.includes('## 3. 出典') && note.includes('## 4. 変更履歴'));
    check('the footnote carries the block ID', /\[\^1\]: \[\[運用ルール\]\]（ブロック ID `\^[a-z0-9]{6}`）/.test(note));
  }

  console.log('\n3. heading gets its anchor on the following line');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\n## Background\n\nSome text.\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Background', 2, 2);
    await p.createLinknote(snap, { title: 'On the heading', body: 'note' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('heading untouched, anchor below', source, '# Doc\n\n## Background\n\n[[On the heading|†]] ^' + id + '\n\nSome text.\n');
  }

  console.log('\n4. block IDs turned off');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'Only one line here.\n' });
    const p = makePlugin(app, { useBlockId: false });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Only one line here.', 0, 0);
    const file = await p.createLinknote(snap, { title: 'No id', body: 'body text' });
    const note = app._store.get(file.path);
    const source = app._store.get(src);
    eq('no block ID in the source', source, 'Only one line here. [[No id|†]]\n');
    check('no dangling embed line in the note', !note.includes('![['), '    note: ' + JSON.stringify(note));
    eq('no blank run where the embed would be', note,
      '---\ncreated: ' + note.match(/created: (.+)/)[1] + '\nsource: "[[Doc]]"\n---\n\n# No id\n\nbody text\n');
  }

  console.log('\n5. refuses to guess');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'Same text.\n\nSame text.\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Same text.', 0, 0);
    let msg = '';
    try {
      await p.createLinknote(snap, { title: 'x', body: 'y' });
    } catch (e) {
      msg = e.message;
    }
    check('duplicate blocks abort', /ambiguous/.test(msg), '    message: ' + msg);
    eq('the source was not modified', app._store.get(src), 'Same text.\n\nSame text.\n');
  }

  console.log('\n6. an existing block ID is reused, not duplicated');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'A pinned paragraph. ^keepme\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A pinned paragraph.', 0, 0);
    const file = await p.createLinknote(snap, { title: 'Reuse', body: 'b' });
    const source = app._store.get(src);
    eq('the existing ID stays last and is not duplicated', source, 'A pinned paragraph. [[Reuse|†]] ^keepme\n');
    check('the note embeds the existing ID', app._store.get(file.path).includes('![[Doc#^keepme]]'));
  }

  console.log('\n7. name collisions are numbered with a hyphen');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'One.\n\nTwo.\n', 'Linknotes/Same.md': 'x' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const file = await p.createLinknote(makeSnapshot(app, src, 'One.', 0, 0), { title: 'Same', body: 'b' });
    eq('second note gets -2', file.path, 'Linknotes/Same-2.md');
  }

  console.log('\n8. the render context went stale while the composer was open');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nA paragraph to annotate.\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    // Selection captured normally, then the view re-rendered: ctxEl is dead.
    const snap = makeSnapshot(app, src, 'A paragraph to annotate.', 2, 2, { stale: true });
    const file = await p.createLinknote(snap, { title: 'Survives a re-render', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the captured block source is used', source,
      '# Doc\n\nA paragraph to annotate. [[Survives a re-render|†]] ^' + id + '\n');
    check('the linknote was created', !!app._store.get(file.path));
  }

  console.log('\n9. nothing captured and the context is dead: locate by selection');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nFirst one.\n\nA unique paragraph here.\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A unique paragraph here.', 4, 4, { stale: true, noBlockSrc: true });
    await p.createLinknote(snap, { title: 'Fallback', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the containing block was found by text', source,
      '# Doc\n\nFirst one.\n\nA unique paragraph here. [[Fallback|†]] ^' + id + '\n');
  }

  console.log('\n10. every route exhausted: refuse, with an actionable message');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nSomething else entirely.\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'text that is no longer in the file', 2, 2, { stale: true, noBlockSrc: true });
    let msg = '';
    try {
      await p.createLinknote(snap, { title: 'x', body: 'y' });
    } catch (e) {
      msg = e.message;
    }
    check('the message tells the user what to do', /reselect it and retry/.test(msg), '    message: ' + msg);
    eq('the source was not modified', app._store.get(src), '# Doc\n\nSomething else entirely.\n');
  }

  console.log('\n11. a task inside a checklist anchors on that task');
  {
    const src = 'Checklist.md';
    const list = '- [ ] wire up the button\n- [ ] read the settings\n- [ ] ship it';
    const app = makeApp({ [src]: '# Checklist\n\n' + list + '\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    // getSectionInfo() hands back the whole list, as Obsidian really does.
    const snap = makeSnapshot(app, src, 'read the settings', 2, 4);
    await p.createLinknote(snap, { title: 'On the middle task', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the anchor lands on the selected task, not the last one', source,
      '# Checklist\n\n- [ ] wire up the button\n- [ ] read the settings [[On the middle task|†]] ^' + id +
      '\n- [ ] ship it\n');
  }

  console.log('\n12. two identical tasks: refuse rather than pick one');
  {
    const src = 'Checklist.md';
    const app = makeApp({ [src]: '- [ ] same task\n- [ ] same task\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'same task', 0, 1);
    let msg = '';
    try {
      await p.createLinknote(snap, { title: 'x', body: 'y' });
    } catch (e) {
      msg = e.message;
    }
    check('aborts on ambiguity', /ambiguous/.test(msg), '    message: ' + msg);
    eq('the source was not modified', app._store.get(src), '- [ ] same task\n- [ ] same task\n');
  }

  console.log('\n13. a task line containing inline code');
  {
    const src = 'Checklist.md';
    const line = '- [ ] `Annotations/` に `補足 …… 2026-08-12-Wednesday.md` が作られる';
    const list = '- [ ] 段落をドラッグで選ぶと、選択の下に「† Linknote」が出る\n' + line + '\n- [ ] `Esc` で小窓を閉じると、何も作られない';
    const app = makeApp({ [src]: '# Checklist\n\n' + list + '\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    // Reading view strips the backticks from the selection.
    const rendered = 'Annotations/ に 補足 …… 2026-08-12-Wednesday.md が作られる';
    const snap = makeSnapshot(app, src, rendered, 2, 4);
    const file = await p.createLinknote(snap, { title: '保存先の確認', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the anchor lands on the code-span task', source,
      '# Checklist\n\n- [ ] 段落をドラッグで選ぶと、選択の下に「† Linknote」が出る\n' +
      line + ' [[保存先の確認|†]] ^' + id + '\n' +
      '- [ ] `Esc` で小窓を閉じると、何も作られない\n');
    check('the linknote was created', !!app._store.get(file.path));
  }

  console.log('\n14. rendered text with bold, and a dead render context');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nThe **quarterly** close is fixed.\n' });
    const p = makePlugin(app, null);
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'The quarterly close is fixed.', 2, 2, { stale: true, noBlockSrc: true });
    await p.createLinknote(snap, { title: 'Bold fallback', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the normalised fallback found the paragraph', source,
      '# Doc\n\nThe **quarterly** close is fixed. [[Bold fallback|†]] ^' + id + '\n');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
