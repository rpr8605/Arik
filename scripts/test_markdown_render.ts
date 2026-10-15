// Tests for app/Markdown.tsx: formatting renders, raw HTML and unsafe
// links never do. Server-rendered with react-dom/server; no browser.
// Run: npx tsx scripts/test_markdown_render.ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, endListsBeforePlainLines, safeUrl } from '../app/Markdown';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!cond) failures++;
}
const html = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

// --- Formatting ---
check('bold renders as <strong>, no ** left', html('Pay **$0** a month').includes('<strong>$0</strong>') && !html('Pay **$0** a month').includes('**'));
check('italic renders as <em>', html('this is *likely* eligible').includes('<em>likely</em>'));
{
  const out = html('Options:\n\n- Copay card\n- Patient assistance');
  check('bullet list renders as <ul><li>, no "- " markers', out.includes('<ul>') && (out.match(/<li>/g) ?? []).length === 2 && !out.includes('- Copay'));
}
check('numbered list renders as <ol>', html('1. Call\n2. Enroll').includes('<ol>'));
check('inline code renders as <code>, no backticks', html('Use `BIN 610020`').includes('<code>BIN 610020</code>') && !html('Use `BIN 610020`').includes('`'));
check('fenced code renders as <pre><code>', html('```\nline\n```').includes('<pre><code>'));
check('GFM table renders as <table>', html('| Option | Price |\n|---|---|\n| Card | $0 |').includes('<table>'));
check('heading renders (no # left)', /<h3>Next steps<\/h3>/.test(html('### Next steps')) && !html('### Next steps').includes('###'));
{
  const receipt = 'Why Arik believes this:\nSource: Program terms, verified 2026-10-05.\nStill missing: nothing.';
  const out = html(receipt);
  check('single line breaks are kept (receipt stays one line per item)', (out.match(/<br\/?>/g) ?? []).length === 2, out);
}

{
  // The code-built trust receipt: bullets followed by plain lines.
  const receipt = 'Why Arik believes this:\n- Card: as low as $0 per fill. Source: Program terms.\n- PAP: price not confirmed.\nPending verification: Zepbound card - conflicting sources\nStill missing: nothing.';
  const out = html(receipt);
  const lastLi = out.slice(out.lastIndexOf('<li>'), out.lastIndexOf('</li>'));
  check('plain line after a bullet is NOT swallowed into the last bullet', (out.match(/<li>/g) ?? []).length === 2 && !lastLi.includes('Still missing') && out.includes('Still missing: nothing.'), out);
}
check('indented continuation lines still belong to their bullet', endListsBeforePlainLines('- a\n  more') === '- a\n  more');
check('list ending leaves fenced code untouched', endListsBeforePlainLines('```\n- a\nplain\n```') === '```\n- a\nplain\n```');
check('numbered list followed by plain line gets a separator', endListsBeforePlainLines('1. a\nplain') === '1. a\n\nplain');

// --- Safety: raw HTML never becomes elements ---
{
  const out = html('Hello <script>alert(1)</script> there');
  check('<script> is not rendered as an element', !/<script/i.test(out), out);
}
{
  const out = html('<img src=x onerror="alert(1)">');
  check('<img onerror> is not rendered', !/<img/i.test(out) && !/onerror/i.test(out), out);
}
{
  const out = html('<a href="https://evil.example">x</a> and <iframe src="https://evil.example"></iframe>');
  check('raw <a> / <iframe> HTML is dropped', !/<iframe/i.test(out) && !/evil\.example/.test(out), out);
}
{
  const out = html('![tracker](https://evil.example/pixel.png)');
  check('markdown images are not rendered (no outside requests)', !/<img/i.test(out) && !/src=/.test(out), out);
}

// --- Safety: links ---
{
  const out = html('[click](javascript:alert(1))');
  check('javascript: link has no href', !/href=/.test(out) && !/javascript/i.test(out), out);
}
{
  const out = html('[x](data:text/html;base64,PHNjcmlwdD4=)');
  check('data: link has no href', !/href=/.test(out), out);
}
{
  const out = html('[Program terms](https://www.example.gov/terms)');
  check('https link keeps href, opens in a new tab with noopener', out.includes('href="https://www.example.gov/terms"') && out.includes('target="_blank"') && out.includes('rel="noopener noreferrer"'), out);
}
{
  const out = html('[Call](tel:18553547847)');
  check('tel: link kept, no new tab', out.includes('href="tel:18553547847"') && !out.includes('target='), out);
}
check('safeUrl allow-list', safeUrl('https://a.b') === 'https://a.b' && safeUrl('mailto:a@b.c') === 'mailto:a@b.c' && safeUrl('javascript:x') === '' && safeUrl('vbscript:x') === '' && safeUrl('ftp://x') === '' && safeUrl('tel:1-855-354-7847') === 'tel:1-855-354-7847' && safeUrl('tel:javascript:alert(1)') === '');

// --- Plain text stays plain ---
check('text with $ and numbers is unchanged', html('You pay $35 per fill.').includes('You pay $35 per fill.'));

console.log(failures === 0 ? '\nMARKDOWN RENDER: ALL PASS' : `\nMARKDOWN RENDER: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
