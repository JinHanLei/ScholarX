# EasyRef PDF Collector

Chrome/Edge Manifest V3 extension for saving the current PDF page or a PDF link into an EasyRef paper library.

## Load Locally

1. Start EasyRef. The default extension API target is `http://localhost:5000/api`.
2. Open Chrome or Edge and go to `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked" and select this `browser-extension` directory.
5. Open EasyRef once and select a paper library, or choose a library in the extension popup.

## Use

- On a PDF page, click the EasyRef extension button and choose "保存 PDF".
- On a PDF link, right-click and choose "保存链接 PDF 到 EasyRef".

The upload uses the existing EasyRef endpoint:

```text
POST /api/libraries/<library_id>/uploads/pdf?async=1
```

If EasyRef is deployed somewhere other than the local Compose defaults, change the API address in the popup.
