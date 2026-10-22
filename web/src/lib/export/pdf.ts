/**
 * Issue #3.
 *
 * alphaTab already opens an A4 print view with `api.print()`. A follow-up can
 * call that for a quick print, or render the stored document on the server
 * (`fretbook/export/pdf.py`, `GET /api/songs/{id}/export.pdf`). The song page
 * shows the PDF action only after `available_exporters()` includes `"pdf"`.
 */
export function printScore(api: { print: (width?: string) => void } | null): void {
  api?.print();
}
