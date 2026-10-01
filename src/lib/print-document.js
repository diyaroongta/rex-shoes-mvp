/* Print one document into its own clean window, the way the invoice is.
   A print stylesheet has to anticipate every piece of chrome on the page; a
   clean window cannot get one wrong, and what is saved as a PDF is exactly the
   sheet and nothing else. Shared by the Dispatch Book and Gate passes so the
   packing list and the gate pass print the same way.
   Returns false when there is nothing to print or the popup was blocked, so
   the caller can say so where the person is looking. */
export function printDocument(selector, title){
  const node = document.querySelector(selector);
  if(!node) return false;
  const w = window.open("", "_blank", "width=900,height=1000");
  if(!w) return false;
  const safe = String(title || "").replace(/[<>&]/g, "");
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<title>${safe}</title>`
    + `<style>*{box-sizing:border-box}`
    + `body{margin:0;padding:12mm;font-family:Arial,Helvetica,sans-serif;color:#000}`
    + `table{width:100%;border-collapse:collapse}`
    + `[data-noprint]{display:none!important}@page{size:A4 portrait;margin:10mm}</style></head>`
    + `<body>${node.outerHTML}`
    + `<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>`
    + `</body></html>`);
  w.document.close();
  return true;
}
