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

      // Debug logging specifically for Android devices  
      if (IS_ANDROID) {
        console.log('[SlashMenu] Successfully triggered on Android:', {
          text,
          device: navigator.userAgent,
          trigger: AFFINE_SLASH_MENU_TRIGGER_KEY,
          textLength: text.length
        });
      }

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

    // Debug logging specifically for Android composition events
    if (IS_ANDROID) {
      console.log('[SlashMenu] CompositionEnd triggered on Android:', {
        data: event.data,
        device: navigator.userAgent
      });
    }

    const inlineEditor = this._getInlineEditor(event);
    if (!inlineEditor) return;

    this._handleInput(inlineEditor, true);
  };

  private readonly _onKeyDown = (ctx: UIEventStateContext) => {
    const eventState = ctx.get('keyboardState');
    const event = eventState.raw;

    const key = event.key;

    // Android keyboards often set isComposing=true even for simple characters like '/'
    // iPhone works correctly, so we specifically handle Android differently
    const shouldSkipComposing = IS_ANDROID ? false : event.isComposing;
    
    if (shouldSkipComposing || key !== AFFINE_SLASH_MENU_TRIGGER_KEY) return;

    // Debug logging specifically for Android devices
    if (IS_ANDROID) {
      console.log('[SlashMenu] KeyDown triggered on Android:', {
        key,
        isComposing: event.isComposing,
        code: event.code,
        device: navigator.userAgent
      });
    }

    const inlineEditor = this._getInlineEditor(event);
    if (!inlineEditor) return;

    this._handleInput(inlineEditor, false);
  };

  private readonly _onBeforeInput = (ctx: UIEventStateContext) => {
    const event = ctx.get('defaultState').event as InputEvent;

    // Handle Android keyboards that might not trigger keydown events properly
    if (event.data !== AFFINE_SLASH_MENU_TRIGGER_KEY) return;

    // Debug logging specifically for Android beforeInput
    if (IS_ANDROID) {
      console.log('[SlashMenu] BeforeInput triggered on Android:', {
        data: event.data,
        inputType: event.inputType,
        isComposing: (event as any).isComposing,
        device: navigator.userAgent
      });
      
      // For Android, trigger immediately without waiting for text processing
      const inlineEditor = this._getInlineEditor(event);
      if (inlineEditor) {
        console.log('[SlashMenu] Android: Immediate trigger from beforeInput');
        
        // Prevent the default behavior to avoid double processing
        event.preventDefault?.();
        
        // Trigger the slash menu immediately
        setTimeout(() => {
          this._handleInput(inlineEditor, false);
        }, 10);
        return;
      }
    }

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

  override connectedCallback() {
    super.connectedCallback();

    // Enable beforeInput for better mobile keyboard support
    this.handleEvent('beforeInput', this._onBeforeInput);
    this.handleEvent('keyDown', this._onKeyDown);
    this.handleEvent('compositionEnd', this._onCompositionEnd);
    
    // For Android devices, add a fallback mechanism to detect slash input
    // by monitoring text changes directly, as Android keyboards sometimes
    // don't trigger the expected events
    if (IS_ANDROID) {
      this._setupAndroidFallback();
    }
  }
  
  private _setupAndroidFallback() {
    let lastTextContent = '';
    
    // More aggressive checking for Android - since double slash works,
    // we know the text detection works, we just need to catch it earlier
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
      const currentText = leafStart.textContent
        ? leafStart.textContent.slice(0, offsetStart)
        : '';

      // Only proceed if text actually changed
      if (currentText === lastTextContent) return;
      
      console.log('[SlashMenu] Android text changed from', lastTextContent, 'to', currentText);
      
      // Check if we just added a slash character
      const textDiff = currentText.length - lastTextContent.length;
      if (textDiff === 1 && currentText.endsWith(AFFINE_SLASH_MENU_TRIGGER_KEY)) {
        console.log('[SlashMenu] Android detected new slash character');
        
        lastTextContent = currentText;
        
        // Immediate trigger - no delay since Android seems to need this
        closeSlashMenu();
        showSlashMenu({
          context: { model, std: this.std },
          config: this.config,
          configItemTransform: this.configItemTransform,
        });
        return;
      }
      
      lastTextContent = currentText;
    };

    // Multiple detection methods for Android
    const immediateCheck = () => checkForSlash();
    
    // Check on multiple event types that Android might use
    document.addEventListener('input', immediateCheck, { passive: true });
    document.addEventListener('textInput', immediateCheck, { passive: true });
    
    // Also use a fast polling mechanism as a last resort
    const pollingInterval = setInterval(() => {
      checkForSlash();
    }, 200);
    
    // Cleanup when component is disconnected
    this.disposables.add(() => {
      document.removeEventListener('input', immediateCheck);
      document.removeEventListener('textInput', immediateCheck);
      clearInterval(pollingInterval);
    });
  }
}
