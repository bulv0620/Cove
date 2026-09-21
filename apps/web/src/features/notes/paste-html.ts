/**
 * Clipboard HTML from Typora (and other CodeMirror-based editors) separates the
 * code lines with markup instead of newline characters — `<br>` between the line
 * spans in Typora's own fences, one block element per line elsewhere — and never
 * emits a newline text node. The editor's HTML import reads `pre.textContent`,
 * which then glues the whole block into a single line, so pasted code loses its
 * line breaks (NOTE-FR-005: the dialect must survive a normal clipboard paste).
 *
 * This module rewrites such blocks into one `<code>` element whose text keeps a
 * newline per line, before the editor sees the clipboard payload. Blocks whose
 * text already round-trips unchanged are handed back untouched.
 */

/** Elements that end a line when they appear inside a code block. */
const LINE_TAGS = new Set(['PRE', 'DIV', 'P', 'LI', 'TR', 'SECTION']);

/**
 * Editor chrome that is copied along with the code but is not code: CodeMirror
 * line numbers, its hidden measurement sample and Typora's language tooltip.
 * Only known leftovers are dropped — guessing by `contenteditable` would risk
 * deleting real code lines.
 */
const CHROME_SELECTOR = [
  '.CodeMirror-gutter-wrapper',
  '.CodeMirror-gutter-elt',
  '.CodeMirror-linenumber',
  '.CodeMirror-measure',
  '.CodeMirror-cursor',
  '.code-tooltip',
].join(',');

/**
 * Invisible characters the code editor draws as a visible "control character"
 * box — the same set CodeMirror's `highlightSpecialChars` replaces with a
 * widget. Source editors use them as placeholders (Typora writes a zero-width
 * space to give a blank line its height, and Windows clipboards carry CR), so
 * leaving them in puts a box at every line the source marked.
 */
const PLACEHOLDER_CHARS =
  /[\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]/g;

/** Control characters are placeholders too; tab and newline are real code. */
function withoutControlChars(text: string): string {
  let kept = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || (code >= 0x20 && (code < 0x7f || code > 0x9f))) {
      kept += character;
    }
  }
  return kept;
}

/** A code block's markup reduced to what the writer can read about it. */
export type CodeToken =
  | { kind: 'text'; text: string }
  /** An explicit line break: always ends the line, so blank lines survive. */
  | { kind: 'break' }
  /** A block boundary: ends the line only when it holds text. */
  | { kind: 'end' };

/**
 * Turns tokens into the block's text. Only explicit breaks can produce an empty
 * line, which is what makes `<br><br>` a blank line while a wrapper element
 * around a line does not add one. Blank lines at both ends come from the
 * wrappers, not from the code, and are dropped.
 */
export function codeLines(tokens: CodeToken[]): string {
  const lines: string[] = [];
  let current = '';
  let hasText = false;
  const flush = () => {
    lines.push(current);
    current = '';
    hasText = false;
  };
  for (const token of tokens) {
    if (token.kind === 'text') {
      current += token.text;
      hasText = true;
    } else if (token.kind === 'break') {
      flush();
    } else if (hasText) {
      flush();
    }
  }
  if (hasText) flush();
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  return lines.join('\n');
}

function isChrome(element: Element): boolean {
  return element.matches(CHROME_SELECTOR);
}

/** True when a node's children include a line container (block-level). */
function hasLineChild(node: Node | null): boolean {
  return (
    node !== null &&
    Array.from(node.childNodes).some(
      (child) => child.nodeType === Node.ELEMENT_NODE && LINE_TAGS.has((child as Element).tagName),
    )
  );
}

/** Reads one code block as a token stream. */
function collectTokens(root: Element): CodeToken[] {
  const tokens: CodeToken[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.nodeValue ?? '';
      if (raw === '') return;
      // Typora pads code indentation with non-breaking spaces and marks blank
      // lines with a zero-width space; neither belongs in the saved note.
      const text = withoutControlChars(raw.replace(/\u00a0/g, ' ')).replace(PLACEHOLDER_CHARS, '');
      // Whitespace between sibling line containers is HTML layout (a pretty
      // printed clipboard), not code. Whitespace inside a line — including a
      // line's own indentation — is real code and must stay.
      if (text.trim() === '' && hasLineChild(node.parentNode)) return;
      // `text` may be empty here: the node held only placeholders, which still
      // marks a line, so a fence of blank lines keeps them.
      tokens.push({ kind: 'text', text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element !== root && isChrome(element)) return;
    if (element.tagName === 'BR') {
      tokens.push({ kind: 'break' });
      return;
    }
    const isLine = element !== root && LINE_TAGS.has(element.tagName);
    for (const child of Array.from(element.childNodes)) visit(child);
    if (isLine) tokens.push({ kind: 'end' });
  };
  visit(root);
  return tokens;
}

function languageOf(pre: Element): string {
  const fromClass = /language-([\w-]+)/.exec(pre.getAttribute('class') ?? '');
  return (
    fromClass?.[1] ??
    pre.getAttribute('data-language') ??
    pre.getAttribute('lang') ??
    ''
  ).trim();
}

/**
 * The paste event to hand to the editor instead of `event`, or null when the
 * payload needs no repair (or cannot be rebuilt in this browser).
 *
 * The system clipboard payload is read-only during a paste, so the corrected
 * HTML cannot be written back into it. A fresh event carrying a constructed
 * transfer object is dispatched in its place instead.
 */
export function repairedPasteEvent(event: ClipboardEvent): ClipboardEvent | null {
  const data = event.clipboardData;
  if (!data) return null;
  const html = data.getData('text/html');
  if (!html) return null;
  const normalized = normalizePastedHtml(html);
  if (normalized === html) return null;
  try {
    const transfer = new DataTransfer();
    transfer.setData('text/html', normalized);
    const plain = data.getData('text/plain');
    if (plain) transfer.setData('text/plain', plain);
    for (const file of Array.from(data.files ?? [])) transfer.items.add(file);
    return new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
  } catch {
    // Cannot rebuild the payload here: leave the original paste untouched.
    return null;
  }
}

/** Rewrites code blocks whose markup carries the line breaks; else returns input. */
export function normalizePastedHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    // Nested line wrappers (`pre.CodeMirror-line`) are handled as lines of the
    // block that contains them, never as blocks of their own.
    if (!pre.isConnected || pre.parentElement?.closest('pre')) continue;
    const code = codeLines(collectTokens(pre));
    // Nothing to repair: a block whose text already round-trips is left alone,
    // whether the lines are separated by newlines, <br> or block elements.
    if (code === '' || code === pre.textContent) continue;
    const language = languageOf(pre);
    const element = doc.createElement('code');
    element.textContent = code;
    if (language) {
      element.className = `language-${language}`;
      pre.setAttribute('data-language', language);
    }
    pre.replaceChildren(element);
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}
