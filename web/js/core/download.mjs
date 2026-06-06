export async function triggerDownload({ dataUrl, blob, filename }) {
  let url = dataUrl;
  let revoke = null;

  if (!url && blob instanceof Blob) {
    url = URL.createObjectURL(blob);
    revoke = url;
  }

  if (!url) {
    throw new Error("Download failed: missing dataUrl/blob.");
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  if (revoke) {
    setTimeout(() => URL.revokeObjectURL(revoke), 0);
  }
}
