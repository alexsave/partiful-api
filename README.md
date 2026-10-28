I think the only thing you need to do manually is install the chrome extension

## Scribd to PDF

```
node scribd.ts https://www.scribd.com/document/<id>/<title> [out.pdf]
```

Uses the Chrome you already have open (with `chrome_ext` loaded and logged in to Scribd): opens the document in the active tab, walks every page, downloads the image sheets into `scribd-out/<id>-<title>/`, and assembles them with `native/jigsaw2pdf` into `scribd-out/<id>-<title>.pdf`.
Page sizes come from the document itself, not the browser window.
Rerunning reuses already downloaded sheets.

`native/jigsaw2pdf` is a dependency-free C tool that embeds each JPEG sheet once and draws every piece as a clipped placement, so nothing is re-encoded.
`make -C native test` checks it against a reference composite.
