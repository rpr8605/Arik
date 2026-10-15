import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

// Safe markdown for Arik's chat replies (2026-10-14 demo ticket): bold,
// lists, code, tables and line breaks render as formatted text instead of
// raw ** and - markers. Used by Thread.tsx for assistant messages only;
// the patient's own messages stay plain text.
//
// Safety rules (tested by scripts/test_markdown_render.ts):
// - Raw HTML in a reply is never rendered: react-markdown has no raw-HTML
//   plugin here and skipHtml drops HTML nodes, so <script> or <img onerror>
//   can't become elements. No dangerouslySetInnerHTML anywhere.
// - No images: a reply can't load anything from another server.
// - Links: http, https, mailto and tel only (javascript: and data: are
//   removed); web links open in a new tab with rel="noopener noreferrer".
// - remark-breaks keeps single line breaks, so the code-built trust receipt
//   keeps one line per option.

const SAFE_PROTOCOL = /^(https?:|mailto:|tel:)/i;

// react-markdown's own filter drops tel:, so phone links are allowed here
// explicitly, digits and phone punctuation only.
const TEL = /^tel:[0-9+().\- ]+$/i;

export function safeUrl(url: string): string {
  if (TEL.test(url.trim())) return url.trim();
  const cleaned = defaultUrlTransform(url);
  return SAFE_PROTOCOL.test(cleaned) ? cleaned : '';
}

// In markdown a plain line directly under a list item continues that item
// ("lazy continuation"), so the trust receipt's "Still missing: ..." line
// was swallowed into the last bullet. A plain, unindented line after a
// list line gets a blank line first, which ends the list. Fenced code is
// left alone.
const LIST_LINE = /^\s*([-*+]|\d+[.)])\s/;
export function endListsBeforePlainLines(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const prev = out[out.length - 1];
    if (!inFence && prev !== undefined && LIST_LINE.test(prev) && line.trim() !== '' && !LIST_LINE.test(line) && !/^\s/.test(line)) {
      out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        urlTransform={safeUrl}
        components={{
          a: ({ href, children: label }) =>
            href ? (
              <a href={href} {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
        }}
      >
        {endListsBeforePlainLines(children)}
      </ReactMarkdown>
    </div>
  );
}
