import { getInlineEditorByModel } from '@blocksuite/affine-rich-text';
import type { AffineInlineEditor } from '@blocksuite/affine-shared/types';
import { DisposableGroup } from '@blocksuite/global/disposable';
import { IS_ANDROID } from '@blocksuite/global/env';
import type { UIEventStateContext } from '@blocksuite/std';
import { TextSelection, WidgetComponent } from '@blocksuite/std';
import { InlineEditor } from '@blocksuite/std/inline';
import debounce from 'lodash-es/debounce';

import { AFFINE_SLASH_MENU_TRIGGER_KEY } from './consts';
import { SlashMenuExtension } from './extensions';
import { SlashMenu } from './slash-menu-popover';
import type { SlashMenuConfig, SlashMenuContext, SlashMenuItem } from './types';
import { buildSlashMenuItems } from './utils';
let globalAbortController = new AbortController();

function closeSlashMenu() {
  globalAbortController.abort();
}

const showSlashMenu = debounce(
  ({
    context,
    config,
    container = document.body,
    abortController = new AbortController(),
    configItemTransform,
  }: {
    context: SlashMenuContext;
    config: SlashMenuConfig;
    container?: HTMLElement;
    abortController?: AbortController;
    configItemTransform: (item: SlashMenuItem) => SlashMenuItem;
  }) => {
    // Check if we're in cooldown period to prevent flickering
    if (Date.now() - SlashMenu._lastDismissTime < 300) {
      return;
    }
    
    globalAbortController = abortController;
    const disposables = new DisposableGroup();
    abortController.signal.addEventListener('abort', () =>
      disposables.dispose()
    );

    const inlineEditor = getInlineEditorByModel(context.std, context.model);
    if (!inlineEditor) return;
    const slashMenu = new SlashMenu(inlineEditor, abortController);
    disposables.add(() => slashMenu.remove());
    slashMenu.context = context;
    slashMenu.items = buildSlashMenuItems(
      typeof config.items === 'function' ? config.items(context) : config.items,
      context,
      configItemTransform
    );

    // FIXME(Flrande): It is not a best practice,
    // but merely a temporary measure for reusing previous components.
    // Mount
    container.append(slashMenu);
    return slashMenu;
  },
  100,
  { leading: true }
);

export class AffineSlashMenuWidget extends WidgetComponent {
  private readonly _getInlineEditor = (
    evt: KeyboardEvent | CompositionEvent | InputEvent
  ) => {
    if (evt.target instanceof HTMLElement) {
      const editor = (
        evt.target.closest('.inline-editor') as {
          inlineEditor?: AffineInlineEditor;
        }
      )?.inlineEditor;
      if (editor instanceof InlineEditor) {
        return editor;
      }
    }

    const textSelection = this.host.selection.find(TextSelection);
    if (!textSelection) return;

    const model = this.host.store.getBlock(textSelection.blockId)?.model;
    if (!model) return;

    return getInlineEditorByModel(this.std, model);
  };

  private readonly _handleInput = (
    inlineEditor: InlineEditor,
    isCompositionEnd: boolean
  ) => {
    const inlineRangeApplyCallback = (callback: () => void) => {
      // the inline ranged updated in compositionEnd event before this event callback
      if (isCompositionEnd) {
        callback();
      } else {
        const subscription = inlineEditor.slots.inlineRangeSync.subscribe(
          () => {
            subscription.unsubscribe();
            callback();
          }
        );
      }
    };

    if (this.block?.model.flavour !== 'affine:page') {
      console.error('SlashMenuWidget should be used in RootBlock');
      return;
    }

    inlineRangeApplyCallback(() => {
      const textSelection = this.host.selection.find(TextSelection);
      if (!textSelection) return;

      const block = this.host.view.getBlock(textSelection.blockId);
      if (!block) return;
      const model = block.model;

      if (this.config.disableWhen?.({ model, std: this.std })) return;

      const inlineRange = inlineEditor.getInlineRange();
      if (!inlineRange) return;

      const textPoint = inlineEditor.getTextPoint(inlineRange.index);
      if (!textPoint) return;

      const [leafStart, offsetStart] = textPoint;

      const text = leafStart.textContent
        ? leafStart.textContent.slice(0, offsetStart)
        : '';

      if (!text.endsWith(AFFINE_SLASH_MENU_TRIGGER_KEY)) return;
      
      // Check cooldown to prevent flickering
      if (Date.now() - SlashMenu._lastDismissTime < 300) return;

      closeSlashMenu();
      showSlashMenu({
        context: {
          model,
          std: this.std,
        },
        config: this.config,
        configItemTransform: this.configItemTransform,
      });
    });
  };

  private readonly _onCompositionEnd = (ctx: UIEventStateContext) => {
    const event = ctx.get('defaultState').event as CompositionEvent;

    if (event.data !== AFFINE_SLASH_MENU_TRIGGER_KEY) return;

    const inlineEditor = this._getInlineEditor(event);
    if (!inlineEditor) return;

    this._handleInput(inlineEditor, true);
  };

  private readonly _onKeyDown = (ctx: UIEventStateContext) => {
    const eventState = ctx.get('keyboardState');
    const event = eventState.raw;

    const key = event.key;

    // Fix for Android: Skip isComposing check as Android keyboards 
    // incorrectly set isComposing=true for simple characters like '/'
    if (event.isComposing && !IS_ANDROID) return;
    if (key !== AFFINE_SLASH_MENU_TRIGGER_KEY) return;

    const inlineEditor = this._getInlineEditor(event);
    if (!inlineEditor) return;

    this._handleInput(inlineEditor, false);
  };





  get config() {
    return this.std.get(SlashMenuExtension).config;
  }

  // TODO(@L-Sun): Remove this when moving each config item to corresponding blocks
  // This is a temporary way for patching the slash menu config
  configItemTransform: (item: SlashMenuItem) => SlashMenuItem = item => item;

  private readonly _onBeforeInput = (ctx: UIEventStateContext) => {
    const event = ctx.get('defaultState').event as InputEvent;

    // Handle Android keyboards that might not trigger keydown events properly
    if (event.data !== AFFINE_SLASH_MENU_TRIGGER_KEY) return;

    // For Android, be more aggressive
    if (IS_ANDROID) {
      // Don't prevent default - let the character be typed first
      const inlineEditor = this._getInlineEditor(event);
      if (inlineEditor) {
        // Very short delay to let the character appear in DOM
        setTimeout(() => {
          this._handleInput(inlineEditor, false);
        }, 1);
        
        // Also try immediate trigger without waiting for DOM update
        this._handleInput(inlineEditor, false);
        return;
      }
    }

    const inlineEditor = this._getInlineEditor(event);
    if (!inlineEditor) return;

    this._handleInput(inlineEditor, false);
  };

  override connectedCallback() {
    super.connectedCallback();

    // Add beforeInput for Android compatibility  
    this.handleEvent('beforeInput', this._onBeforeInput);
    this.handleEvent('keyDown', this._onKeyDown);
    this.handleEvent('compositionEnd', this._onCompositionEnd);
    
    // Android-specific fallback
    if (IS_ANDROID) {
      this._setupAndroidFallback();
    }
  }
  
  private _setupAndroidFallback() {
    let lastInputTime = 0;
    
    // More aggressive detection for Android - check multiple ways
    const checkForSlash = () => {
      const textSelection = this.host.selection.find(TextSelection);
      if (!textSelection) return;

      const block = this.host.view.getBlock(textSelection.blockId);
      if (!block) return;
      
      const model = block.model;
      const inlineEditor = getInlineEditorByModel(this.std, model);
      if (!inlineEditor) return;

      const inlineRange = inlineEditor.getInlineRange();
      if (!inlineRange) return;

      const textPoint = inlineEditor.getTextPoint(inlineRange.index);
      if (!textPoint) return;

      const [leafStart, offsetStart] = textPoint;
      const text = leafStart.textContent
        ? leafStart.textContent.slice(0, offsetStart)
        : '';

      // Check if we just added a single slash (not double slash)
      if (text.endsWith(AFFINE_SLASH_MENU_TRIGGER_KEY) && !text.endsWith('//')) {
        // Check cooldown to prevent flickering
        if (Date.now() - SlashMenu._lastDismissTime < 300) return;
        
        // Prevent triggering multiple times quickly
        const now = Date.now();
        if (now - lastInputTime < 200) return;
        lastInputTime = now;
        
        closeSlashMenu();
        showSlashMenu({
          context: { model, std: this.std },
          config: this.config,
          configItemTransform: this.configItemTransform,
        });
      }
    };

    // Multiple event listeners for Android
    const immediateCheck = () => checkForSlash();
    const delayedCheck = () => setTimeout(checkForSlash, 10);
    
    // Listen to multiple input-related events
    document.addEventListener('input', immediateCheck, { passive: true });
    document.addEventListener('textInput', immediateCheck, { passive: true });
    document.addEventListener('compositionupdate', delayedCheck, { passive: true });
    
    // Also use MutationObserver for text changes
    const observer = new MutationObserver(() => {
      setTimeout(checkForSlash, 5);
    });
    
    // Observe text changes in the editor
    const editorElement = this.host.closest('[contenteditable]') || document.body;
    observer.observe(editorElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    
    // Cleanup
    this.disposables.add(() => {
      document.removeEventListener('input', immediateCheck);
      document.removeEventListener('textInput', immediateCheck);
      document.removeEventListener('compositionupdate', delayedCheck);
      observer.disconnect();
    });
  }
}
