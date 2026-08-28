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

/* --------------------------------------------------------------- fake DOM */

/** Just enough of an element for the list rows: no layout, no styling. */
function domNode(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    _classes: new Set(),
    _text: '',
    _attrs: {},
    parentElement: null,
  };
  n.ownerDocument = { createElement: (t) => domNode(t) };
  n.classList = {
    add: (c) => n._classes.add(c),
    remove: (c) => n._classes.delete(c),
    contains: (c) => n._classes.has(c),
  };
  n.appendChild = (k) => {
    if (k.parentElement) {
      const i = k.parentElement.children.indexOf(k);
      if (i !== -1) k.parentElement.children.splice(i, 1);
    }
    k.parentElement = n;
    n.children.push(k);
    return k;
  };
  Object.defineProperty(n, 'firstChild', { get: () => n.children[0] || null });
  n.empty = () => {
    for (const c of n.children) c.parentElement = null;
    n.children.length = 0;
  };
  const made = (t, o) => {
    const d = domNode(t);
    if (o && o.cls) d._classes.add(o.cls);
    if (o && o.text) d._text = o.text;
    return n.appendChild(d);
  };
  n.remove = () => {
    if (!n.parentElement) return;
    const i = n.parentElement.children.indexOf(n);
    if (i !== -1) n.parentElement.children.splice(i, 1);
    n.parentElement = null;
  };
  n.descendants = function* () {
    for (const c of n.children.slice()) {
      yield c;
      yield* c.descendants();
    }
  };
  // Only what the tests need: a single class selector.
  n.querySelectorAll = (sel) => {
    const cls = String(sel).replace(/^\./, '');
    return Array.from(n.descendants()).filter((d) => d._classes.has(cls));
  };
  n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
  n.getAttribute = (k) => (k in n._attrs ? n._attrs[k] : null);
  n.createDiv = (o) => made('div', o);
  n.createEl = (t, o) => made(t, o);
  n.setText = (t) => { n._text = t; };
  n.setAttribute = (k, v) => { n._attrs[k] = v; };
  n.addEventListener = () => {};
  return n;
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

  const trashed = [];

  return {
    _store: store,
    _trashed: trashed,
    _handle: (p) => handles.get(p),
    vault: {
      getAbstractFileByPath: (p) => handles.get(p) || (folders.has(p) ? { path: p, children: [] } : null),
      getMarkdownFiles: () => Array.from(handles.values()),
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
      trashFile: async (f) => {
        if (!store.has(f.path)) throw new Error('no such file: ' + f.path);
        store.delete(f.path);
        handles.delete(f.path);
        trashed.push(f.path);
      },
    },
    workspace: {
      getLeaf: () => ({ openFile: async () => {} }),
    },
    metadataCache: {
      _blocks: new Map(),   // path -> Set of block ids
      _links: new Map(),    // path -> array of link targets, as written
      _fmLinks: new Map(),  // the same, for links written in properties
      _handlers: [],
      getFirstLinkpathDest(target, from) {
        return handles.get(target + '.md') || handles.get(target) || null;
      },
      getFileCache(f) {
        const ids = this._blocks.get(f.path);
        const links = this._links.get(f.path);
        const fmLinks = this._fmLinks.get(f.path);
        if (!ids && !links && !fmLinks) return null;
        const blocks = {};
        for (const id of ids || []) blocks[id] = { id };
        return {
          blocks,
          links: (links || []).map((link) => ({ link })),
          frontmatterLinks: (fmLinks || []).map((link) => ({ link })),
        };
      },
      /** Pretends another note in the vault links somewhere. */
      indexLink(file, target) {
        if (!this._links.has(file.path)) this._links.set(file.path, []);
        this._links.get(file.path).push(target);
      },
      /** The same, for a link written in a property rather than the body. */
      indexFrontmatterLink(file, target) {
        if (!this._fmLinks.has(file.path)) this._fmLinks.set(file.path, []);
        this._fmLinks.get(file.path).push(target);
      },
      on(name, cb) {
        const ref = { name, cb };
        this._handlers.push(ref);
        return ref;
      },
      offref(ref) {
        this._handlers = this._handlers.filter((h) => h !== ref);
      },
      /** Pretends Obsidian finished reindexing the file. */
      indexBlock(file, id) {
        if (!this._blocks.has(file.path)) this._blocks.set(file.path, new Set());
        this._blocks.get(file.path).add(id);
        for (const h of this._handlers.slice()) if (h.name === 'changed') h.cb(file);
      },
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
      : text
          .split('\n')
          .slice(blockLineStart, blockLineEnd + 1)
          .map((line) => line.replace(/\r$/, ''))
          .join('\n'),
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
    const p = makePlugin(app, {});
    await p.loadSettings();

    const snap = makeSnapshot(app, src, 'the tenth business day', 2, 2);
    const { file } = await p.createLinknote(snap, { title: 'Close date', body: 'Confirmed with Finance.' });
    const noteName = file.path.split('/').pop().replace(/\.md$/, '');

    const note = app._store.get(file.path);
    const source = app._store.get(src);

    check('the linknote lands in the default folder', file.path.startsWith('Linknotes/'), '    got: ' + file.path);
    check('filename follows the shipped default',
      /^Linknotes\/Team handbook_[a-z0-9]{6}\.md$/.test(file.path), '    got: ' + file.path);

    const idMatch = source.match(/\^([a-z0-9]{6})/);
    check('a block ID was appended to the source', !!idMatch, '    source: ' + JSON.stringify(source));
    const id = idMatch && idMatch[1];

    eq(
      'the source paragraph carries marker then block ID',
      source,
      '# Team handbook\n\nThe quarterly close lands on the tenth business day. [[' + noteName + '|†]] ^' + id + '\n\nExpenses are filed weekly.\n'
    );
    eq(
      'the linknote renders the default template',
      note,
      '---\ntype: Linknote\ncreated: ' + note.match(/created: (.+)/)[1] + '\nsource: "[[Team handbook#^' + id + ']]"\n' +
        'author:\nselection: |-\n  the tenth business day\nbody: |-\n  Confirmed with Finance.\n---\n' +
        '> [!NOTE]- Close date... [[Team handbook#^' + id + ']]\n> the tenth business day\n' +
        '## Linknote\nConfirmed with Finance.\n'
    );
    check('the other paragraph was left alone', source.includes('\nExpenses are filed weekly.\n'));
  }

  console.log('\n2. a user-supplied template, in any language');
  {
    const src = 'Notes.md';
    const app = makeApp({ [src]: '# Notes\n\nThe close is the tenth business day.\n' });
    // Any layout the user pastes into the setting, here a multi-section one.
    const template = [
      '---',
      'type: linknote',
      'tags:',
      '  - linknote',
      'created: {{date}}',
      'author:',
      '  - {{author}}',
      'source: "{{source}}"',
      '---',
      '',
      '# Note on {{sourceName}}: {{title}}',
      '',
      '## 1. Context',
      '',
      '{{embed}}',
      '',
      '> [!quote] Selected text',
      '{{selectionQuote}}',
      '',
      '## 2. Note',
      '',
      '{{body}}',
      '',
    ].join('\n');
    const p = makePlugin(app, {
      folder: 'Refs',
      filenameTemplate: 'ref {{title}} {{date}}',
      dateFormat: 'YYYY-MM-DD-dddd',
      author: 'A. Reader',
      noteTemplate: template,
    });
    await p.loadSettings();

    const snap = makeSnapshot(app, src, 'The close is the tenth business day.', 2, 2);
    const { file } = await p.createLinknote(snap, { title: 'why the tenth', body: 'Confirmed.' });
    const note = app._store.get(file.path);

    check('the filename template is honoured',
      /^Refs\/ref why the tenth \d{4}-\d{2}-\d{2}-[A-Za-z]+\.md$/.test(file.path), '    got: ' + file.path);
    check('frontmatter comes from the template', note.startsWith('---\ntype: linknote\n'));
    check('author is rendered as a YAML list', note.includes('author:\n  - A. Reader\n'));
    check('the heading mixes variables', note.includes('# Note on Notes: why the tenth'));
    check('the quote callout is filled',
      note.includes('> [!quote] Selected text\n> The close is the tenth business day.'));
    check('the body landed in its section', note.includes('## 2. Note\n\nConfirmed.'));
  }

  console.log('\n3. a heading is referenced by its anchor, not a block ID');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\n## Background\n\nSome text.\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Background', 2, 2);
    const result = await p.createLinknote(snap, { title: 'On the heading', body: 'note' });
    const source = app._store.get(src);
    const note = app._store.get(result.file.path);

    eq('the heading text is untouched and no block ID is added', source,
      '# Doc\n\n## Background\n\n[[On the heading|†]]\n\nSome text.\n');
    check('no block ID was generated', result.blockId === '', '    got: ' + JSON.stringify(result.blockId));
    eq('the heading is reported back', result.headingText, 'Background');
    // Deliberately a link, not an embed: ![[Doc#Background]] would pull in the
    // whole section, which for a top-level heading is most of the note.
    check('the linknote links to the heading', note.includes('[[Doc#Background]]'),
      '    note: ' + note);
    check('the heading section is not embedded', !note.includes('![[Doc#Background]]'),
      '    note: ' + note);
    check('nothing points at a block ID', !note.includes('#^'), '    note: ' + note);
  }

  console.log('\n3.2 {{sourceBlock}} points at the anchored spot');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'Only one line here.\n\nAnd another.\n' });
    const p = makePlugin(app, {
      filenameTemplate: '{{title}}',
      noteTemplate: 'from: {{sourceBlock}}\nnote: {{source}}\n',
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Only one line here.', 0, 0);
    const result = await p.createLinknote(snap, { title: 'Anchored', body: '' });
    const note = app._store.get(result.file.path);

    check('it links to the block, not just the note',
      note.includes('from: [[Doc#^' + result.blockId + ']]'), '    note: ' + note);
    check('it is a link, not an embed', !note.includes('!\[\[Doc#^'), '    note: ' + note);
    check('{{source}} still points at the note as a whole',
      note.includes('note: [[Doc]]'), '    note: ' + note);
  }

  console.log('\n3.3 {{sourceBlock}} falls back to the note when there is no anchor');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'Only one line here.\n' });
    const p = makePlugin(app, {
      useBlockId: false,
      filenameTemplate: '{{title}}',
      noteTemplate: 'from: {{sourceBlock}}\n',
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Only one line here.', 0, 0);
    const { file } = await p.createLinknote(snap, { title: 'No anchor', body: '' });
    const note = app._store.get(file.path);
    check('the note link is used instead of an empty value',
      note.includes('from: [[Doc]]'), '    note: ' + note);
  }

  console.log('\n3.4 {{sourceBlock}} on a heading uses the heading anchor');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\n## Background\n\nSome text.\n' });
    const p = makePlugin(app, {
      filenameTemplate: '{{title}}',
      noteTemplate: 'from: {{sourceBlock}}\n',
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Background', 2, 2);
    const { file } = await p.createLinknote(snap, { title: 'Heading anchor', body: '' });
    const note = app._store.get(file.path);
    check('it links to the heading', note.includes('from: [[Doc#Background]]'), '    note: ' + note);
  }

  console.log('\n3.1 a heading that already carries a block ID');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\n## Background ^leftover\n\nSome text.\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Background', 2, 2);
    const result = await p.createLinknote(snap, { title: 'Reuse heading', body: 'b' });
    const note = app._store.get(result.file.path);
    eq('the stray ID is not treated as the anchor', result.headingText, 'Background');
    check('the reference still uses the heading', note.includes('[[Doc#Background]]'), '    note: ' + note);
    check('and is still a link rather than an embed', !note.includes('![[Doc#Background]]'), '    note: ' + note);
  }

  console.log('\n4. block IDs turned off');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'Only one line here.\n' });
    const p = makePlugin(app, {
      useBlockId: false,
      filenameTemplate: '{{title}}',
      noteTemplate: require(path.join(__dirname, '..', 'main.js')).EMBED_NOTE_TEMPLATE,
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Only one line here.', 0, 0);
    const { file } = await p.createLinknote(snap, { title: 'No id', body: 'body text' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
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
    const p = makePlugin(app, {
      filenameTemplate: '{{title}}',
      noteTemplate: require(path.join(__dirname, '..', 'main.js')).EMBED_NOTE_TEMPLATE,
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A pinned paragraph.', 0, 0);
    const { file } = await p.createLinknote(snap, { title: 'Reuse', body: 'b' });
    const source = app._store.get(src);
    eq('the existing ID stays last and is not duplicated', source, 'A pinned paragraph. [[Reuse|†]] ^keepme\n');
    check('the note embeds the existing ID', app._store.get(file.path).includes('![[Doc#^keepme]]'));
  }

  console.log('\n7. name collisions are numbered with a hyphen');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'One.\n\nTwo.\n', 'Linknotes/Same.md': 'x' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const { file } = await p.createLinknote(makeSnapshot(app, src, 'One.', 0, 0), { title: 'Same', body: 'b' });
    eq('second note gets -2', file.path, 'Linknotes/Same-2.md');
  }

  console.log('\n8. the render context went stale while the composer was open');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nA paragraph to annotate.\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    // Selection captured normally, then the view re-rendered: ctxEl is dead.
    const snap = makeSnapshot(app, src, 'A paragraph to annotate.', 2, 2, { stale: true });
    const { file } = await p.createLinknote(snap, { title: 'Survives a re-render', body: 'b' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    // Reading view strips the backticks from the selection.
    const rendered = 'Annotations/ に 補足 …… 2026-08-12-Wednesday.md が作られる';
    const snap = makeSnapshot(app, src, rendered, 2, 4);
    const { file } = await p.createLinknote(snap, { title: '保存先の確認', body: 'b' });
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
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'The quarterly close is fixed.', 2, 2, { stale: true, noBlockSrc: true });
    await p.createLinknote(snap, { title: 'Bold fallback', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the normalised fallback found the paragraph', source,
      '# Doc\n\nThe **quarterly** close is fixed. [[Bold fallback|†]] ^' + id + '\n');
  }

  console.log('\n15. a long selection with no title keeps the date in the filename');
  {
    const src = 'Doc.md';
    const selection = '保存先のフォルダ名と日付の書式をもう一度確認し、必要であれば設定を初期値に戻してからお試しください。';
    const app = makeApp({ [src]: '# Doc\n\n' + selection + '\n' });
    const p = makePlugin(app, {
      folder: 'Annotations',
      filenameTemplate: '補足 {{title}} {{date}}',
      dateFormat: 'YYYY-MM-DD-dddd',
      // The embed preset keeps {{title}} whole, which is what this checks.
      noteTemplate: require(path.join(__dirname, '..', 'main.js')).EMBED_NOTE_TEMPLATE,
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, selection, 2, 2);
    const { file } = await p.createLinknote(snap, { title: '', body: 'b' });

    check('the filename ends with a whole date',
      /\d{4}-\d{2}-\d{2}-[A-Za-z]+\.md$/.test(file.path), '    got: ' + file.path);
    check('the filename stays within the byte budget',
      Buffer.byteLength(file.path.split('/').pop(), 'utf8') <= 185, '    got: ' + file.path);
    const note = app._store.get(file.path);
    check('the note heading keeps the full sentence', note.includes('# ' + selection),
      '    note: ' + note.slice(0, 200));
  }

  console.log('\n16. opening waits for the cache to know the block');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nA paragraph.\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A paragraph.', 2, 2);
    const result = await p.createLinknote(snap, { title: 'Wait', body: 'b' });

    check('the result carries what opening needs',
      !!(result.file && result.sourceFile && result.blockId), '    got: ' + JSON.stringify(Object.keys(result)));

    // The cache does not know the block yet, so the wait must not return early.
    let resolved = false;
    const waiting = p.waitForBlock(result.sourceFile, result.blockId, 3000).then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    check('it is still waiting while the cache is behind', resolved === false);

    app.metadataCache.indexBlock(result.sourceFile, result.blockId);
    await waiting;
    check('it resolves once the block is indexed', resolved === true);
    check('the listener was removed', app.metadataCache._handlers.length === 0,
      '    handlers left: ' + app.metadataCache._handlers.length);
  }

  console.log('\n17. a missed cache event cannot hang the open');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nA paragraph.\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A paragraph.', 2, 2);
    const result = await p.createLinknote(snap, { title: 'Timeout', body: 'b' });

    const started = Date.now();
    await p.waitForBlock(result.sourceFile, result.blockId, 60); // event never fires
    const waited = Date.now() - started;
    check('it gives up after the timeout', waited >= 55 && waited < 1000, '    waited: ' + waited + 'ms');
  }

  console.log('\n18. no block ID means nothing to wait for');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'One line.\n' });
    const p = makePlugin(app, { useBlockId: false, filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'One line.', 0, 0);
    const result = await p.createLinknote(snap, { title: 'No id', body: 'b' });
    eq('blockId is empty', result.blockId, '');
    const started = Date.now();
    await p.waitForBlock(result.sourceFile, result.blockId, 5000);
    check('it returns immediately', Date.now() - started < 50);
  }

  console.log('\n19. a list item with bold and a same-note heading link');
  {
    const src = 'Check.md';
    const item = '- [ ] **Bold and a link** → works（[[#4.4 Inline markup]] recheck）';
    const list = '- [x] plain item\n' + item + '\n- [x] another item';
    const app = makeApp({ [src]: '# Check\n\n' + list + '\n\n## 4.4 Inline markup\n\ntext\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    // Rendered text: the emphasis is gone and the heading link lost its hash.
    const rendered = 'Bold and a link → works（4.4 Inline markup recheck）';
    const snap = makeSnapshot(app, src, rendered, 2, 4);
    const result = await p.createLinknote(snap, { title: 'Bold case', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the anchor lands on that item', source,
      '# Check\n\n- [x] plain item\n' + item + ' [[Bold case|†]] ^' + id +
      '\n- [x] another item\n\n## 4.4 Inline markup\n\ntext\n');
    check('the linknote was created', !!app._store.get(result.file.path));
  }

  console.log('\n3.5 {{anchor}} names a heading linknote after the heading');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\n## Background\n\nSome text.\n\n## Later\n\nMore.\n' });
    const p = makePlugin(app, {});
    await p.loadSettings();

    const first = await p.createLinknote(makeSnapshot(app, src, 'Background', 2, 2), { title: 'a', body: 'x' });
    // The first write inserted a marker line, so the second heading has moved.
    const at = app._store.get(src).split('\n').indexOf('## Later');
    const second = await p.createLinknote(makeSnapshot(app, src, 'Later', at, at), { title: 'b', body: 'y' });

    eq('the first is named after its heading', first.file.path, 'Linknotes/Doc_Background.md');
    eq('the second gets its own name, not a -2 suffix', second.file.path, 'Linknotes/Doc_Later.md');
  }

  console.log('\n3.6 {{anchor}} is the block ID when there is one');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'A paragraph to annotate.\n' });
    const p = makePlugin(app, {});
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A paragraph to annotate.', 0, 0);
    const result = await p.createLinknote(snap, { title: 'a', body: 'x' });
    eq('the block ID is used', result.file.path, 'Linknotes/Doc_' + result.blockId + '.md');
  }

  console.log('\n21. the callout preset keeps a multi-line note inside the callout');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: 'A paragraph to annotate.\n' });
    const p = makePlugin(app, {
      noteTemplate: require(path.join(__dirname, '..', 'main.js')).CALLOUT_NOTE_TEMPLATE,
    });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A paragraph to annotate.', 0, 0);
    const { file } = await p.createLinknote(snap, {
      title: 'Three lines',
      body: 'first line\nsecond line\nthird line',
    });
    const note = app._store.get(file.path);
    const lines = note.split('\n');
    const at = lines.findIndex((l) => l.startsWith('> [!NOTE]'));
    check('the callout opens', at !== -1, '    note: ' + note);
    check('every line of the note is inside it',
      lines[at + 1] === '> first line' && lines[at + 2] === '> second line' && lines[at + 3] === '> third line',
      '    note: ' + note);
  }

  console.log('\n22. a long title is shortened in the callout but not in the note body');
  {
    const src = 'Doc.md';
    const long = 'The quarterly close lands on the tenth business day of the month';
    const app = makeApp({ [src]: 'A paragraph to annotate.\n' });
    const p = makePlugin(app, { noteTemplate: '{{titleShort}}\n---\n{{title}}\n' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A paragraph to annotate.', 0, 0);
    const { file } = await p.createLinknote(snap, { title: long, body: '' });
    const note = app._store.get(file.path);
    const [short, , full] = note.split('\n');
    check('the short form ends in an ellipsis', short.endsWith('…'), '    got: ' + short);
    check('the short form stays within 31 characters', short.length <= 31, '    got: ' + short);
    eq('the full title is untouched', full, long);
  }

  console.log('\n20. a paragraph with bold and a wikilink, context lost');
  {
    const src = 'Doc.md';
    const para = 'The **quarterly** close follows [[Team handbook]] exactly.';
    const app = makeApp({ [src]: '# Doc\n\n' + para + '\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const rendered = 'The quarterly close follows Team handbook exactly.';
    const snap = makeSnapshot(app, src, rendered, 2, 2, { stale: true, noBlockSrc: true });
    await p.createLinknote(snap, { title: 'Bold para', body: 'b' });
    const source = app._store.get(src);
    const id = source.match(/\^([a-z0-9]{6})/)[1];
    eq('the paragraph was found and anchored', source,
      '# Doc\n\n' + para + ' [[Bold para|†]] ^' + id + '\n');
  }

  console.log('\n25. removing a linknote puts the source back as it was');
  {
    const src = 'Team handbook.md';
    const before = '# Team handbook\n\nWe review the roster every quarter.\n';
    const app = makeApp({ [src]: before });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'roster', 2, 2);
    const made = await p.createLinknote(snap, { title: 'Roster', body: 'why quarterly' });

    check('the source carries a marker first', app._store.get(src) !== before);
    const plan = await p.planRemoval(made.sourceFile, made.file);
    check('a plan was made', plan.ok === true, '    reason: ' + plan.reason);
    check('the block ID goes too, nothing else points at it', plan.dropBlockId === true);
    const done = await p.applyRemoval(plan);
    check('the removal reported success', done === true);
    eq('the source reads exactly as it did', app._store.get(src), before);
    eq('the note was trashed', app._trashed[0], made.file.path);
    check('the note is gone from the vault', !app._store.has(made.file.path));
  }

  console.log('\n26. a block ID another note points at is left alone');
  {
    const src = 'Team handbook.md';
    const other = 'Elsewhere.md';
    const before = '# Team handbook\n\nWe review the roster every quarter.\n';
    const app = makeApp({ [src]: before, [other]: 'See [[Team handbook#^keepme]].\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'roster', 2, 2);
    const made = await p.createLinknote(snap, { title: 'Roster', body: 'why quarterly' });
    const id = app._store.get(src).match(/\^([a-z0-9]{6})/)[1];
    app.metadataCache.indexLink(app._handle(other), 'Team handbook#^' + id);

    const plan = await p.planRemoval(made.sourceFile, made.file);
    check('a plan was made', plan.ok === true, '    reason: ' + plan.reason);
    check('the block ID stays', plan.dropBlockId === false);
    await p.applyRemoval(plan);
    eq('the line keeps its ID and loses only the marker', app._store.get(src),
      '# Team handbook\n\nWe review the roster every quarter. ^' + id + '\n');
  }

  console.log('\n27. two markers for the same note: refuse rather than guess');
  {
    const src = 'Doc.md';
    const app = makeApp({
      [src]: 'One [[Side note|†]] here.\n\nTwo [[Side note|†]] there.\n',
      'Linknotes/Side note.md': '# Side note\n',
    });
    const p = makePlugin(app, {});
    await p.loadSettings();
    const plan = await p.planRemoval(app._handle(src), app._handle('Linknotes/Side note.md'));
    check('the plan refuses', plan.ok === false);
    eq('and says why', plan.reason, 'ambiguous');
    check('nothing was trashed', app._trashed.length === 0);
  }

  console.log('\n28. the source changed while the confirmation was open');
  {
    const src = 'Doc.md';
    const app = makeApp({
      [src]: 'One [[Side note|†]] here.\n',
      'Linknotes/Side note.md': '# Side note\n',
    });
    const p = makePlugin(app, {});
    await p.loadSettings();
    const plan = await p.planRemoval(app._handle(src), app._handle('Linknotes/Side note.md'));
    check('a plan was made', plan.ok === true, '    reason: ' + plan.reason);
    app._store.set(src, 'One [[Side note|†]] here, edited.\n');
    const done = await p.applyRemoval(plan);
    check('the removal declined', done === false);
    eq('the edit survives untouched', app._store.get(src), 'One [[Side note|†]] here, edited.\n');
    check('nothing was trashed', app._trashed.length === 0);
  }

  console.log('\n29. the list: no doubled rows, and every row headed marker, author, date');
  {
    const render = LinknotePlugin.prototype.renderLinknoteRows;
    const target = domNode('div');
    const entries = [1, 2, 3].map((i) => ({
      file: { basename: 'N' + i, path: 'Linknotes/N' + i + '.md' },
      passage: 'passage ' + i,
      blockId: 'b' + i,
      marker: '📱',
    }));
    // Reading a linknote yields, which is where the two draws interleaved.
    const ctx = {
      app: { workspace: { openLinkText() {} } },
      readLinknote: async (f) => {
        await new Promise((r) => setTimeout(r, 1));
        return { author: 'A. Reader', created: '2026-08-17', text: 'body of ' + f.basename };
      },
      confirmRemoval() {},
    };
    const source = { path: 'Doc.md', basename: 'Doc' };

    await Promise.all([
      render.call(ctx, target, source, entries),
      render.call(ctx, target, source, entries),
    ]);
    eq('three linknotes make three rows, not six', target.children.length, 3);

    // Marker, then who and when: a row is headed like a card.
    const head = target.children[0].children[0];
    check('the row is headed by its marker', head.children[0]._classes.has('lkn-list-mark'));
    eq('and the marker is the one the link carries', head.children[0]._text, '📱');
    check('then who and when', head.children[1]._classes.has('lkn-list-meta'));
    eq('who and when, in that order', head.children[1]._text, 'A. Reader · 2026-08-17');

    // A linknote written without a marker alias simply has no first cell.
    await render.call(ctx, target, source, [{ file: entries[0].file, passage: 'p', blockId: 'b' }]);
    const bare = target.children[0].children[0];
    check('no marker, no cell for one', !bare.children[0]._classes.has('lkn-list-mark'));

    // And an empty result replaces the rows rather than adding to them.
    await render.call(ctx, target, source, []);
    eq('the empty message stands alone', target.children.length, 1);
    check('and it is the empty message', target.children[0]._classes.has('lkn-list-empty'));
  }

  console.log('\n30. a block ID a linknote references from its properties is kept');
  {
    const src = 'Team handbook.md';
    const before = '# Team handbook\n\nWe review the roster every quarter.\n';
    const app = makeApp({ [src]: before });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'roster', 2, 2);
    const made = await p.createLinknote(snap, { title: 'Roster', body: 'why quarterly' });
    const id = app._store.get(src).match(/\^([a-z0-9]{6})/)[1];

    // A second linknote on the same block, written from a template that puts
    // the reference in a property and nowhere else.
    const other = await app.vault.create('Linknotes/Second.md',
      '---\nsource: "[[Team handbook#^' + id + ']]"\n---\n');
    app.metadataCache.indexFrontmatterLink(other, 'Team handbook#^' + id);

    const plan = await p.planRemoval(made.sourceFile, made.file);
    check('a plan was made', plan.ok === true, '    reason: ' + plan.reason);
    check('the block ID stays, because a property still points at it', plan.dropBlockId === false);
  }

  console.log('\n31. a block ID on its own line is not destroyed');
  {
    const src = 'Doc.md';
    const before = '# Doc\n\nA pinned paragraph.\n^keepme\n\nSomething else.\n';
    const app = makeApp({ [src]: before });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'A pinned paragraph.', 2, 3);
    const made = await p.createLinknote(snap, { title: 'Pinned', body: 'b' });

    eq('the marker goes on the text and the ID stays where it was',
      app._store.get(src),
      '# Doc\n\nA pinned paragraph. [[Pinned|†]]\n^keepme\n\nSomething else.\n');
    eq('and the existing ID is the one referenced', made.blockId, 'keepme');
    check('the linknote points at it', app._store.get(made.file.path).includes('#^keepme'));
  }

  console.log('\n32. a stale selection cannot be anchored twice');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\nThe paragraph to annotate.\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();

    // The same snapshot used twice, as the float button does when the
    // selection has gone: after the first write its blockSrc is stale.
    const snap = makeSnapshot(app, src, 'The paragraph to annotate.', 2, 2);
    await p.createLinknote(snap, { title: 'First', body: 'a' });
    const afterFirst = app._store.get(src);

    let failed = '';
    try {
      await p.createLinknote(snap, { title: 'Second', body: 'b' });
    } catch (e) {
      failed = String(e.message || e);
    }
    check('the second attempt is refused', !!failed, '    got no error');
    check('and says the note has changed', failed.indexOf('changed') !== -1, '    got: ' + failed);
    eq('the source is exactly as the first write left it', app._store.get(src), afterFirst);
  }

  console.log('\n33. a heading written straight above its list');
  {
    const src = 'Doc.md';
    const app = makeApp({ [src]: '# Doc\n\n## Background\n1. first\n2. second\n' });
    const p = makePlugin(app, { filenameTemplate: '{{title}}' });
    await p.loadSettings();
    const snap = makeSnapshot(app, src, 'Background', 2, 2);
    await p.createLinknote(snap, { title: 'On the heading', body: 'b' });

    eq('the marker sits alone, with a blank line on either side',
      app._store.get(src),
      '# Doc\n\n## Background\n\n[[On the heading|†]]\n\n1. first\n2. second\n');
  }

  console.log('\n34. two copies of one list item get one card between them');
  {
    const view = domNode('div');
    const make = (path) => {
      const li = view.createDiv({ cls: 'lkn-has-card' });
      const stack = li.createDiv({ cls: 'lkn-card-stack' });
      const card = stack.createDiv({ cls: 'lkn-card' });
      card.setAttribute('data-lkn-path', path);
      return { li, stack, card };
    };
    // What the Tasks plugin leaves behind: the same item rendered twice.
    const first = make('Linknotes/A.md');
    const second = make('Linknotes/A.md');
    const other = make('Linknotes/B.md');

    const p = makePlugin(makeApp({}), {});
    await p.loadSettings();
    p.dedupeCards(view);

    eq('one card is left for the repeated linknote',
      view.querySelectorAll('lkn-card').filter((c) => c.getAttribute('data-lkn-path') === 'Linknotes/A.md').length, 1);
    check('the first one is the one kept', first.card.parentElement === first.stack);
    check('the second stack went with its card', second.stack.parentElement === null);
    check('and its host is no longer marked', !second.li._classes.has('lkn-has-card'));
    check('a different linknote is untouched', other.card.parentElement === other.stack);
  }

  console.log('\n35. a note saved with CRLF line endings');
  {
    // The hazard is the first write to such a note: nothing has rewritten it
    // yet, so the carriage returns are still there when the marker goes in.
    const src = 'Windows handbook.md';
    const crlf =
      '# Handbook\r\n' +
      '\r\n' +
      'The quarterly close lands on the tenth business day. ^oldid\r\n' +
      '\r\n' +
      'Expenses are filed weekly.\r\n' +
      '\r\n' +
      'A paragraph with no ID of its own.\r\n';
    const app = makeApp({ [src]: crlf });
    const p = makePlugin(app, {});
    await p.loadSettings();

    const snap = makeSnapshot(app, src, 'the tenth business day', 2, 2);
    const { file } = await p.createLinknote(snap, { title: 'Close date', body: 'Confirmed.' });
    const noteName = file.path.split('/').pop().replace(/\.md$/, '');
    const source = app._store.get(src);

    const ids = source.match(/\^[A-Za-z0-9-]+/g) || [];
    eq('the existing block ID is the only one', ids.length, 1);
    eq('and it is still the one that was there', ids[0], '^oldid');
    check(
      'the linknote is named after the ID it found',
      file.path.endsWith('_oldid.md'),
      '    got: ' + file.path
    );
    eq(
      'the marker goes in front of the ID it kept',
      source.split('\r\n')[2],
      'The quarterly close lands on the tenth business day. [[' + noteName + '|†]] ^oldid'
    );
    eq('the note is still CRLF throughout', /[^\r]\n/.test(source), false);
    check('every other line is untouched', source.includes('\r\nExpenses are filed weekly.\r\n'));

    // And a paragraph with no ID of its own still gets a new one.
    const snap2 = makeSnapshot(app, src, 'no ID of its own', 6, 6);
    const second = await p.createLinknote(snap2, { title: 'Second', body: 'Also confirmed.' });
    const after = app._store.get(src);
    const allIds = after.match(/\^[A-Za-z0-9-]+/g) || [];
    eq('a second linknote adds exactly one more ID', allIds.length, 2);
    eq('the first one is untouched', allIds[0], '^oldid');
    eq('and the note is still CRLF', /[^\r]\n/.test(after), false);
    check(
      'the second marker landed on its own paragraph',
      after.split('\r\n')[6].startsWith('A paragraph with no ID of its own. [['),
      '    got: ' + JSON.stringify(after.split('\r\n')[6])
    );
    check('the second linknote exists', !!app._store.get(second.file.path));
  }

  console.log('\n36. removing a linknote from a CRLF note');
  {
    const src = 'Windows handbook.md';
    const app = makeApp({
      [src]:
        '# Handbook\r\n\r\nThe close lands on the tenth. ^keepme\r\n\r\nTail.\r\n',
    });
    const p = makePlugin(app, {});
    await p.loadSettings();

    const snap = makeSnapshot(app, src, 'the tenth', 2, 2);
    const { file } = await p.createLinknote(snap, { title: 'Close', body: 'Confirmed.' });

    const plan = await p.planRemoval(app.vault.getAbstractFileByPath(src), app.vault.getAbstractFileByPath(file.path));
    check('a plan can be made', plan.ok, '    reason: ' + plan.reason);
    if (plan.ok) {
      // Nothing else in this vault points at ^keepme, so it goes with the
      // marker — even though it was in the note before Linknote saw it. The
      // dialog says so, and now shows the line it is about to change.
      eq('an unreferenced block ID goes with the marker', plan.dropBlockId, true);
      const line = LinknotePlugin.changedLine
        ? LinknotePlugin.changedLine(plan.before, plan.after)
        : require(path.join(__dirname, '..', 'main.js')).changedLine(plan.before, plan.after);
      eq('the line shown carries no carriage return', /\r/.test(line.was + line.now), false);
      await p.applyRemoval(plan);
      const back = app._store.get(src);
      eq(
        'the marker is gone and the line endings are intact',
        back,
        '# Handbook\r\n\r\nThe close lands on the tenth.\r\n\r\nTail.\r\n'
      );
      eq('with no line left in LF', /[^\r]\n/.test(back), false);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
