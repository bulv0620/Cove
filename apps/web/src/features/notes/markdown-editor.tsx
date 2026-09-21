/**
 * MarkdownEditor adapter (NOTE-FR-005/NOTE-FR-006): wraps the approved
 * WYSIWYG editor with the restricted dialect — headings, lists (incl. task),
 * links, quotes, rules, tables, fenced code, images by reference. Constructs
 * outside the dialect never execute and are never silently dropped
 * (NOTE-AC-003): raw HTML is held inert and re-exported verbatim, while
 * unknown/JSX constructs abort the import (reported via onError, not a throw)
 * and switch this component to a read-only source view. The `markdown` prop
 * is read once per mount; pass a `key` when the document identity or restored
 * content changes.
 */
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  codeBlockPlugin,
  codeMirrorPlugin,
  ConditionalContents,
  CreateLink,
  headingsPlugin,
  imagePlugin,
  InsertTable,
  InsertThematicBreak,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import './markdown-editor.css';
import { useTheme } from '@/app/theme-provider';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
  Component,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { repairedPasteEvent } from './paste-html';

export interface MarkdownEditorProps {
  /** Initial content; read once when the editor mounts. */
  markdown: string;
  readOnly?: boolean;
  /**
   * Fires on every editor change. `normalized` marks the import-time
   * canonicalization pass (e.g. `-` → `*`); callers must not treat it as a
   * user edit.
   */
  onChange?: (markdown: string, normalized: boolean) => void;
  onBlur?: () => void;
  /**
   * Receives image files from paste/drop (NOTE-FR-012). The adapter never
   * inserts them itself: callers own hosting upload, progress display and the
   * final markdown insertion.
   */
  onImageFiles?: (files: File[]) => void;
  /** Accessible name for the editing surface. */
  label: string;
  className?: string;
}

export interface MarkdownEditorHandle {
  /** Current markdown export, or null when the editor could not render. */
  getMarkdown: () => string | null;
  /** Inserts markdown at the current selection (used for finished uploads). */
  insertMarkdown: (markdown: string) => void;
}

/**
 * Fence languages that open the highlighted CodeMirror editor, keyed by the
 * info string used in the note; the label is what the language dropdown shows.
 * Several keys may share a label to cover an alias (the first key wins as the
 * canonical value). Anything else stays editable in the plain fallback editor
 * below, so no fence becomes read-only.
 *
 * The grammars themselves are not in this list: they are loaded on demand from
 * CodeMirror's language data the first time such a fence is opened.
 */
const CODE_BLOCK_LANGUAGES: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  vue: 'Vue',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  python: 'Python',
  py: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  sql: 'SQL',
  bash: 'Bash',
  shell: 'Shell',
  sh: 'Shell',
  yaml: 'YAML',
  yml: 'YAML',
  markdown: 'Markdown',
  md: 'Markdown',
};

function NoteToolbar(): JSX.Element {
  // Format toggles are filtered to the supported dialect: underline, sub- and
  // superscript would serialize to HTML, which re-import rejects. A focused
  // code block swaps them for its language picker.
  return (
    <ConditionalContents
      options={[
        {
          when: (editor) => editor?.editorType === 'codeblock',
          contents: () => <ChangeCodeMirrorLanguage />,
        },
        {
          fallback: () => (
            <>
              <UndoRedo />
              <BlockTypeSelect />
              <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
              <StrikeThroughSupSubToggles options={['Strikethrough']} />
              <CodeToggle />
              <CreateLink />
              <ListsToggle />
              <InsertThematicBreak />
              <InsertTable />
            </>
          ),
        },
      ]}
    />
  );
}

interface SourceFallbackProps {
  markdown: string;
}

/** Read-only escape hatch for notes that use unsupported constructs. */
function SourceFallback({ markdown }: SourceFallbackProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <div>
        <p className="text-sm font-medium">{t('notes.sourceFallbackTitle')}</p>
        <p className="text-muted-foreground text-xs">{t('notes.sourceFallbackHint')}</p>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded border bg-transparent p-3 font-mono text-xs whitespace-pre-wrap">
        {markdown}
      </pre>
    </div>
  );
}

interface BoundaryProps {
  markdown: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class ImportBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('notes.editorImportFailed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) return <SourceFallback markdown={this.props.markdown} />;
    return this.props.children;
  }
}

/**
 * Fallback fenced-code editor: a plain textarea, used for fences whose language
 * is not in {@link CODE_BLOCK_LANGUAGES}. Keeps every fenced block editable
 * even without a loaded grammar (NOTE-FR-006).
 */
function PlainTextCodeEditor({ code, language }: CodeBlockEditorProps): JSX.Element {
  const { setCode } = useCodeBlockEditorContext();
  return (
    <pre className="m-0 overflow-x-auto p-0">
      <textarea
        value={code}
        onChange={(event) => setCode(event.target.value)}
        spellCheck={false}
        aria-label={language || 'code'}
        rows={Math.max(2, code.split('\n').length)}
        className="block w-full resize-none border-none bg-transparent p-4 font-mono text-sm outline-none"
      />
    </pre>
  );
}

const plainTextCodeEditor: CodeBlockEditorDescriptor = {
  priority: 0,
  match: () => true,
  Editor: PlainTextCodeEditor,
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      markdown,
      readOnly = false,
      onChange,
      onBlur,
      onImageFiles,
      label,
      className,
    }: MarkdownEditorProps,
    ref,
  ) {
    const { theme } = useTheme();
    const editorRef = useRef<MDXEditorMethods | null>(null);
    const wrapperRef = useRef<HTMLElement | null>(null);
    const failedRef = useRef(false);
    const [importFailed, setImportFailed] = useState(false);

    // The editor reads the clipboard in a bubble-phase handler on its own
    // contenteditable, so a repaired payload has to be dispatched from the
    // capture phase, before that handler runs. The synthetic event is
    // recognised as a paste by the rich text importer and carries the same
    // files, so image pasting is unaffected.
    useEffect(() => {
      const node = wrapperRef.current;
      if (!node) return;
      const onPaste = (event: ClipboardEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.closest('[contenteditable="true"]')) return;
        const repaired = repairedPasteEvent(event);
        if (!repaired) return;
        // Replace the original paste entirely: the editor must not also import
        // the unrepaired payload.
        event.preventDefault();
        event.stopPropagation();
        target.dispatchEvent(repaired);
      };
      node.addEventListener('paste', onPaste, true);
      return () => node.removeEventListener('paste', onPaste, true);
    }, []);

    // Plugins are created once per mount; MDXEditor requires stable instances.
    const plugins = useMemo(
      () => [
        headingsPlugin(),
        listsPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        tablePlugin(),
        // No imageUploadHandler: paste/drop is intercepted on the wrapper and
        // routed through the notes upload flow (see onImageFiles), so the
        // editor never inserts an unconfirmed address. /image/... URLs render.
        imagePlugin(),
        codeBlockPlugin({ codeBlockEditorDescriptors: [plainTextCodeEditor] }),
        // Priority 1 descriptor: fences with a known language get the CodeMirror
        // editor, everything else keeps the plain fallback above.
        codeMirrorPlugin({
          codeBlockLanguages: CODE_BLOCK_LANGUAGES,
          autoLoadLanguageSupport: true,
        }),
        markdownShortcutPlugin(),
        toolbarPlugin({ toolbarContents: NoteToolbar }),
      ],
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => (failedRef.current ? null : (editorRef.current?.getMarkdown() ?? null)),
        insertMarkdown: (value: string) => editorRef.current?.insertMarkdown(value),
      }),
      [],
    );

    const imageFilesFrom = (files: FileList | undefined | null): File[] =>
      Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));

    if (importFailed) return <SourceFallback markdown={markdown} />;

    return (
      <ImportBoundary markdown={markdown}>
        <section
          ref={wrapperRef}
          aria-label={label}
          className={cn('flex h-full min-h-0 flex-col', className)}
          onPaste={(event) => {
            const files = imageFilesFrom(event.clipboardData?.files);
            if (onImageFiles && files.length > 0) {
              event.preventDefault();
              event.stopPropagation();
              onImageFiles(files);
            }
          }}
          onDrop={(event) => {
            const files = imageFilesFrom(event.dataTransfer?.files);
            if (onImageFiles && files.length > 0) {
              event.preventDefault();
              event.stopPropagation();
              onImageFiles(files);
            }
          }}
          onDragOver={onImageFiles ? (event) => event.preventDefault() : undefined}
        >
          <MDXEditor
            ref={editorRef}
            markdown={markdown}
            plugins={plugins}
            readOnly={readOnly}
            contentEditableClassName="cove-markdown-content"
            onChange={(next, normalized) => {
              if (failedRef.current) return;
              onChange?.(next, normalized);
            }}
            onError={() => {
              // Import aborted (unknown/JSX construct): stop editing this note
              // so a damaged document is never saved back to the NAS.
              failedRef.current = true;
              setImportFailed(true);
            }}
            onBlur={() => onBlur?.()}
            className={cn(
              // flex-1 + min-h-0 keeps the full-height flex chain resolvable,
              // which is what makes the whole pane a clickable editor surface.
              'cove-mdx-editor mdxeditor-full-height min-h-0 flex-1',
              theme === 'dark' && 'dark-theme',
            )}
          />
        </section>
      </ImportBoundary>
    );
  },
);
