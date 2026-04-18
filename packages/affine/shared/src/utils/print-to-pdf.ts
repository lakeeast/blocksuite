export async function printToPdf(
  rootElement: HTMLElement | null = document.querySelector(
    '.affine-page-viewport'
  ),
  options: {
    /**
     * Callback that is called when ready to print.
     */
    beforeprint?: (iframe: HTMLIFrameElement) => Promise<void> | void;
    /**
     * Callback that is called after the print dialog is closed.
     * Notice: in some browser this may be triggered immediately.
     */
    afterprint?: () => Promise<void> | void;
  } = {}
) {
  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    // Use a hidden but rendering-enabled state instead of display: none
    Object.assign(iframe.style, {
      visibility: 'hidden',
      position: 'absolute',
      width: '0',
      height: '0',
      border: 'none',
    });
    iframe.srcdoc = '<!DOCTYPE html>';
    iframe.onload = async () => {
      if (!iframe.contentWindow) {
        reject(new Error('unable to print pdf'));
        return;
      }
      if (!rootElement) {
        reject(new Error('Root element not defined, unable to print pdf'));
        return;
      }

      const doc = iframe.contentWindow.document;

      doc.write(`<!DOCTYPE html><html><head><style>@media print {
                html, body {
                  height: initial !important;
                  overflow: initial !important;
                  print-color-adjust: exact;
                  -webkit-print-color-adjust: exact;
                  color: #000 !important;
                  background: #fff !important;
                  color-scheme: light !important;
                }
                ::-webkit-scrollbar { 
                  display: none; 
                }
                :root, body {
                  --affine-text-primary: #000 !important;
                  --affine-text-secondary: #111 !important;
                  --affine-text-tertiary: #333 !important;
                  --affine-background-primary: #fff !important;
                  --affine-background-secondary: #fff !important;
                  --affine-background-tertiary: #fff !important;
                }
                body, [data-theme='dark'] {
                  color: #000 !important;
                  background: #fff !important;
                }
                body * {
                  color: #000 !important;
                  -webkit-text-fill-color: #000 !important;
                }
                :root {
                  --affine-note-shadow-box: none !important;
                  --affine-note-shadow-sticker: none !important;
                }
                .affine-page-viewport {
                  height: auto !important;
                  overflow: visible !important;
                }
                .affine-page-root-block-container {
                  padding-bottom: 0 !important;
                }
}</style></head><body></body></html>`);
      doc.close();
      iframe.contentWindow.document
        .write(`<!DOCTYPE html><html><head><style>@media print {
              html, body {
                height: initial !important;
                overflow: initial !important;
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
                color: #000 !important;
                background: #fff !important;
                color-scheme: light !important;
              }
              ::-webkit-scrollbar { 
                display: none; 
              }
              :root, body {
                --affine-text-primary: #000 !important;
                --affine-text-secondary: #111 !important;
                --affine-text-tertiary: #333 !important;
                --affine-background-primary: #fff !important;
                --affine-background-secondary: #fff !important;
                --affine-background-tertiary: #fff !important;
                --affine-background-code-block: #f5f5f5 !important;
                --affine-quote-color: #e3e3e3 !important;
                --affine-border-color: #e3e3e3 !important;
              }
              body, [data-theme='dark'] {
                color: #000 !important;
                background: #fff !important;
              }
              body * {
                color: #000 !important;
                -webkit-text-fill-color: #000 !important;
              }
              :root {
                --affine-note-shadow-box: none !important;
                --affine-note-shadow-sticker: none !important;
              }
              .affine-page-viewport {
                height: auto !important;
                overflow: visible !important;
              }
              .affine-page-root-block-container {
                padding-bottom: 0 !important;
              }
            }</style></head><body></body></html>`);

      // copy all styles to iframe
      for (const element of document.styleSheets) {
        try {
          for (const cssRule of element.cssRules) {
            const target = doc.styleSheets[0];
            target.insertRule(cssRule.cssText, target.cssRules.length);
          }
        } catch (e) {
          if (element.href) {
            console.warn(
              'css cannot be applied when printing pdf, this may be because of CORS policy from its domain.',
              element.href
            );
          } else {
            reject(e);
          }
        }
      }

      // Recursive function to find all canvases, including those in shadow roots
      const findAllCanvases = (root: Node): HTMLCanvasElement[] => {
        const canvases: HTMLCanvasElement[] = [];
        const traverse = (node: Node) => {
          if (node instanceof HTMLCanvasElement) {
            canvases.push(node);
          }
          if (node instanceof HTMLElement || node instanceof ShadowRoot) {
            node.childNodes.forEach(traverse);
          }
          if (node instanceof HTMLElement && node.shadowRoot) {
            traverse(node.shadowRoot);
          }
        };
        traverse(root);
        return canvases;
      };

      // convert all canvas to image
      const canvasImgObjectUrlMap = new Map<string, string>();
      const allCanvas = findAllCanvases(rootElement);
      let canvasKey = 1;
      const canvasToKeyMap = new Map<HTMLCanvasElement, string>();

      for (const canvas of allCanvas) {
        const key = canvasKey.toString();
        canvasToKeyMap.set(canvas, key);
        canvasKey++;
        const canvasImgObjectUrl = await new Promise<Blob | null>(resolve => {
          try {
            canvas.toBlob(resolve);
          } catch {
            resolve(null);
          }
        });
        if (!canvasImgObjectUrl) {
          console.warn(
            'canvas cannot be converted to image when printing pdf, this may be because of CORS policy'
          );
          continue;
        }
        canvasImgObjectUrlMap.set(key, URL.createObjectURL(canvasImgObjectUrl));
      }

      // Elements that are UI chrome and should not appear in PDF output.
      // When shadow DOM is flattened their scoped "display:none" is lost,
      // so the safest approach is to skip them entirely during cloning.
      const shouldSkipForPrint = (node: Node): boolean => {
        if (!(node instanceof HTMLElement)) return false;
        const tag = node.tagName.toLowerCase();
        return (
          tag.endsWith('-widget') ||
          tag === 'editor-toolbar' ||
          tag === 'blocksuite-portal' ||
          tag === 'affine-surface-void'
        );
      };

      // Recursive deep clone that flattens Shadow DOM into Light DOM
      const deepCloneWithShadows = (node: Node): Node => {
        const clone = doc.importNode(node, false);

        if (
          clone instanceof HTMLCanvasElement &&
          node instanceof HTMLCanvasElement
        ) {
          const key = canvasToKeyMap.get(node);
          if (key) {
            clone.dataset['printToPdfCanvasKey'] = key;
          }
        }

        const appendChildren = (source: Node) => {
          source.childNodes.forEach(child => {
            if (shouldSkipForPrint(child)) return;
            (clone as Element).append(deepCloneWithShadows(child));
          });
        };

        if (node instanceof HTMLElement && node.shadowRoot) {
          appendChildren(node.shadowRoot);
        }
        appendChildren(node);

        return clone;
      };

      const importedRoot = deepCloneWithShadows(rootElement) as HTMLDivElement;

      // force light theme in print iframe
      doc.documentElement.dataset.theme = 'light';
      doc.body.dataset.theme = 'light';
      importedRoot.dataset.theme = 'light';

      // Ensure html and body grow to fit content. Copied stylesheets from the
      // main document can otherwise constrain body to a fixed height, which
      // clips pagination and causes the printer to insert a blank phantom
      // page for overflow.
      doc.documentElement.style.setProperty('height', 'auto', 'important');
      doc.documentElement.style.setProperty('overflow', 'visible', 'important');
      doc.body.style.setProperty('height', 'auto', 'important');
      doc.body.style.setProperty('min-height', '0', 'important');
      doc.body.style.setProperty('overflow', 'visible', 'important');
      doc.body.style.setProperty('margin', '0', 'important');

      // Remove trailing empty paragraphs. Users often have an empty paragraph
      // at the end of a document (containing only a zero-width space), which
      // takes ~23px of vertical space and can push content onto a nearly
      // empty second page for no real reason.
      //
      // We check the v-line content only, because the paragraph's textContent
      // includes placeholder text ("输入'/'唤醒菜单") from the empty-state
      // indicator, which would otherwise make every empty paragraph look
      // non-empty.
      const isEmptyParagraph = (el: Element): boolean => {
        if (el.tagName.toLowerCase() !== 'affine-paragraph') return false;
        const richText = el.querySelector('rich-text');
        if (!richText) return false;
        const vLines = richText.querySelectorAll('v-line');
        if (vLines.length === 0) return true;
        // Sum up visible text across all v-lines, stripping zero-width spaces.
        let total = '';
        for (const line of vLines) {
          total += (line.textContent ?? '').replace(/\u200B/g, '');
        }
        return total.trim().length === 0;
      };
      const childrenContainers = importedRoot.querySelectorAll(
        '.affine-block-children-container'
      );
      for (const container of childrenContainers) {
        while (
          container.lastElementChild &&
          isEmptyParagraph(container.lastElementChild)
        ) {
          container.lastElementChild.remove();
        }
      }

      // Neutralize layout constraints that cause content cutoff and extra
      // blank pages. Selectors with height:100% / flex-grow can make inner
      // blocks compute to a wrong height in the zero-sized print iframe,
      // and the 32px bottom padding can push content past a page boundary.
      const forceAutoHeight = (el: HTMLElement) => {
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('min-height', '0', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
      };
      forceAutoHeight(importedRoot);
      importedRoot
        .querySelectorAll<HTMLElement>(
          '.page-editor, editor-host, affine-page-root, .affine-page-root-block-container'
        )
        .forEach(forceAutoHeight);
      importedRoot
        .querySelectorAll<HTMLElement>('.affine-page-root-block-container')
        .forEach(el => el.style.setProperty('padding-bottom', '0', 'important'));

      // Strip trailing margin on the last block so it doesn't push a few
      // pixels onto a nearly-empty second page.
      const lastBlock = Array.from(
        importedRoot.querySelectorAll<HTMLElement>(
          '.affine-block-component'
        )
      ).pop();
      if (lastBlock) {
        lastBlock.style.setProperty('margin-bottom', '0', 'important');
      }

      // draw saved canvas image to canvas
      const allImportedCanvas = importedRoot.getElementsByTagName('canvas');
      for (const importedCanvas of allImportedCanvas) {
        const canvasKey = importedCanvas.dataset['printToPdfCanvasKey'];
        if (canvasKey) {
          const canvasImg = canvasImgObjectUrlMap.get(canvasKey);
          const ctx = importedCanvas.getContext('2d');
          if (canvasImg && ctx) {
            const image = new Image();
            image.src = canvasImg;
            await image.decode();
            ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
          }
        }
      }

      // Remove lazy loading from all images and force reload
      const allImages = importedRoot.querySelectorAll('img');
      allImages.forEach(img => {
        img.removeAttribute('loading');
        const src = img.getAttribute('src');
        if (src) img.setAttribute('src', src);
      });

      // append to iframe
      doc.body.append(importedRoot);

      // Measure cloned content at print width so we can size the iframe to
      // content height. A much-too-tall iframe makes Chrome emit extra blank
      // pages even when content fits.
      Object.assign(iframe.style, {
        position: 'absolute',
        left: '-9999px',
        top: '0',
        width: '816px',
        height: '2000px',
        visibility: 'hidden',
        border: 'none',
      });
      await new Promise(r => setTimeout(r, 50));
      iframe.style.height = `${doc.body.scrollHeight}px`;

      const pageStyle = doc.createElement('style');
      pageStyle.textContent = `
        @page { size: letter; margin: 0.4in; }
        html, body { margin: 0 !important; padding: 0 !important; }
      `;
      doc.head.appendChild(pageStyle);

      await options.beforeprint?.(iframe);

      // Robust image waiting logic
      const waitForImages = async (container: HTMLElement) => {
        const images: HTMLImageElement[] = [];
        const view = container.ownerDocument.defaultView;
        if (!view) return;

        const findImages = (root: Node) => {
          if (root instanceof view.HTMLImageElement) {
            images.push(root);
          }
          if (
            root instanceof view.HTMLElement ||
            root instanceof view.ShadowRoot
          ) {
            root.childNodes.forEach(findImages);
          }
          if (root instanceof view.HTMLElement && root.shadowRoot) {
            findImages(root.shadowRoot);
          }
        };

        findImages(container);

        await Promise.all(
          images.map(img => {
            if (img.complete) {
              if (img.naturalWidth === 0) {
                console.warn('Image failed to load:', img.src);
              }
              return Promise.resolve();
            }
            return new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          })
        );
      };

      await waitForImages(importedRoot);

      // browser may take some time to load font or other resources
      await (doc.fonts?.ready ??
        new Promise<void>(resolve => {
          setTimeout(() => {
            resolve();
          }, 1000);
        }));

      iframe.contentWindow.onafterprint = async () => {
        iframe.remove();

        // clean up
        for (const canvas of allCanvas) {
          delete canvas.dataset['printToPdfCanvasKey'];
        }
        for (const [_, url] of canvasImgObjectUrlMap) {
          URL.revokeObjectURL(url);
        }

        await options.afterprint?.();

        resolve();
      };

      iframe.contentWindow.print();
    };
  });
}
