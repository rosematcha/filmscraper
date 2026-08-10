/**
 * The handful of pages the email links land on.
 *
 * Self-contained on purpose: no scripts, no external resources, and a
 * no-referrer policy, so the token in the URL goes nowhere. Every mutation
 * happens on a POST from a button — mail scanners prefetch GETs, and a
 * prefetch must never confirm, unsubscribe or delete anyone.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.2rem; }
  button { font: inherit; padding: 0.4rem 1rem; cursor: pointer; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** A page whose single button POSTs the token back to the same path. */
export function actionPage(options: {
  title: string;
  text: string;
  button: string;
  token: string;
}): string {
  return page(
    options.title,
    `<h1>${escapeHtml(options.title)}</h1>
<p>${escapeHtml(options.text)}</p>
<form method="post">
<input type="hidden" name="token" value="${escapeHtml(options.token)}">
<button type="submit">${escapeHtml(options.button)}</button>
</form>`,
  );
}

export function messagePage(title: string, text: string): string {
  return page(title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(text)}</p>`);
}
