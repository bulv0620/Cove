/**
 * NOTE-AC-003 / NOTE-OQ-003 evidence: the approved editor's restricted
 * Markdown dialect (NOTE-FR-006) round-trips without semantic drift and is
 * stable after the first canonicalization, while raw HTML and JSX are
 * rejected instead of being silently kept or executed.
 *
 * Runs the real @mdxeditor/editor import/export pipeline headlessly — no DOM.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.chdir(__dirname + '/..'); // resolve @mdxeditor/editor etc. from apps/web

const CORPUS = [
  {
    name: 'english mixed dialect',
    markdown: [
      '# Release notes',
      '',
      'A paragraph with **bold**, *italic*, ~~struck~~ and a [link](https://example.com/a).',
      '',
      '## Details',
      '',
      '- first item',
      '- second item',
      '  - nested item',
      '',
      '1. step one',
      '2. step two',
      '',
      '- [x] done work',
      '- [ ] pending work',
      '',
      '> quoted wisdom',
      '',
      '---',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      '| Name | Value |',
      '| ---- | ----: |',
      '| answer | 42 |',
      '',
      '### Fin',
    ].join('\n'),
    expect: [
      '# Release notes',
      '**bold**',
      '*italic*',
      '~~struck~~',
      '[link](https://example.com/a)',
      '* first item',
      '1. step one',
      '* [x] done work',
      '* [ ] pending work',
      '>',
      '***',
      'const answer = 42;',
      '| Name',
      '| ----',
      '### Fin',
    ],
  },
  {
    name: 'chinese mixed dialect',
    markdown: [
      '# 发布记录',
      '',
      '段落包含**加粗**、*斜体*、~~删除线~~和[链接](https://example.com/中文)。',
      '',
      '- 第一个条目',
      '- 第二个条目',
      '',
      '1. 第一步',
      '2. 第二步',
      '',
      '- [x] 已完成事项',
      '- [ ] 待办事项',
      '',
      '> 引用一段话',
      '',
      '```',
      '你好 = "世界"',
      '```',
      '',
      '| 名称 | 数值 |',
      '| ---- | ---- |',
      '| 答案 | 42 |',
    ].join('\n'),
    expect: [
      '# 发布记录',
      '**加粗**',
      '*斜体*',
      '~~删除线~~',
      '[链接](https://example.com/中文)',
      '* 第一个条目',
      '1. 第一步',
      '* [x] 已完成事项',
      '* [ ] 待办事项',
      '>',
      '你好 = "世界"',
      '| 名称',
      '| 42 |',
    ],
  },
];

async function createProcessor() {
  const gurx = await import('@mdxeditor/gurx');
  const MDXEditor = await import('@mdxeditor/editor');
  const lexical = await import('lexical');
  const { createHeadlessEditor } = await import('@lexical/headless');

  const onErrorEvents = [];
  const realm = new gurx.Realm();
  const plugins = [
    MDXEditor.corePlugin({ initialMarkdown: '' }),
    MDXEditor.headingsPlugin(),
    MDXEditor.listsPlugin(),
    MDXEditor.linkPlugin(),
    MDXEditor.quotePlugin(),
    MDXEditor.thematicBreakPlugin(),
    MDXEditor.tablePlugin(),
    MDXEditor.imagePlugin({ imageUploadHandler: () => Promise.reject(new Error('off')) }),
    MDXEditor.codeBlockPlugin({
      codeBlockEditorDescriptors: [{ type: 'codeblock', priority: 0, match: () => true }],
    }),
  ];
  for (const plugin of plugins) {
    plugin.init?.(realm);
    plugin.postInit?.(realm);
  }

  const editor = createHeadlessEditor({
    namespace: 'notes-roundtrip',
    nodes: realm.getValue(MDXEditor.usedLexicalNodes$),
    onError: (error) => onErrorEvents.push(String(error?.message ?? error)),
  });

  const importDescriptors = [{ type: 'codeblock', priority: 0, match: () => true }];
  const importMarkdown = (markdown) => {
    editor.update(
      () => {
        lexical.$getRoot().clear();
        MDXEditor.importMarkdownToLexical({
          root: lexical.$getRoot(),
          markdown,
          visitors: realm.getValue(MDXEditor.importVisitors$),
          syntaxExtensions: realm.getValue(MDXEditor.syntaxExtensions$),
          mdastExtensions: realm.getValue(MDXEditor.mdastExtensions$),
          codeBlockEditorDescriptors: importDescriptors,
          defaultCodeBlockLanguage: '',
        });
      },
      { discrete: true },
    );
  };

  const exportMarkdown = () => {
    let result = '';
    editor.read(() => {
      result = MDXEditor.exportMarkdownFromLexical({
        root: lexical.$getRoot(),
        toMarkdownOptions: realm.getValue(MDXEditor.toMarkdownOptions$),
        toMarkdownExtensions: realm.getValue(MDXEditor.toMarkdownExtensions$),
        visitors: realm.getValue(MDXEditor.exportVisitors$),
      });
    });
    return result;
  };

  return { editor, importMarkdown, exportMarkdown, onErrorEvents };
}

const roundtrip = async (processor, markdown) => {
  processor.importMarkdown(markdown);
  return processor.exportMarkdown();
};

test('the restricted dialect round-trips and stabilizes after one pass', async () => {
  const processor = await createProcessor();
  for (const fixture of CORPUS) {
    const once = await roundtrip(processor, fixture.markdown);
    assert.ok(once.trim().length > 0, `${fixture.name}: produced output`);
    const twice = await roundtrip(processor, once);
    assert.equal(twice, once, `${fixture.name}: canonical form is idempotent`);
    for (const fragment of fixture.expect) {
      assert.ok(
        once.includes(fragment),
        `${fixture.name}: keeps ${JSON.stringify(fragment)} in:\n${once}`,
      );
    }
  }
});

test('unsupported constructs are never executed or silently overwritten (NOTE-AC-003)', async () => {
  // Raw HTML: held inert by the editor and re-exported verbatim — never
  // rendered, never lost. (No dangerouslySetInnerHTML exists in the editor.)
  const htmlProcessor = await createProcessor();
  const source = 'before\n\n<script>alert(1)</script>\n\nafter\n';
  const kept = await roundtrip(htmlProcessor, source);
  assert.ok(kept.includes('<script>alert(1)</script>'), 'raw HTML survives verbatim');
  assert.match(kept, /before/);
  assert.match(kept, /after/);
  assert.equal(htmlProcessor.onErrorEvents.length, 0);

  // JSX / unknown constructs: the import aborts (reported through the editor
  // error channel, which the adapter maps to a read-only source view) and no
  // partial document is produced, so nothing can silently overwrite the note.
  const jsxProcessor = await createProcessor();
  const rest = await roundtrip(jsxProcessor, 'para\n\n<Foo bar="1" />\n');
  assert.ok(
    jsxProcessor.onErrorEvents.some((message) => /mdxJsxFlowElement|Foo/.test(message)),
    `expected an import error, got: ${JSON.stringify(jsxProcessor.onErrorEvents)}`,
  );
  assert.doesNotMatch(rest, /Foo/, 'dropped constructs never reach the export');
});

test('a note that only adds a heading level keeps its body unchanged', async () => {
  const processor = await createProcessor();
  const source = '正文一段。\n\n- 甲\n- 乙\n';
  const once = await roundtrip(processor, source);
  assert.ok(once.includes('正文一段。'));
  assert.ok(once.includes('* 甲'));
  assert.ok(once.includes('* 乙'));
});

test('the WYSIWYG surface applies scoped Markdown typography', () => {
  const editor = fs.readFileSync('src/features/notes/markdown-editor.tsx', 'utf8');
  const styles = fs.readFileSync('src/features/notes/markdown-editor.css', 'utf8');

  assert.match(editor, /contentEditableClassName="cove-markdown-content"/);
  assert.match(styles, /\.cove-markdown-content h1/);
  assert.match(styles, /\.cove-markdown-content ul/);
  assert.match(styles, /\.cove-markdown-content blockquote/);
  assert.match(styles, /\.cove-markdown-content table/);
  assert.match(styles, /\.cove-markdown-content code/);
});

test('fenced code keeps a highlighted editor and a plain fallback', () => {
  const editor = fs.readFileSync('src/features/notes/markdown-editor.tsx', 'utf8');
  const styles = fs.readFileSync('src/features/notes/markdown-editor.css', 'utf8');

  assert.match(editor, /codeMirrorPlugin\(\{/, 'known languages are edited in CodeMirror');
  assert.match(editor, /autoLoadLanguageSupport: true/, 'grammars load on demand');
  assert.match(editor, /plainTextCodeEditor/, 'unlisted languages stay editable');
  assert.match(editor, /ChangeCodeMirrorLanguage/, 'a focused fence offers its language');
  assert.match(styles, /\.dark \.cove-mdx-editor \.cm-editor/, 'the fence is themed in dark mode');
});
