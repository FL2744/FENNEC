# Third-party notices

`fennec.html` embeds document-reading libraries so that the frontend can be uploaded as a single file. These upstream components are not relicensed by FENNEC's MIT license. Existing embedded notices are preserved.

The embedded PDF.js worker identifies PDF.js version 5.4.296; embedded core-js metadata identifies 3.45.1. Other document-reader bundle versions were inherited with the original HTML and are not separately versioned here. The upstream licenses below are included as attribution references; retain upstream copyright and license notices when redistributing these components.

- **pdfjs**: [upstream license](https://raw.githubusercontent.com/mozilla/pdf.js/master/LICENSE), [included notice](third_party/licenses/pdfjs.txt).
- **pdf-parse**: [upstream license](https://raw.githubusercontent.com/mehmet-kozan/pdf-parse/main/LICENSE), [included notice](third_party/licenses/pdf-parse.txt).
- **mammoth**: [upstream license](https://raw.githubusercontent.com/mwilliamson/mammoth.js/master/LICENSE), [included notice](third_party/licenses/mammoth.txt).
- **core-js**: [upstream license](https://raw.githubusercontent.com/zloirock/core-js/v3.45.1/LICENSE), [included notice](third_party/licenses/core-js.txt).
- **jszip**: [upstream license](https://raw.githubusercontent.com/Stuk/jszip/main/LICENSE.markdown), [included notice](third_party/licenses/jszip.txt).

## Utility dependency notices

Additional license files are included in [third_party/licenses/dependencies](third_party/licenses/dependencies). These were collected from the upstream document-reader dependency distributions as attribution references; their versions describe the notice collection, not a verified reconstruction of every module in the inherited minified bundle. Some packages include multiple alternative license files; retain the applicable upstream terms.

| Package | Notice-source version | License |
| --- | --- | --- |
| argparse | 1.0.10 | MIT |
| base64-js | 1.5.1 | MIT |
| core-util-is | 1.0.3 | MIT |
| dingbat-to-unicode | 1.0.2 | BSD-2-Clause |
| duck | 0.1.12 | BSD |
| immediate | 3.0.6 | MIT |
| inherits | 2.0.4 | ISC |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| lie | 3.3.0 | MIT |
| lop | 0.4.2 | BSD-2-Clause |
| mammoth | 1.13.0 | BSD-2-Clause |
| option | 0.2.4 | BSD-2-Clause |
| pako | 1.0.11 | (MIT AND Zlib) |
| pdf-parse | 2.4.5 | Apache-2.0 |
| pdfjs-dist | 5.4.296 | Apache-2.0 |
| process-nextick-args | 2.0.1 | MIT |
| readable-stream | 2.3.8 | MIT |
| safe-buffer | 5.1.2 | MIT |
| setimmediate | 1.0.5 | MIT |
| sprintf-js | 1.0.3 | BSD-3-Clause |
| string_decoder | 1.1.1 | MIT |
| underscore | 1.13.8 | MIT |
| util-deprecate | 1.0.2 | MIT |
| xmlbuilder | 10.1.1 | MIT |

The development dependencies are installed separately through npm, retain their own licenses, and are not required on the deployed website.
