# Bundled preview dependencies

- docx-preview 0.4.1, https://github.com/VolodymyrBaydalka/docxjs, Apache-2.0. Unmodified distribution file; license in docx-preview-LICENSE.
- JSZip 3.10.2, https://github.com/Stuk/jszip, used under the MIT license option. Unmodified distribution file; license in jszip-LICENSE.md.

These are runtime dependencies for local browser preview. No CDN is contacted. Preview rendering is isolated in a sandboxed frame, with external network resources and altChunk HTML disabled. This renderer does not guarantee Microsoft Word pagination fidelity.
