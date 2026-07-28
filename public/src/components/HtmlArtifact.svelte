<script>
  export let source = "";
  export let label = "HTML artifact";

  const previewPolicy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

  function previewDocument(value) {
    const html = String(value ?? "");
    const policy = `<meta http-equiv="Content-Security-Policy" content="${previewPolicy}">`;
    if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policy}`);
    if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${policy}</head>`);
    return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
  }

  $: previewHtml = previewDocument(source);
</script>

<iframe
  class="pinned-html-preview"
  title={`HTML preview: ${label}`}
  srcdoc={previewHtml}
  sandbox=""
  referrerpolicy="no-referrer"
></iframe>
