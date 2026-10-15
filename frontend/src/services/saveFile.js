export function saveFile({ filename, blob }) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Keep the URL alive long enough for the browser to start its download.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
