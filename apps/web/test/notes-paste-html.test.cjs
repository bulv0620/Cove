/**
 * Pasting a code block from Typora (or another CodeMirror-based editor) used to
 * glue every line into one: each line is its own block element with no newline
 * text node between them, and the rich-text import reads `pre.textContent`.
 * `normalizePastedHtml` rewrites those blocks before the editor sees them.
 *
 * This is the only DOM-dependent web test: the pure TS module is transpiled and
 * run in a VM context whose DOM globals come from happy-dom.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Window } = require('happy-dom');

const window = new Window();

function loadPasteHtml() {
  // The module is browser-only, so its globals come from the happy-dom window.
  const context = {
    exports: {},
    console,
    DOMParser: window.DOMParser,
    Node: window.Node,
    DataTransfer: window.DataTransfer,
    ClipboardEvent: window.ClipboardEvent,
    HTMLElement: window.HTMLElement,
  };
  const source = fs.readFileSync(
    path.join(__dirname, '../src/features/notes/paste-html.ts'),
    'utf8',
  );
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  return context.exports;
}

const { normalizePastedHtml, codeLines } = loadPasteHtml();

/** Clipboard HTML, as CodeMirror serializes it: no whitespace between lines. */
const typoraCodeBlock = (codeLines) =>
  `<pre class="md-fences md-end-block ty-contain-cm modeLoaded" spellcheck="false" lang="js">` +
  `<div class="CodeMirror cm-s-inner"><div class="CodeMirror-scroll"><div class="CodeMirror-sizer">` +
  `<div class="CodeMirror-measure"><pre><span>xxxxxxxxxx</span></pre></div>` +
  `<div class="CodeMirror-lines"><div role="presentation" class="CodeMirror-code">` +
  codeLines
    .map(
      (line, index) =>
        `<div role="presentation"><div class="CodeMirror-gutter-wrapper" contenteditable="false">` +
        `<div class="CodeMirror-linenumber CodeMirror-gutter-elt">${index + 1}</div></div>` +
        `<pre class="CodeMirror-line" role="presentation"><span role="presentation">${
          line === '' ? '<br>' : line
        }</span></pre></div>`,
    )
    .join('') +
  `</div></div></div></div></div></pre>`;

/** Text of the first code block in an HTML string. */
const codeOf = (html) =>
  new window.DOMParser().parseFromString(html, 'text/html').querySelector('pre').textContent;

test('block boundaries end a line, explicit breaks keep empty lines', () => {
  assert.equal(
    codeLines([
      { kind: 'text', text: 'const ' },
      { kind: 'text', text: 'a = 1;' },
      { kind: 'end' },
      { kind: 'text', text: 'let b = 2;' },
      { kind: 'end' },
    ]),
    'const a = 1;\nlet b = 2;',
  );
  assert.equal(
    codeLines([
      { kind: 'text', text: 'a' },
      { kind: 'break' },
      { kind: 'break' },
      { kind: 'text', text: 'b' },
      { kind: 'end' },
    ]),
    'a\n\nb',
  );
});

test('blank lines from the surrounding wrappers are dropped', () => {
  assert.equal(
    codeLines([{ kind: 'break' }, { kind: 'end' }, { kind: 'text', text: 'a' }, { kind: 'end' }]),
    'a',
  );
  assert.equal(codeLines([{ kind: 'text', text: 'a' }, { kind: 'break' }, { kind: 'end' }]), 'a');
});

test('a Typora code block keeps one line per line and drops the gutter numbers', () => {
  const html = normalizePastedHtml(
    typoraCodeBlock(['const a = 1;', 'let b = 2;', 'return a + b;']),
  );
  assert.equal(codeOf(html), 'const a = 1;\nlet b = 2;\nreturn a + b;');
});

test('the language survives the rewrite', () => {
  const html = normalizePastedHtml(typoraCodeBlock(['const a = 1;']));
  const pre = new window.DOMParser().parseFromString(html, 'text/html').querySelector('pre');
  assert.equal(pre.getAttribute('data-language'), 'js');
  assert.equal(pre.querySelector('code').className, 'language-js');
});

test('blank lines inside a pasted block survive', () => {
  const html = normalizePastedHtml(typoraCodeBlock(['a', '', 'b']));
  assert.equal(codeOf(html), 'a\n\nb');
});

test('pretty printed markup adds no blank lines and keeps spaces inside a line', () => {
  const html =
    '<pre class="lang-js">\n  <div class="line"><span>const</span> <span>a</span></div>\n' +
    '  <div class="line"><span>let</span> <span>b</span></div>\n</pre>';
  assert.equal(codeOf(normalizePastedHtml(html)), 'const a\nlet b');
});

/** Zero-width space: Typora's placeholder that gives a blank line its height. */
const ZWSP = '\u200b';
/** Soft hyphen: another placeholder some editors leave in copied text. */
const SOFT_HYPHEN = '\u00ad';

/**
 * Real Typora clipboard markup (inline styles trimmed): the lines are inline
 * spans separated by <br>, with no block-level child at all, and indentation is
 * padded with non-breaking spaces. This is the shape that used to be skipped as
 * "already plain" and pasted as a single line.
 */
const typoraBrFence =
  '<pre class="md-fences md-end-block ty-contain-cm modeLoaded" spellcheck="false" lang="typescript" cid="n24" mdtype="fences">' +
  '<span role="presentation"><span class="cm-comment">// 渲染进程修改数据</span></span><br>' +
  '<span role="presentation"><span class="cm-variable">ipcRenderer</span>.<span class="cm-property">send</span>(<span class="cm-string">\'update-list\'</span>, <span class="cm-variable">list</span>)</span><br>' +
  '<span role="presentation"><span cm-text="" cm-zwsp="">' +
  ZWSP +
  '</span></span><br>' +
  '<span role="presentation"><span class="cm-comment">// 主进程收到后广播</span></span><br>' +
  '<span role="presentation"><span class="cm-variable">ipcMain</span>.<span class="cm-property">on</span>(<span class="cm-string">\'update-list\'</span>, (<span class="cm-def">e</span>, <span class="cm-def">list</span>) <span class="cm-operator">=&gt;</span> {</span><br>' +
  '<span role="presentation"> &nbsp;<span class="cm-variable">win</span>.<span class="cm-property">webContents</span>.<span class="cm-property">send</span>(<span class="cm-string">\'list-updated\'</span>, <span class="cm-variable-2">list</span>)</span><br>' +
  '<span role="presentation">})</span></pre>';

test('a <br>-separated Typora fence keeps its lines, blanks and language', () => {
  const html = normalizePastedHtml(typoraBrFence);
  assert.equal(
    codeOf(html),
    '// 渲染进程修改数据\n' +
      "ipcRenderer.send('update-list', list)\n" +
      '\n' +
      '// 主进程收到后广播\n' +
      "ipcMain.on('update-list', (e, list) => {\n" +
      "  win.webContents.send('list-updated', list)\n" +
      '})',
  );
  const pre = new window.DOMParser().parseFromString(html, 'text/html').querySelector('pre');
  assert.equal(pre.getAttribute('data-language'), 'typescript');
});

test('placeholder characters never reach the code text', () => {
  const html =
    '<pre class="lang-js"><span>const a = 1;</span>' +
    '\r<br>' +
    `<span cm-text="" cm-zwsp="">${ZWSP}</span><br>` +
    '<span>' +
    SOFT_HYPHEN +
    'let b = 2;</span></pre>';
  const code = codeOf(normalizePastedHtml(html));
  assert.equal(code, 'const a = 1;\n\nlet b = 2;', 'a placeholder-only line stays a blank line');
  // These are exactly the characters the code editor would draw as boxes.
  // Everything the code editor would draw as a control-character box;
  // tab and newline are real code and survive.
  for (const placeholder of ['\r', '\u0000', ZWSP, SOFT_HYPHEN, '\ufeff']) {
    assert.equal(code.includes(placeholder), false, `removed ${JSON.stringify(placeholder)}`);
  }
  assert.ok(code.includes('\n'), 'line breaks stay');
});

test('a document with front matter and fences survives the rewrite', () => {
  const meta =
    '<pre cid="n0" mdtype="meta_block" class="md-meta-block md-end-block">' +
    'date: 2025-10-12\ntitle: 跨进程同步\ntags:\n  - Electron\n</pre>';
  const html = normalizePastedHtml(`${meta}${typoraBrFence}`);
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  const pres = Array.from(doc.querySelectorAll('pre'));
  assert.equal(pres.length, 2, 'both blocks stay separate');
  assert.equal(pres[0].textContent.includes('title: 跨进程同步'), true);
  assert.equal(pres[1].textContent.split('\n').length, 7);
});

test('the rewrite is idempotent and leaves ordinary HTML alone', () => {
  const once = normalizePastedHtml(typoraCodeBlock(['a', 'b']));
  assert.equal(normalizePastedHtml(once), once);
  const plain = '<p>hello</p><ul><li>one</li></ul>';
  assert.equal(normalizePastedHtml(plain), plain);
  const preOnly = '<pre><code>a\nb</code></pre>';
  assert.equal(normalizePastedHtml(preOnly), preOnly);
});

test('the repaired paste event reaches a listener on the editable element', () => {
  const { repairedPasteEvent } = loadPasteHtml();
  const doc = window.document;
  const section = doc.createElement('section');
  const editable = doc.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  section.appendChild(editable);
  doc.body.appendChild(section);

  // What the editor sees: the handler it registers on its own contenteditable.
  let seen = null;
  editable.addEventListener('paste', (event) => {
    seen = event.clipboardData.getData('text/html');
  });

  const original = new window.DataTransfer();
  original.setData('text/html', typoraBrFence);
  original.setData('text/plain', 'plain flavor');
  const event = new window.ClipboardEvent('paste', {
    clipboardData: original,
    bubbles: true,
    cancelable: true,
  });
  editable.dispatchEvent(event);

  // The capture-phase repair replaces the payload before the editor reads it.
  const repaired = repairedPasteEvent(event);
  assert.notEqual(repaired, null);
  event.preventDefault();
  event.stopPropagation();
  editable.dispatchEvent(repaired);
  assert.equal(seen.split('\n').length, 7);
  assert.equal(
    seen.includes(String.fromCharCode(0xa0)),
    false,
    'non-breaking spaces become real spaces',
  );

  // A payload that needs no repair is left alone, so the paste is never doubled.
  const clean = new window.ClipboardEvent('paste', {
    clipboardData: (() => {
      const transfer = new window.DataTransfer();
      transfer.setData('text/html', '<p>plain</p>');
      return transfer;
    })(),
  });
  assert.equal(repairedPasteEvent(clean), null);
  section.remove();
});

test('the adapter repairs the clipboard payload before the rich text import', () => {
  const editor = fs.readFileSync(
    path.join(__dirname, '../src/features/notes/markdown-editor.tsx'),
    'utf8',
  );
  assert.match(editor, /repairedPasteEvent/);
  assert.match(editor, /addEventListener\('paste', onPaste, true\)/);
  assert.match(editor, /target\.dispatchEvent\(repaired\)/);
  assert.match(editor, /stopPropagation\(\)/);
});

/**
 * Why the repair cannot be dropped now that fences are edited in CodeMirror:
 * the line breaks are lost while the clipboard HTML is converted into a code
 * block node, before any editor renders it, and that conversion reads
 * `pre.textContent`. This runs the editor's real conversion with the CodeMirror
 * plugin registered, exactly as the app configures it.
 */
test('the editor import glues <br>-separated fences unless the payload is repaired', async () => {
  const gurx = await import('@mdxeditor/gurx');
  const MDXEditor = await import('@mdxeditor/editor');
  const lexical = await import('lexical');
  const { createHeadlessEditor } = await import('@lexical/headless');

  const realm = new gurx.Realm();
  for (const plugin of [
    MDXEditor.corePlugin({ initialMarkdown: '' }),
    MDXEditor.codeBlockPlugin(),
    MDXEditor.codeMirrorPlugin({
      codeBlockLanguages: { typescript: 'TypeScript' },
      autoLoadLanguageSupport: false,
    }),
  ]) {
    plugin.init?.(realm);
    plugin.postInit?.(realm);
  }

  const editor = createHeadlessEditor({
    namespace: 'notes-paste-import',
    nodes: realm.getValue(MDXEditor.usedLexicalNodes$),
    onError: () => undefined,
  });

  const imported = (html) => {
    const pre = new window.DOMParser().parseFromString(html, 'text/html').querySelector('pre');
    let node = null;
    editor.update(
      () => {
        node = MDXEditor.$convertPreElement(pre).node;
      },
      { discrete: true },
    );
    return { code: node.getCode(), language: node.getLanguage() };
  };

  const raw = imported(typoraBrFence);
  assert.equal(
    raw.code.includes('\n'),
    false,
    'the raw clipboard payload still collapses into one line',
  );
  assert.ok(raw.code.startsWith('// 渲染进程修改数据'));
  assert.ok(raw.code.endsWith('})'));

  const repaired = imported(normalizePastedHtml(typoraBrFence));
  assert.equal(repaired.code.split('\n').length, 7);
  assert.equal(repaired.language, 'typescript', 'the fence language survives the repair');
});
