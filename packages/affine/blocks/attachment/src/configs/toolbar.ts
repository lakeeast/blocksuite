// toolbar.ts
import { createLitPortal } from '@blocksuite/affine-components/portal';
import {
  AttachmentBlockModel,
  defaultAttachmentProps,
  type EmbedCardStyle,
} from '@blocksuite/affine-model';
import {
  EMBED_CARD_HEIGHT,
  EMBED_CARD_WIDTH,
} from '@blocksuite/affine-shared/consts';
import {
  ActionPlacement,
  blockCommentToolbarButton,
  type ToolbarAction,
  type ToolbarActionGroup,
  type ToolbarModuleConfig,
  ToolbarModuleExtension,
} from '@blocksuite/affine-shared/services';
import { getBlockProps } from '@blocksuite/affine-shared/utils';
import { Bound } from '@blocksuite/global/gfx';
import {
  CaptionIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  DuplicateIcon,
  EditIcon,
  ReplaceIcon,
  ResetIcon,
} from '@blocksuite/icons/lit';
import { BlockFlavourIdentifier } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { flip, offset } from '@floating-ui/dom';
import { computed } from '@preact/signals-core';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import JSZip from 'jszip';
import { toast } from '@blocksuite/affine-components/toast';

import { AttachmentBlockComponent } from '../attachment-block';
import { RenameModal } from '../components/rename-model';
import { AttachmentEmbedProvider } from '../embed';

// Declare global decoder type
interface DecoderCoreApi {
  studyManager: {
    studies: Record<string, any>;
    addStudy(id: string, data: any): void;
  };
  createStudy(): { id: string; getImageId: (index: number) => string; getStorageId: () => string; getBlobs: () => any[] };
  createSeriesFromFiles(studyManager: any, files: File[]): Promise<void>;
  saveStudy(data: { studyId: string; data: any }): void;
  displayImage(studyManager: any, element: HTMLElement, imageId: string, isPreview: boolean): void;
  deletePreview(element: HTMLElement): void;
}

declare global {
  interface Window {
    decoder: { CoreApi: DecoderCoreApi };
  }
}

// Utility to normalize filenames
function normalizeFilename(filename: string): string {
  if (typeof filename !== 'string') return '';
  return filename.trim().toLowerCase().split('/').pop() || '';
}

// Utility to get attachment blob
async function getAttachmentBlob(block: AttachmentBlockComponent): Promise<Blob | null> {
  const { model, blobUrl, resourceController, host, std } = block;

  console.log('getAttachmentBlob called for:', {
    name: model.props.name,
    sourceId: model.props.sourceId$.value,
    blobUrl: blobUrl,
    downloading: resourceController.state$.peek().downloading,
    blobSyncAvailable: !!std.store.blobSync,
  });

  if (resourceController.state$.peek().downloading) {
    console.log('Download in progress, resetting state for:', model.props.name);
    resourceController.updateState({ downloading: false, state: 'none' });
  }

  try {
    resourceController.updateState({ downloading: true });
    console.log('Forcing refreshData for:', model.props.name);
    await block.refreshData();
    console.log('refreshData completed, checking blobUrl:', block.blobUrl);

    if (block.blobUrl) {
      console.log('Fetching blob from blobUrl:', block.blobUrl);
      const response = await fetch(block.blobUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch blob from blobUrl: ${response.statusText}`);
      }
      const blob = await response.blob();
      console.log('Blob fetched from blobUrl, size:', blob.size);
      resourceController.updateState({ downloading: false, state: 'none' });
      return blob;
    }

    if (!model.props.sourceId$.value) {
      console.log('No sourceId, checking for local blob');
      const localBlob = await std.store.blobSync.getLocalBlob?.(model.id);
      if (localBlob) {
        console.log('Local blob found, size:', localBlob.size);
        resourceController.updateState({ downloading: false, state: 'none' });
        return localBlob;
      }
      throw new Error('No sourceId or local blob available for attachment');
    }

    console.log('Fetching blob from blobSync with sourceId:', model.props.sourceId$.value);
    const blob = await std.store.blobSync.get(model.props.sourceId$.value);
    if (!blob) {
      throw new Error(`Blob not found in blobSync for sourceId: ${model.props.sourceId$.value}`);
    }
    console.log('Blob fetched from blobSync, size:', blob.size);
    resourceController.updateState({ downloading: false, state: 'none' });
    return blob;
  } catch (error) {
    console.error('Blob fetch error:', error, {
      name: model.props.name,
      sourceId: model.props.sourceId$.value,
      blobUrl: block.blobUrl,
    });
    if (block.blobUrl) {
      toast(host, `Failed to fetch blob for ${model.props.name}!`);
    }
    resourceController.updateState({ downloading: false, state: 'error' });
    return null;
  }
}

// Define ThreeDViewerPopup
@customElement('threed-viewer-popup')
class ThreeDViewerPopup extends LitElement {
  static override styles = css`
    .popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .popup-container {
      background: white;
      width: 90vw;
      height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    .close-button {
      position: absolute;
      top: 10px;
      right: 130px;
      background: #ff4d4f;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 16px;
      z-index: 1001;
    }
    .close-button:hover {
      background: #d9363e;
    }
  `;

  model: AttachmentBlockModel | null = null;
  block: AttachmentBlockComponent | null = null;
  std: any = null;
  onClose: () => void = () => {};
  private _messageListener: (event: MessageEvent) => void;

  constructor() {
    super();
    this._messageListener = this._handleIframeMessage.bind(this);
  }

   override connectedCallback() {
    super.connectedCallback();
    // Attach listener early in lifecycle
    window.addEventListener('message', this._messageListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up
    window.removeEventListener('message', this._messageListener);
  }

   private _handleIframeMessage(event: MessageEvent) {
    // Debug: Log all messages
    console.log('Toolbar received message:', event.data, 'from origin:', event.origin);

    if (event.data?.type === 'registered') {
      console.log(`Toolbar: Custom element ${event.data.component} registered!`);
        this._setupViewerInIframe();
    }
  }


  override firstUpdated() {
    // No direct script loading here; handled in iframe
  }

  override render() {
    return html`
      <div class="popup-overlay" @click=${this._handleOutsideClick}>
        <div class="popup-container">
          <button class="close-button" @click=${this._handleClose}>Close</button>
          <iframe
            id="threed-viewer-iframe"
            style="width: 100%; height: 100%; border: none;"
            @load=${this._initializeIframe}
          ></iframe>
        </div>
      </div>
    `;
  }

  private async _initializeIframe() {
    const iframe = this.shadowRoot?.querySelector('#threed-viewer-iframe') as HTMLIFrameElement;
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) {
      console.error('Iframe not ready');
      toast(this.block?.host, 'Failed to load 3D viewer');
      return;
    }
    const doc = iframe.contentDocument!;

    // Load the script dynamically and await its completion
    const script = doc.createElement('script');
    script.type = 'module';
    script.src = '/block/qt-gl/js/index.js';
    doc.head.appendChild(script);  // Or doc.body if no head
  }

  private async _setupViewerInIframe() {
    const iframe = this.shadowRoot?.querySelector('#threed-viewer-iframe') as HTMLIFrameElement;
    const doc = iframe.contentDocument!;

    // Create the <gl-editor> element inside the iframe
    const threedElement = doc.createElement('gl-editor');

    // Style the element to fill the iframe
    threedElement.style.width = '100%';
    threedElement.style.height = '100%';

    // Append to iframe body
    doc.body.style.margin = '0';
    doc.body.style.overflow = 'hidden';
    doc.body.appendChild(threedElement);

    // Now perform the studyManager setup
    const workspace = this.std?.store.workspace as any;
    if (!workspace) {
      console.error('Workspace not found');
      toast(this.block?.host, 'Failed to load 3D viewer');
      return;
    }
    const fileName = this.model?.props.name || '';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    let url = this.model?.props.blobUrl || '';
    if (!url) {
      const blob = await getAttachmentBlob(this.block!);
      url = URL.createObjectURL(blob);
    }
    const mgr = await threedElement._instance.exposed.createVtkManager(extension); // Static function
    await mgr.loadFromUrl(url); // Alternatively
    try {
      // TODO: load 3D model from file
      //await (threedElement as any).setStudyManager(studyManager);
      await threedElement._instance.exposed.setVtkManager(mgr); // Load the mgr
      console.log(`Set setVtkManager for model ${this.model?.props.name}`);

      // Clean up event listeners
      const cleanup = () => {
        (threedElement as any).clearViews?.();
        threedElement.remove();
      };

      this.addEventListener('close', () => {
        cleanup();
        this.onClose?.();
        this.remove();
      });

      const abortController = (this as any).abortController as AbortController | undefined;
      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          console.log('Cleaning up DICOM viewer on abort');
          cleanup();
          this.dispatchEvent(new CustomEvent('close'));
        });
      }
    } catch (error) {
      console.error('Failed to initialize DICOM viewer in iframe:', error);
      toast(this.block?.host, 'Failed to load DICOM viewer');
    }
  }

  private _handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.popup-container')) {
      this._handleClose();
    }
  }

  private _handleClose() {
    console.log('Closing popup');
    this.onClose();
  }
}

let currentThreeDPopupInstance: ThreeDViewerPopup | null = null;

/////////////////////////
// AR Viewer
// Define ARViewerPopup
@customElement('ar-viewer-popup')
class ARViewerPopup extends LitElement {
  static override styles = css`
    .popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .popup-container {
      background: white;
      width: 90vw;
      height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    .close-button {
      position: absolute;
      top: 10px;
      right: 130px;
      background: #ff4d4f;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 16px;
      z-index: 1001;
    }
    .close-button:hover {
      background: #d9363e;
    }
  `;

  model: AttachmentBlockModel | null = null;
  block: AttachmentBlockComponent | null = null;
  std: any = null;
  onClose: () => void = () => {};

  constructor() {
    super();
  }

   override connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  override firstUpdated() {
    // No direct script loading here; handled in iframe
  }

  override render() {
    return html`
      <div class="popup-overlay" @click=${this._handleOutsideClick}>
        <div class="popup-container">
          <button class="close-button" @click=${this._handleClose}>Close</button>
          <iframe
            id="ar-viewer-iframe"
            style="width: 100%; height: 100%; border: none;"
            @load=${this._initializeIframe}
          ></iframe>
        </div>
      </div>
    `;
  }

  private async _initializeIframe() {
    const iframe = this.shadowRoot?.querySelector('#ar-viewer-iframe') as HTMLIFrameElement;
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) {
      console.error('Iframe not ready');
      toast(this.block?.host, 'Failed to load 3D viewer');
      return;
    }
    const doc = iframe.contentDocument!;

    // Load the script dynamically and await its completion
    const script = doc.createElement('script');
    script.type = 'module';
    script.src = '/block/qt-ar/model-viewer.min.js';
    doc.head.appendChild(script);  // Or doc.body if no head
    this._setupViewerInIframe();
  }

  private async _setupViewerInIframe() {
    const iframe = this.shadowRoot?.querySelector('#ar-viewer-iframe') as HTMLIFrameElement;
    const doc = iframe.contentDocument!;

    // Create the <model-viewer> element inside the iframe
    const arElement = doc.createElement('model-viewer');

    // Style the element to fill the iframe
    arElement.style.width = '100%';
    arElement.style.height = '100%';

    // Append to iframe body
    doc.body.style.margin = '0';
    doc.body.style.overflow = 'hidden';

    // Now perform the studyManager setup
    const workspace = this.std?.store.workspace as any;
    if (!workspace) {
      console.error('Workspace not found');
      toast(this.block?.host, 'Failed to load 3D viewer');
      return;
    }
    const fileName = this.model?.props.name || '';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    let url = this.model?.props.blobUrl || '';
    if (!url) {
      const blob = await getAttachmentBlob(this.block!);
      url = URL.createObjectURL(blob);
    }

    arElement.setAttribute('shadow-intensity', '1');
    arElement.setAttribute('ar', ''); // Boolean attribute for AR support
    arElement.setAttribute('camera-controls', ''); // Boolean attribute for camera controls
    arElement.setAttribute('touch-action', 'pan-y');
    arElement.setAttribute('src', url);
    doc.body.appendChild(arElement);
    
    try {
      // Clean up event listeners
      const cleanup = () => {
        (arElement as any).clearViews?.();
        arElement.remove();
      };

      this.addEventListener('close', () => {
        cleanup();
        this.onClose?.();
        this.remove();
      });

      const abortController = (this as any).abortController as AbortController | undefined;
      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          console.log('Cleaning up DICOM viewer on abort');
          cleanup();
          this.dispatchEvent(new CustomEvent('close'));
        });
      }
    } catch (error) {
      console.error('Failed to initialize DICOM viewer in iframe:', error);
      toast(this.block?.host, 'Failed to load DICOM viewer');
    }
  }

  private _handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.popup-container')) {
      this._handleClose();
    }
  }

  private _handleClose() {
    console.log('Closing popup');
    this.onClose();
  }
}

let currentARPopupInstance: ARViewerPopup | null = null;
// End of AR Viewer
/////////////////////////


@customElement('dicom-viewer-popup')
class DicomViewerPopup extends LitElement {
  static override styles = css`
    .popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .popup-container {
      background: white;
      width: 90vw;
      height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    .close-button {
      position: absolute;
      top: 10px;
      right: 130px;
      background: #ff4d4f;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 16px;
      z-index: 1001;
    }
    .close-button:hover {
      background: #d9363e;
    }
  `;

  model: AttachmentBlockModel | null = null;
  block: AttachmentBlockComponent | null = null;
  std: any = null;
  onClose: () => void = () => {};

  override firstUpdated() {
    // No direct script loading here; handled in iframe
  }

  override render() {
    return html`
      <div class="popup-overlay" @click=${this._handleOutsideClick}>
        <div class="popup-container">
          <button class="close-button" @click=${this._handleClose}>Close</button>
          <iframe
            id="dicom-viewer-iframe"
            style="width: 100%; height: 100%; border: none;"
            @load=${this._initializeIframe}
          ></iframe>
        </div>
      </div>
    `;
  }

  private _initializeIframe() {
    const iframe = this.shadowRoot?.querySelector('#dicom-viewer-iframe') as HTMLIFrameElement;
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) {
      console.error('Iframe not ready');
      toast(this.block?.host, 'Failed to load DICOM viewer');
      return;
    }

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;

    // Add Material Design CSS links to iframe head
    const link1 = doc.createElement('link');
    link1.rel = 'stylesheet';
    link1.href = '/block/material/purple-green.css';
    doc.head.appendChild(link1);

    const link2 = doc.createElement('link');
    link2.rel = 'stylesheet';
    link2.href = '/block/material/material-design-icons.css';
    doc.head.appendChild(link2);

    // Alias the main window's decoder to the iframe's window
    if (window.decoder) {
      win.decoder = window.decoder;
      console.log('Aliased parent decoder to iframe window');
    } else {
      console.error('Parent decoder not found');
      toast(this.block?.host, 'Failed to load DICOM viewer');
      return;
    }

    // Now load quantant-viewer.js
    const script = doc.createElement('script');
    script.src = '/block/qt-sdk/quantant-viewer.js';
    script.async = true;
    script.onload = () => {
      console.log('quantant-viewer.js loaded in iframe');
      this._setupViewerInIframe(iframe);
    };
    script.onerror = () => {
      console.error('Failed to load quantant-viewer.js in iframe');
      toast(this.block?.host, 'Failed to load DICOM viewer');
    };
    doc.head.appendChild(script);
  }

  private async _setupViewerInIframe(iframe: HTMLIFrameElement) {
    const doc = iframe.contentDocument!;
    const win = iframe.contentWindow!;

    // Create the <quantantdk-slide-dicom> element inside the iframe
    const dicomElement = doc.createElement('quantantdk-slide-dicom');
    dicomElement.setAttribute('ng-version', '8.2.14');
    dicomElement.setAttribute('share_type', 'instant');

    // Add slots
    const titleSlot = doc.createElement('h1');
    titleSlot.setAttribute('slot', 'title');
    dicomElement.appendChild(titleSlot);

    const contentSlot = doc.createElement('section');
    contentSlot.setAttribute('slot', 'content');
    dicomElement.appendChild(contentSlot);

    // Style the element to fill the iframe
    dicomElement.style.width = '100%';
    dicomElement.style.height = '100%';

    // Append to iframe body
    doc.body.style.margin = '0';
    doc.body.style.overflow = 'hidden';
    doc.body.appendChild(dicomElement);

    // Now perform the studyManager setup
    const workspace = this.std?.store.workspace as any;
    if (!workspace || !workspace.studyManagerRegistry) {
      console.error('Workspace or studyManagerRegistry not found');
      toast(this.block?.host, 'Failed to load DICOM viewer');
      return;
    }

    const fileName = this.model?.props.name || '';
    const dicomGuid = fileName.replace(/\.[^/.]+$/, '');
    if (!dicomGuid) {
      console.error('No dicomGuid found in attachment model');
      toast(this.block?.host, 'No DICOM study ID found');
      return;
    }

    const studyManager = workspace.studyManagerRegistry.get(dicomGuid);
    if (!studyManager) {
      console.error(`No studyManager found for dicomGuid ${dicomGuid}`);
      toast(this.block?.host, 'DICOM study not found');
      return;
    }

    try {
      // Set studyManager on the dicomElement
      await (dicomElement as any).setStudyManager(studyManager);
      console.log(`Set studyManager for dicomGuid ${dicomGuid}`);

      // Add event listeners for weasisEvent and ohifEvent
      const weasisListener = (event: any) => {
        const storageId = event.detail?.studyManager?.getStorageId?.();
        window.parent.postMessage(
          { type: 'weasis', storageId },
          '*'
        );
      };

      const ohifListener = (event: any) => {
        const storageId = event.detail?.studyManager?.getStorageId?.();
        if (storageId) {
          window.parent.postMessage(
            { type: 'ohif', storageId },
            '*'
          );
        } else {
          const localBlobs = event.detail?.studyManager?.getBlobs?.();
          window.parent.postMessage(
            { type: 'blobs', blobs: localBlobs },
            '*'
          );
        }
      };

      dicomElement.addEventListener('weasisEvent', weasisListener);
      dicomElement.addEventListener('ohifEvent', ohifListener);

      // Clean up event listeners
      const cleanup = () => {
        (dicomElement as any).clearViews?.();
        dicomElement.removeEventListener('weasisEvent', weasisListener);
        dicomElement.removeEventListener('ohifEvent', ohifListener);
        dicomElement.remove();
      };

      this.addEventListener('close', () => {
        cleanup();
        this.onClose?.();
        this.remove();
      });

      const abortController = (this as any).abortController as AbortController | undefined;
      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          console.log('Cleaning up DICOM viewer on abort');
          cleanup();
          this.dispatchEvent(new CustomEvent('close'));
        });
      }
    } catch (error) {
      console.error('Failed to initialize DICOM viewer in iframe:', error);
      toast(this.block?.host, 'Failed to load DICOM viewer');
    }
  }

  private _handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.popup-container')) {
      this._handleClose();
    }
  }

  private _handleClose() {
    console.log('Closing popup');
    this.onClose();
  }
}

let currentPopupInstance: DicomViewerPopup | null = null;
// End define ThreeDViewerPopup
/////////////////////////////////

const trackBaseProps = {
  category: 'attachment',
  type: 'card view',
};

export const attachmentViewDropdownMenu = {
  id: 'b.conversions',
  actions: [
    {
      id: 'card',
      label: 'Card view',
      run(ctx) {
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        if (!model) return;

        const style = defaultAttachmentProps.style!;
        const width = EMBED_CARD_WIDTH[style];
        const height = EMBED_CARD_HEIGHT[style];
        const bounds = Bound.deserialize(model.xywh);
        bounds.w = width;
        bounds.h = height;

        ctx.store.updateBlock(model, {
          style,
          embed: false,
          xywh: bounds.serialize(),
        });
      },
    },
    {
      id: 'embed',
      label: 'Embed view',
      disabled: ctx => {
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        console.log('Embed view disabled check:', {
          modelExists: !!model,
          sourceId: !!model?.props.sourceId$.value,
          fileName: model?.props.name,
        });
        return !model || !model?.props.sourceId$.value || model.props.name?.endsWith('.dicomdir');
      },
      run(ctx) {
        console.log('Embed view triggered:', {
          name: ctx.getCurrentModelByType(AttachmentBlockModel)?.props.name,
          embed: ctx.getCurrentModelByType(AttachmentBlockModel)?.props.embed$.value,
        });
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
        if (!model || !block) {
          console.error('Missing model or block');
          toast(block?.host, 'Failed to load embed view');
          return;
        }

        try {
          const provider = ctx.std.get(AttachmentEmbedProvider);
          console.log('Provider fetched:', !!provider);
          ctx.store.updateBlock(model, { embed: false });
          console.log('Reset embed to false');
          setTimeout(() => {
            provider.convertTo(model);
            block.reload();
            console.log('Reload called, embed state:', model.props.embed$.value, 'blobUrl:', block.blobUrl);
            if (provider.shouldBeConverted(model) && !ctx.hasSelectedSurfaceModels) {
              ctx.reset();
              ctx.select('note');
            }
          }, 0);
        } catch (err) {
          console.error('Embed view failed:', {
            error: err.message,
            stack: err.stack,
            name: model.props.name,
          });
          toast(block?.host, `Failed to load ${model.props.name}`);
        }

        ctx.track('SelectedView', {
          ...trackBaseProps,
          control: 'select view',
          type: 'embed view',
        });
      },
    },
    {
      id: 'dicom',
      label: 'DICOM view',
      disabled: ctx => {
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        console.log('DICOM view disabled check:', {
          modelExists: !!model,
          sourceId: !!model?.props.sourceId$.value,
          fileName: model?.props.name,
        });
        if (!model) return true;
        const fileName = model.props.name || '';
        return !fileName.endsWith('.dicomdir') || !model.props.sourceId$.value;
      },
      run(ctx) {
        console.log('DICOM view triggered:', {
          name: ctx.getCurrentModelByType(AttachmentBlockModel)?.props.name,
        });
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
        if (!model || !block) {
          console.error('Missing model or block');
          toast(block?.host, 'Failed to load DICOM view');
          return;
        }

        if (currentPopupInstance) {
          console.log('Removing existing popup instance');
          currentPopupInstance.onClose();
          currentPopupInstance = null;
        }

        console.log('Creating DICOM viewer popup for:', model.props.name);
        const abortController = new AbortController();
        const popup = document.createElement('dicom-viewer-popup') as DicomViewerPopup;
        popup.model = model;
        popup.block = block;
        popup.std = ctx.std;
        console.log('Popup set:', { model: popup.model?.props.name, block: !!popup.block });
        popup.onClose = () => {
          currentPopupInstance?.remove();
          currentPopupInstance = null;
          abortController.abort();
        };
        currentPopupInstance = popup;

        const portal = createLitPortal({
          template: popup,
          abortController,
        });
        console.log('currentPopupInstance created:', !!currentPopupInstance);

        ctx.track('SelectedView', {
          ...trackBaseProps,
          control: 'select view',
          type: 'dicom view',
        });
      },
    },
    {
      id: 'threeD',
      label: '3D view',
      disabled: ctx => {
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        console.log('3D view disabled check:', {
          modelExists: !!model,
          sourceId: !!model?.props.sourceId$.value,
          fileName: model?.props.name,
        });
        if (!model) return true;
        const fileName = model.props.name || '';
        const is3DFile = fileName.endsWith('.stl') || fileName.endsWith('.obj');
        return !is3DFile || !model.props.sourceId$.value;
      },
      run(ctx) {
        console.log('3D view triggered:', {
          name: ctx.getCurrentModelByType(AttachmentBlockModel)?.props.name,
        });
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
        if (!model || !block) {
          console.error('Missing model or block');
          toast(block?.host, 'Failed to load 3D view');
          return;
        }

        if (currentThreeDPopupInstance) {
          console.log('Removing existing popup instance');
          currentThreeDPopupInstance.onClose();
          currentThreeDPopupInstance = null;
        }

        console.log('Creating 3D viewer popup for:', model.props.name);
        const abortController = new AbortController();
        const popup = document.createElement('threed-viewer-popup') as ThreeDViewerPopup;
        popup.model = model;
        popup.block = block;
        popup.std = ctx.std;
        console.log('Popup set:', { model: popup.model?.props.name, block: !!popup.block });
        popup.onClose = () => {
          currentThreeDPopupInstance?.remove();
          currentThreeDPopupInstance = null;
          abortController.abort();
        };
        currentThreeDPopupInstance = popup;

        const portal = createLitPortal({
          template: popup,
          abortController,
        });
        console.log('currentThreeDPopupInstance created:', !!currentThreeDPopupInstance);

        ctx.track('SelectedView', {
          ...trackBaseProps,
          control: 'select view',
          type: 'dicom view',
        });
      },
    },
{
      id: 'ar',
      label: 'AR view',
      disabled: ctx => {
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        console.log('AR view disabled check:', {
          modelExists: !!model,
          sourceId: !!model?.props.sourceId$.value,
          fileName: model?.props.name,
        });
        if (!model) return true;
        const fileName = model.props.name || '';
        const isArFile = fileName.endsWith('.glb');
        return !isArFile || !model.props.sourceId$.value;
      },
      run(ctx) {
        console.log('AR view triggered:', {
          name: ctx.getCurrentModelByType(AttachmentBlockModel)?.props.name,
        });
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
        if (!model || !block) {
          console.error('Missing model or block');
          toast(block?.host, 'Failed to load 3D view');
          return;
        }

        if (currentThreeDPopupInstance) {
          console.log('Removing existing popup instance');
          currentThreeDPopupInstance.onClose();
          currentThreeDPopupInstance = null;
        }

        console.log('Creating 3D viewer popup for:', model.props.name);
        const abortController = new AbortController();
        const popup = document.createElement('threed-viewer-popup') as ThreeDViewerPopup;
        popup.model = model;
        popup.block = block;
        popup.std = ctx.std;
        console.log('Popup set:', { model: popup.model?.props.name, block: !!popup.block });
        popup.onClose = () => {
          currentThreeDPopupInstance?.remove();
          currentThreeDPopupInstance = null;
          abortController.abort();
        };
        currentThreeDPopupInstance = popup;

        const portal = createLitPortal({
          template: popup,
          abortController,
        });
        console.log('currentThreeDPopupInstance created:', !!currentThreeDPopupInstance);

        ctx.track('SelectedView', {
          ...trackBaseProps,
          control: 'select view',
          type: 'dicom view',
        });
      },
    }
  ],
  content(ctx) {
    console.log('attachmentViewDropdownMenu.content called', {
      block: !!ctx.getCurrentBlockByType(AttachmentBlockComponent),
    });
    const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
    if (!block) {
      console.log('No AttachmentBlockComponent found');
      return null;
    }

    const model = block.model;
    const actions = computed(() => {
      console.log('Computing actions for:', model.props.name);
      const [cardAction, embedAction, dicomAction] = this.actions.map(action => ({
        ...action,
      }));

      const sourceId = Boolean(model.props.sourceId$.value);
      const fileName = model.props.name || '';
      const isDicom = fileName.endsWith('.dicomdir');

      console.log('Action state:', { sourceId, isDicom });

      cardAction.disabled = false;
      embedAction.disabled = !sourceId || isDicom;
      dicomAction.disabled = !isDicom || !sourceId;

      console.log('Actions computed:', {
        cardDisabled: cardAction.disabled,
        embedDisabled: embedAction.disabled,
        dicomDisabled: dicomAction.disabled,
      });
      return isDicom ? [cardAction, dicomAction] : [cardAction, embedAction];
    });

    const viewType$ = computed(() => {
      const embed = model.props.embed$.value ?? false;
      const fileName = model.props.name || '';
      const isDicom = fileName.endsWith('.dicomdir');
      const is3DFile = fileName.endsWith('.stl') || fileName.endsWith('.obj');
      const isARFile = fileName.endsWith('.glb');

      console.log('viewType$ computed:', { embed, isDicom, is3DFile, isARFile });

      if (isDicom) {
        return 'DICOM view';
      } else if (is3DFile) {
        return '3D view';
      } 
      else if (isARFile) {
        return 'AR view'
      }
      else {
        return embed ? 'Embed view' : 'Card view';
      }
    });

    const onToggle = (e: CustomEvent<boolean>) => {
      e.stopPropagation();
      const opened = e.detail;
      if (!opened) return;
      console.log('Dropdown toggled:', opened, 'viewType:', viewType$.value);
      if (block) {
        if (viewType$.value === 'Embed view') {
          console.log('Forcing reload for Embed view:', model.props.name);
          block.resourceController.updateState({ downloading: true });
          block.reload();
          block.resourceController.updateState({ downloading: false, state: 'none' });
        } else if (viewType$.value === 'DICOM view') {
          console.log('Triggering DICOM view for:', model.props.name);

          if (currentPopupInstance) {
            console.log('Removing existing popup instance');
            currentPopupInstance.onClose();
            currentPopupInstance = null;
          }

          console.log('Creating DICOM viewer popup for:', model.props.name);
          const abortController = new AbortController();
          const popup = document.createElement('dicom-viewer-popup') as DicomViewerPopup;
          popup.model = model;
          popup.block = block;
          popup.std = ctx.std;
          console.log('Popup set:', { model: popup.model?.props.name, block: !!popup.block });
          popup.onClose = () => {
            currentPopupInstance?.remove();
            currentPopupInstance = null;
            abortController.abort();
          };
          currentPopupInstance = popup;

          const portal = createLitPortal({
            template: popup,
            abortController,
          });
          console.log('currentPopupInstance created:', !!currentPopupInstance);

          ctx.track('SelectedView', {
            ...trackBaseProps,
            control: 'select view',
            type: 'dicom view',
          });
        }
        else if (viewType$.value === '3D view') {
          console.log('Triggering 3D view for:', model.props.name);

          if (currentThreeDPopupInstance) {
            console.log('Removing existing popup instance');
            currentThreeDPopupInstance.onClose();
            currentThreeDPopupInstance = null;
          }

          console.log('Creating 3D viewer popup for:', model.props.name);
          const abortController = new AbortController();
          const popup = document.createElement('threed-viewer-popup') as ThreeDViewerPopup;
          popup.model = model;
          popup.block = block;
          popup.std = ctx.std;
          console.log('Popup set:', { model: popup.model?.props.name, block: !!popup.block });
          popup.onClose = () => {
            currentThreeDPopupInstance?.remove();
            currentThreeDPopupInstance = null;
            abortController.abort();
          };
          currentThreeDPopupInstance = popup;

          const portal = createLitPortal({
            template: popup,
            abortController,
          });
          console.log('currentThreeDPopupInstance created:', !!currentThreeDPopupInstance);
        }
        else if (viewType$.value === 'AR view') {
          console.log('Triggering AR view for:', model.props.name);

          if (currentARPopupInstance) {
            console.log('Removing existing popup instance');
            currentARPopupInstance.onClose();
            currentARPopupInstance = null;
          }

          console.log('Creating AR viewer popup for:', model.props.name);
          const abortController = new AbortController();
          const popup = document.createElement('ar-viewer-popup') as ARViewerPopup;
          popup.model = model;
          popup.block = block;
          popup.std = ctx.std;
          console.log('Popup set:', { model: popup.model?.props.name, block: !!popup.block });
          popup.onClose = () => {
            currentThreeDPopupInstance?.remove();
            currentThreeDPopupInstance = null;
            abortController.abort();
          };
          currentARPopupInstance = popup;

          const portal = createLitPortal({
            template: popup,
            abortController,
          });
          console.log('currentARPopupInstance created:', !!currentARPopupInstance);
        }
      }
      ctx.track('OpenedViewSelector', {
        ...trackBaseProps,
        control: 'switch view',
      });
    };

    return html`<affine-view-dropdown-menu
      @toggle=${onToggle}
      .actions=${actions.value}
      .context=${ctx}
      .viewType$=${viewType$}
    ></affine-view-dropdown-menu>`;
  },
} as const satisfies ToolbarActionGroup<ToolbarAction>;

const replaceAction = {
  id: 'c.replace',
  tooltip: 'Replace attachment',
  icon: ReplaceIcon(),
  disabled(ctx) {
    const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
    if (!block) return true;

    const { downloading = false, uploading = false } =
      block.resourceController.state$.value;
    return downloading || uploading;
  },
  run(ctx) {
    const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
    block?.replace().catch(console.error);
  },
  when: ctx => false, // Hide "Replace Attachment" always
} as const satisfies ToolbarAction;

const downloadAction = {
  id: 'd.download',
  tooltip: 'Download',
  icon: DownloadIcon(),
  run(ctx) {
    const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
    block?.download();
  },
  when(ctx) {
    const model = ctx.getCurrentModelByType(AttachmentBlockModel);
    if (!model) return false;
    return model.props.style !== 'citation' && !model.props.footnoteIdentifier;
  },
} as const satisfies ToolbarAction;

const captionAction = {
  id: 'e.caption',
  tooltip: 'Caption',
  icon: CaptionIcon(),
  run(ctx) {
    const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
    block?.captionEditor?.show();

    ctx.track('OpenedCaptionEditor', {
      ...trackBaseProps,
      control: 'add caption',
    });
  },
  when: ctx => !ctx.store.readonly, // Hide in readonly mode
} as const satisfies ToolbarAction;

const builtinToolbarConfig = {
  actions: [
    {
      id: 'a.rename',
      content(ctx) {
        console.log('Rename action content called', {
          blockExists: !!ctx.getCurrentBlockByType(AttachmentBlockComponent),
        });
        const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
        if (!block) return null;

        if (ctx.store.readonly) return null; // Hide in readonly mode

        const abortController = new AbortController();
        abortController.signal.onabort = () => ctx.show();

        return html`
          <editor-icon-button
            aria-label="Rename"
            .tooltip="${'Rename'}"
            @click=${() => {
              ctx.hide();

              createLitPortal({
                template: RenameModal({
                  model: block.model,
                  editorHost: ctx.host,
                  abortController,
                }),
                computePosition: {
                  referenceElement: block,
                  placement: 'top-start',
                  middleware: [flip(), offset(4)],
                },
                abortController,
              });
            }}
          >
            ${EditIcon()}
          </editor-icon-button>
        `;
      },
    },
    attachmentViewDropdownMenu,
    replaceAction,
    downloadAction,
    captionAction,
    {
      id: 'f.comment',
      ...blockCommentToolbarButton,
    },
    {
      placement: ActionPlacement.More,
      id: 'a.clipboard',
      when: ctx => !ctx.store.readonly, // Hide in readonly mode
      actions: [
        {
          id: 'copy',
          label: 'Copy',
          icon: CopyIcon(),
          run(ctx) {
            const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
            block?.copy();
          },
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: DuplicateIcon(),
          run(ctx) {
            const model = ctx.getCurrentModelByType(AttachmentBlockModel);
            if (!model) return;

            ctx.store.addSiblingBlocks(model, [
              {
                flavour: model.flavour,
                ...getBlockProps(model),
              },
            ]);
          },
        },
      ],
    },
    {
      placement: ActionPlacement.More,
      id: 'b.refresh',
      when: ctx => !ctx.store.readonly, // Hide in readonly mode
      label: 'Reload',
      icon: ResetIcon(),
      run(ctx) {
        const block = ctx.getCurrentBlockByType(AttachmentBlockComponent);
        block?.reload();

        ctx.track('AttachmentReloadedEvent', {
          ...trackBaseProps,
          control: 'reload',
          type: block?.model.props.name.split('.').pop() ?? '',
        });
      },
    },
    {
      placement: ActionPlacement.More,
      id: 'c.delete',
      when: ctx => !ctx.store.readonly, // Hide in readonly mode
      label: 'Delete',
      icon: DeleteIcon(),
      variant: 'destructive',
      run(ctx) {
        const model = ctx.getCurrentModel();
        if (!model) return;

        ctx.store.deleteBlock(model.id);

        ctx.select('note');
        ctx.reset();
      },
    },
  ],
} as const satisfies ToolbarModuleConfig;

const builtinSurfaceToolbarConfig = {
  actions: [
    attachmentViewDropdownMenu,
    {
      id: 'c.style',
      actions: [
        {
          id: 'horizontalThin',
          label: 'Horizontal style',
        },
        {
          id: 'cubeThick',
          label: 'Vertical style',
        },
      ],
      content(ctx) {
        console.log('Style action content called', {
          modelExists: !!ctx.getCurrentModelByType(AttachmentBlockModel),
        });
        const model = ctx.getCurrentModelByType(AttachmentBlockModel);
        if (!model) return null;

        const actions = this.actions.map(action => ({
          ...action,
          run: ({ store }) => {
            console.log('Style action run:', action.id);
            const style = action.id as EmbedCardStyle;
            const bounds = Bound.deserialize(model.xywh);
            bounds.w = EMBED_CARD_WIDTH[style];
            bounds.h = EMBED_CARD_HEIGHT[style];
            const xywh = bounds.serialize();

            store.updateBlock(model, { style, xywh });

            ctx.track('SelectedCardStyle', {
              ...trackBaseProps,
              page: 'whiteboard editor',
              control: 'select card style',
              type: style,
            });
          },
        })) satisfies ToolbarAction[];
        const style$ = model.props.style$;
        const onToggle = (e: CustomEvent<boolean>) => {
          e.stopPropagation();
          const opened = e.detail;
          if (!opened) return;

          ctx.track('OpenedCardStyleSelector', {
            ...trackBaseProps,
            page: 'whiteboard editor',
            control: 'switch card style',
          });
        };

        return html`${keyed(
          model,
          html`<affine-card-style-dropdown-menu
            @toggle=${onToggle}
            .actions=${actions}
            .context=${ctx}
            .style$=${style$}
          ></affine-card-style-dropdown-menu>`
        )}`;
      },
    } satisfies ToolbarActionGroup<ToolbarAction>,
    {
      ...replaceAction,
      id: 'd.replace',
    },
    {
      ...downloadAction,
      id: 'e.download',
    },
    {
      ...captionAction,
      id: 'f.caption',
    },
  ],
  when: ctx => {
    console.log('builtinSurfaceToolbarConfig when check:', {
      surfaceModels: ctx.getSurfaceModelsByType(AttachmentBlockModel).length,
    });
    return ctx.getSurfaceModelsByType(AttachmentBlockModel).length === 1;
  },
} as const satisfies ToolbarModuleConfig;

export const createBuiltinToolbarConfigExtension = (
  flavour: string
): ExtensionType[] => {
  console.log('createBuiltinToolbarConfigExtension called with flavour:', flavour);
  const name = flavour.split(':').pop();

  return [
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier(flavour),
      config: builtinToolbarConfig,
    }),

    ToolbarModuleExtension({
      id: BlockFlavourIdentifier(`affine:surface:${name}`),
      config: builtinSurfaceToolbarConfig,
    }),
  ];
};