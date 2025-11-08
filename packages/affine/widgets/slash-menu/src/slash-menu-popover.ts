import { createLitPortal } from '@blocksuite/affine-components/portal';
import {
  cleanSpecifiedTail,
  getInlineEditorByModel,
  getTextContentFromInlineRange,
} from '@blocksuite/affine-rich-text';
import {
  DocModeProvider,
  TelemetryProvider,
} from '@blocksuite/affine-shared/services';
import type { AffineInlineEditor } from '@blocksuite/affine-shared/types';
import {
  createKeydownObserver,
  getCurrentNativeRange,
  getPopperPosition,
  isControlledKeyboardEvent,
  isFuzzyMatch,
  substringMatchScore,
} from '@blocksuite/affine-shared/utils';
import { IS_ANDROID, IS_MOBILE } from '@blocksuite/global/env';
import { WithDisposable } from '@blocksuite/global/lit';
import { ArrowDownSmallIcon } from '@blocksuite/icons/lit';
import { autoPlacement, offset } from '@floating-ui/dom';
import { html, LitElement, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { styleMap } from 'lit/directives/style-map.js';
import { when } from 'lit/directives/when.js';
import groupBy from 'lodash-es/groupBy';
import throttle from 'lodash-es/throttle';

import {
  AFFINE_SLASH_MENU_MAX_HEIGHT,
  AFFINE_SLASH_MENU_TOOLTIP_TIMEOUT,
  AFFINE_SLASH_MENU_TRIGGER_KEY,
} from './consts.js';
import { slashItemToolTipStyle, styles } from './styles.js';
import type {
  SlashMenuActionItem,
  SlashMenuContext,
  SlashMenuItem,
  SlashMenuSubMenu,
} from './types.js';
import {
  isActionItem,
  isSubMenuItem,
  parseGroup,
  slashItemClassName,
} from './utils.js';
type InnerSlashMenuContext = SlashMenuContext & {
  onClickItem: (item: SlashMenuActionItem) => void;
  searching: boolean;
};

export class SlashMenu extends WithDisposable(LitElement) {
  static override styles = styles;

  private get _telemetry() {
    return this.context.std.getOptional(TelemetryProvider);
  }

  private get _editorMode() {
    return this.context.std.get(DocModeProvider).getEditorMode();
  }

  private readonly _handleClickItem = (item: SlashMenuActionItem) => {
    // Need to remove the search string
    // We must to do clean the slash string before we do the action
    // Otherwise, the action may change the model and cause the slash string to be changed
    cleanSpecifiedTail(
      this.context.std,
      this.context.model,
      AFFINE_SLASH_MENU_TRIGGER_KEY + (this._query || '')
    );
    this.inlineEditor
      .waitForUpdate()
      .then(() => {
        item.action(this.context);
        this._telemetry?.track('SelectSlashMenuItem', {
          page: this._editorMode ?? undefined,
          segment:
            this.context.model.flavour === 'affine:edgeless-text'
              ? 'edgeless-text'
              : 'doc',
          module: 'slash menu',
          control: item.name,
        });
        this.abortController.abort();
      })
      .catch(console.error);
  };

  private readonly _handleOverlayClick = () => {
    this.abortController.abort();
  };

  // Overlay touch tracking (separate from menu item touch tracking)
  private _overlayTouchStartPos: { x: number; y: number } | null = null;
  private _overlayHasMoved = false;

  private readonly _handleOverlayTouch = (event: TouchEvent) => {
    const eventType = event.type;
    
    if (eventType === 'touchstart') {
      const touch = event.touches[0];
      if (touch) {
        this._overlayTouchStartPos = { x: touch.clientX, y: touch.clientY };
        this._overlayHasMoved = false;
        
        // Check if touch started within menu bounds
        const innerMenu = this.querySelector('inner-slash-menu');
        const menuElement = innerMenu?.shadowRoot?.querySelector('.slash-menu') as HTMLElement;
        
        if (menuElement) {
          const rect = menuElement.getBoundingClientRect();
          const isWithinMenuBounds = touch.clientX >= rect.left && touch.clientX <= rect.right && 
                                    touch.clientY >= rect.top && touch.clientY <= rect.bottom;
          
          if (IS_MOBILE) {
            console.log('[SlashMenu] Overlay touch start:', {
              withinBounds: isWithinMenuBounds,
              pos: { x: touch.clientX, y: touch.clientY },
              menuBounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
            });
          }
          
          // If touch starts within menu, we'll ignore the dismissal
          if (isWithinMenuBounds) {
            this._overlayHasMoved = true; // Mark as "moved" to prevent dismissal
          }
        }
      }
    } else if (eventType === 'touchmove') {
      if (this._overlayTouchStartPos && event.touches[0]) {
        const touch = event.touches[0];
        const deltaX = Math.abs(touch.clientX - this._overlayTouchStartPos.x);
        const deltaY = Math.abs(touch.clientY - this._overlayTouchStartPos.y);
        
        // Same threshold as menu items - 5px
        if (deltaX > 5 || deltaY > 5) {
          this._overlayHasMoved = true;
          
          if (IS_MOBILE) {
            console.log('[SlashMenu] Overlay movement detected - scroll gesture', { deltaX, deltaY });
          }
        }
      }
    } else if (eventType === 'touchend') {
      // Only dismiss if it was a clean tap outside the menu (no movement)
      if (!this._overlayHasMoved && this._overlayTouchStartPos) {
        if (IS_MOBILE) {
          console.log('[SlashMenu] Overlay touch end - dismissing (tap detected outside menu)');
        }
        this.abortController.abort();
      } else {
        if (IS_MOBILE) {
          console.log('[SlashMenu] Overlay touch end - ignoring (movement or within menu detected)');
        }
      }
      
      // Reset tracking
      this._overlayTouchStartPos = null;
      this._overlayHasMoved = false;
    }
  };

  private readonly _initItemPathMap = () => {
    const traverse = (item: SlashMenuItem, path: number[]) => {
      this._itemPathMap.set(item, [...path]);
      if (isSubMenuItem(item)) {
        item.subMenu.forEach((subItem, index) =>
          traverse(subItem, [...path, index])
        );
      }
    };

    this.items.forEach((item, index) => traverse(item, [index]));
  };

  private _innerSlashMenuContext!: InnerSlashMenuContext;

  private readonly _itemPathMap = new Map<SlashMenuItem, number[]>();

  private _queryState: 'off' | 'on' | 'no_result' = 'off';

  private readonly _startRange = (() => {
    const range = this.inlineEditor.getInlineRange();
    if (IS_MOBILE) {
      console.log('[SlashMenu] _startRange initialized:', range);
    }
    return range;
  })();

  private readonly _updateFilteredItems = () => {
    const query = this._query;
    if (query === null) {
      this.abortController.abort();
      return;
    }
    this._filteredItems = [];
    const searchStr = query.toLowerCase();
    
    // Debug logging for mobile devices
    if (IS_MOBILE) {
      console.log('[SlashMenu] _updateFilteredItems called:', {
        query,
        searchStr,
        queryLength: searchStr.length,
        items: this.items.map(item => item.name)
      });
    }
    
    if (searchStr === '' || searchStr.endsWith(' ')) {
      this._queryState = searchStr === '' ? 'off' : 'no_result';
      this._innerSlashMenuContext.searching = false;
      return;
    }

    // Layer order traversal
    let depth = 0;
    let queue = this.items;
    while (queue.length !== 0) {
      // remove the sub menu item from the previous layer result
      this._filteredItems = this._filteredItems.filter(
        item => !isSubMenuItem(item)
      );

      this._filteredItems = this._filteredItems.concat(
        queue.filter(({ name, searchAlias = [] }) =>
          [name, ...searchAlias].some(str => isFuzzyMatch(str, searchStr))
        )
      );

      // We search first and second layer
      if (this._filteredItems.length !== 0 && depth >= 1) break;

      queue = queue
        .map<typeof queue>(item => {
          if (isSubMenuItem(item)) {
            return item.subMenu;
          } else {
            return [];
          }
        })
        .flat();

      depth++;
    }

    this._filteredItems.sort((a, b) => {
      return -(
        substringMatchScore(a.name, searchStr) -
        substringMatchScore(b.name, searchStr)
      );
    });

    this._queryState = this._filteredItems.length === 0 ? 'no_result' : 'on';
    this._innerSlashMenuContext.searching = true;
  };

  private get _query() {
    const query = getTextContentFromInlineRange(this.inlineEditor, this._startRange);
    
    // Debug logging for mobile devices
    if (IS_MOBILE) {
      console.log('[SlashMenu] _query calculated:', {
        query,
        startRange: this._startRange,
        currentRange: this.inlineEditor.getInlineRange(),
        inlineEditor: !!this.inlineEditor
      });
    }
    
    return query;
  }

  get host() {
    return this.context.std.host;
  }

  constructor(
    private readonly inlineEditor: AffineInlineEditor,
    private readonly abortController = new AbortController()
  ) {
    super();
  }

  override connectedCallback() {
    super.connectedCallback();

    this._innerSlashMenuContext = {
      ...this.context,
      onClickItem: this._handleClickItem,
      searching: false,
    };

    this._initItemPathMap();

    this._disposables.addFromEvent(this, 'mousedown', e => {
      // Prevent input from losing focus
      e.preventDefault();
    });

    const inlineEditor = this.inlineEditor;
    if (!inlineEditor || !inlineEditor.eventSource) {
      console.error('inlineEditor or eventSource is not found');
      return;
    }

    /**
     * Handle arrow key
     *
     * The slash menu will be closed in the following keyboard cases:
     * - Press the space key
     * - Press the backspace key and the search string is empty
     * - Press the escape key
     * - When the search item is empty, the slash menu will be hidden temporarily,
     *   and if the following key is not the backspace key, the slash menu will be closed
     */
    createKeydownObserver({
      target: inlineEditor.eventSource,
      signal: this.abortController.signal,
      interceptor: (event, next) => {
        const { key, isComposing, code } = event;
        if (key === AFFINE_SLASH_MENU_TRIGGER_KEY) {
          // Can not stopPropagation here,
          // otherwise the rich text will not be able to trigger a new the slash menu
          return;
        }

        if (key === 'Process' && !isComposing && code === 'Slash') {
          // The IME case of above
          return;
        }

        if (key !== 'Backspace' && this._queryState === 'no_result') {
          // if the following key is not the backspace key,
          // the slash menu will be closed
          this.abortController.abort();
          return;
        }

        if (key === 'Escape') {
          this.abortController.abort();
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        // On mobile, also close with backspace when query is empty
        if (IS_MOBILE && key === 'Backspace' && !this._query) {
          this.abortController.abort();
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (key === 'ArrowRight' || key === 'ArrowLeft') {
          return;
        }

        next();
      },
      onInput: isComposition => {
        if (IS_MOBILE) {
          console.log('[SlashMenu] createKeydownObserver onInput triggered:', { isComposition });
        }
        
        if (isComposition) {
          this._updateFilteredItems();
        } else {
          const subscription = this.inlineEditor.slots.renderComplete.subscribe(
            () => {
              subscription.unsubscribe();
              this._updateFilteredItems();
            }
          );
        }
      },
      onPaste: () => {
        setTimeout(() => {
          this._updateFilteredItems();
        }, 50);
      },
      onDelete: () => {
        const curRange = this.inlineEditor.getInlineRange();
        if (!this._startRange || !curRange) {
          return;
        }
        if (curRange.index < this._startRange.index) {
          this.abortController.abort();
        }
        const subscription = this.inlineEditor.slots.renderComplete.subscribe(
          () => {
            subscription.unsubscribe();
            this._updateFilteredItems();
          }
        );
      },
      onAbort: () => this.abortController.abort(),
    });

    this._telemetry?.track('OpenSlashMenu', {
      page: this._editorMode ?? undefined,
      type: this.context.model.flavour.split(':').pop(),
      module: 'slash menu',
    });

    // Add Android-specific input monitoring for filtering
    this._setupMobileInputMonitoring();
  }

  protected override willUpdate() {
    if (!this.hasUpdated) {
      const currRage = getCurrentNativeRange();
      if (!currRage) {
        this.abortController.abort();
        return;
      }

      // Handle position
      const updatePosition = throttle(() => {
        this._position = getPopperPosition(this, currRage);
      }, 10);

      this.disposables.addFromEvent(window, 'resize', updatePosition);
      updatePosition();
    }
  }

  private _setupMobileInputMonitoring() {
    // Add additional input monitoring for mobile devices where isComposing blocks normal input detection
    if (!IS_MOBILE) return;

    const inlineEditor = this.inlineEditor;
    if (!inlineEditor || !inlineEditor.eventSource) return;

    // Listen for input events that bypass the composition blocking
    const handleInput = (event: Event) => {
      console.log('[SlashMenu] Mobile input detected:', {
        type: event.type,
        target: event.target,
        query: this._query,
        startRange: this._startRange,
        currentRange: inlineEditor.getInlineRange()
      });
      
      // Update filtered items when input changes
      this._updateFilteredItems();
    };

    // Add multiple input event listeners for mobile devices
    inlineEditor.eventSource.addEventListener('input', handleInput, { passive: true });
    inlineEditor.eventSource.addEventListener('compositionupdate', handleInput, { passive: true });
    inlineEditor.eventSource.addEventListener('textInput', handleInput, { passive: true });
    
    // Android-specific: Add more aggressive event listeners
    if (IS_ANDROID) {
      console.log('[SlashMenu] Setting up Android-specific monitoring');
      
      // Listen for ANY change in the editor content
      const androidFallback = () => {
        console.log('[SlashMenu] Android fallback triggered');
        this._updateFilteredItems();
      };
      
      // More Android-specific events
      inlineEditor.eventSource.addEventListener('beforeinput', androidFallback, { passive: true });
      inlineEditor.eventSource.addEventListener('compositionstart', androidFallback, { passive: true });
      inlineEditor.eventSource.addEventListener('compositionend', androidFallback, { passive: true });
      inlineEditor.eventSource.addEventListener('keyup', androidFallback, { passive: true });
      
      // Use MutationObserver for Android as last resort
      const observer = new MutationObserver(() => {
        console.log('[SlashMenu] Android MutationObserver triggered');
        setTimeout(() => this._updateFilteredItems(), 50);
      });
      
      observer.observe(inlineEditor.eventSource, {
        childList: true,
        subtree: true,
        characterData: true
      });
      
      // Also poll periodically on Android
      const pollInterval = setInterval(() => {
        this._updateFilteredItems();
      }, 300);
      
      // Clean up Android-specific listeners
      this.abortController.signal.addEventListener('abort', () => {
        inlineEditor.eventSource?.removeEventListener('beforeinput', androidFallback);
        inlineEditor.eventSource?.removeEventListener('compositionstart', androidFallback);
        inlineEditor.eventSource?.removeEventListener('compositionend', androidFallback);
        inlineEditor.eventSource?.removeEventListener('keyup', androidFallback);
        observer.disconnect();
        clearInterval(pollInterval);
      });
    }
    
    // Also try listening on the document level as fallback
    const documentInputHandler = (event: Event) => {
      // Only handle if the target is within our editor
      if (event.target && inlineEditor.eventSource?.contains(event.target as Node)) {
        console.log('[SlashMenu] Document level input:', event.type);
        setTimeout(() => this._updateFilteredItems(), 10);
      }
    };
    
    document.addEventListener('input', documentInputHandler, { passive: true });
    document.addEventListener('compositionupdate', documentInputHandler, { passive: true });
    
    // Clean up when aborted
    this.abortController.signal.addEventListener('abort', () => {
      inlineEditor.eventSource?.removeEventListener('input', handleInput);
      inlineEditor.eventSource?.removeEventListener('compositionupdate', handleInput);
      inlineEditor.eventSource?.removeEventListener('textInput', handleInput);
      document.removeEventListener('input', documentInputHandler);
      document.removeEventListener('compositionupdate', documentInputHandler);
    });
  }

  override render() {
    const slashMenuStyles = this._position
      ? {
          transform: `translate(${this._position.x}, ${this._position.y})`,
          maxHeight: `${Math.min(this._position.height, AFFINE_SLASH_MENU_MAX_HEIGHT)}px`,
        }
      : {
          visibility: 'hidden',
        };

    return html`${this._queryState !== 'no_result'
        ? html` <div
            class="overlay-mask"
            @click="${this._handleOverlayClick}"
            @touchstart="${IS_MOBILE ? this._handleOverlayTouch : undefined}"
            @touchmove="${IS_MOBILE ? this._handleOverlayTouch : undefined}"
            @touchend="${IS_MOBILE ? this._handleOverlayTouch : undefined}"
          ></div>`
        : nothing}
      <inner-slash-menu
        .context=${this._innerSlashMenuContext}
        .menu=${this._queryState === 'off' ? this.items : this._filteredItems}
        .mainMenuStyle=${slashMenuStyles}
        .abortController=${this.abortController}
      >
      </inner-slash-menu>`;
  }

  @state()
  private accessor _filteredItems: (SlashMenuActionItem | SlashMenuSubMenu)[] =
    [];

  @state()
  private accessor _position: {
    x: string;
    y: string;
    height: number;
  } | null = null;

  @property({ attribute: false })
  accessor items!: SlashMenuItem[];

  @property({ attribute: false })
  accessor context!: SlashMenuContext;
}

export class InnerSlashMenu extends WithDisposable(LitElement) {
  static override styles = styles;

  private readonly _closeSubMenu = () => {
    this._subMenuAbortController?.abort();
    this._subMenuAbortController = null;
    this._currentSubMenu = null;
  };

  private _currentSubMenu: SlashMenuSubMenu | null = null;

  // Track touch for scroll vs tap detection
  private _touchStartPos: { x: number; y: number } | null = null;
  private _hasMoved = false;

  private readonly _handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch) {
      this._touchStartPos = { x: touch.clientX, y: touch.clientY };
      this._hasMoved = false;
    }
  };

  private readonly _handleTouchMove = (event: TouchEvent) => {
    if (this._touchStartPos && event.touches[0]) {
      const touch = event.touches[0];
      const deltaX = Math.abs(touch.clientX - this._touchStartPos.x);
      const deltaY = Math.abs(touch.clientY - this._touchStartPos.y);
      
      // Use smaller threshold for more sensitive detection
      // 5px threshold catches even small scroll gestures
      const threshold = 5;
      
      if (deltaX > threshold || deltaY > threshold) {
        this._hasMoved = true;
        
        if (IS_MOBILE) {
          console.log('[InnerSlashMenu] Touch movement detected - scroll gesture', { deltaX, deltaY });
        }
      }
    }
  };

  private readonly _handleTouchEnd = (callback: () => void) => {
    return (event: TouchEvent) => {
      event.preventDefault();
      
      // Only execute callback if it was a tap (no significant movement)
      if (!this._hasMoved) {
        if (IS_MOBILE) {
          console.log('[InnerSlashMenu] Touch end - executing action (tap detected)');
        }
        callback();
      } else {
        if (IS_MOBILE) {
          console.log('[InnerSlashMenu] Touch end - ignoring action (scroll detected)');
        }
      }
      
      // Reset tracking
      this._touchStartPos = null;
      this._hasMoved = false;
    };
  };

  private readonly _openSubMenu = (item: SlashMenuSubMenu) => {
    if (item === this._currentSubMenu) return;

    const itemElement = this.shadowRoot?.querySelector(
      `.${slashItemClassName(item)}`
    );
    if (!itemElement) return;

    this._closeSubMenu();
    this._currentSubMenu = item;
    this._subMenuAbortController = new AbortController();
    this._subMenuAbortController.signal.addEventListener('abort', () => {
      this._closeSubMenu();
    });

    const subMenuElement = createLitPortal({
      shadowDom: false,
      template: html`<inner-slash-menu
        .context=${this.context}
        .menu=${item.subMenu}
        .depth=${this.depth + 1}
        .abortController=${this._subMenuAbortController}
      >
        ${item.subMenu.map(this._renderItem)}
      </inner-slash-menu>`,
      computePosition: {
        referenceElement: itemElement,
        autoUpdate: true,
        middleware: [
          offset(12),
          autoPlacement({
            allowedPlacements: ['right-start', 'right-end'],
          }),
        ],
      },
      abortController: this._subMenuAbortController,
    });

    subMenuElement.style.zIndex = `calc(var(--affine-z-index-popover) + ${this.depth})`;
    subMenuElement.focus();
  };

  private readonly _renderActionItem = (item: SlashMenuActionItem) => {
    const { name, icon, description, tooltip } = item;

    const hover = item === this._activeItem;

    return html`<icon-button
      class="slash-menu-item ${slashItemClassName(item)}"
      width="100%"
      height="44px"
      text=${name}
      subText=${ifDefined(description)}
      data-testid="${name}"
      hover=${hover}
      @mousemove=${() => {
        this._activeItem = item;
        this._closeSubMenu();
      }}
      @click=${() => this.context.onClickItem(item)}
      @touchstart=${(e: TouchEvent) => {
        this._activeItem = item;
        this._closeSubMenu();
        this._handleTouchStart(e);
      }}
      @touchmove=${this._handleTouchMove}
      @touchend=${this._handleTouchEnd(() => this.context.onClickItem(item))}
    >
      ${icon && html`<div class="slash-menu-item-icon">${icon}</div>`}
      ${tooltip &&
      html`<affine-tooltip
        tip-position="right"
        .offset=${22}
        .tooltipStyle=${slashItemToolTipStyle}
        .hoverOptions=${{
          enterDelay: AFFINE_SLASH_MENU_TOOLTIP_TIMEOUT,
          allowMultiple: false,
        }}
      >
        <div class="tooltip-figure">${tooltip.figure}</div>
        <div class="tooltip-caption">${tooltip.caption}</div>
      </affine-tooltip>`}
    </icon-button>`;
  };

  private readonly _renderGroup = (
    groupName: string,
    items: SlashMenuItem[]
  ) => {
    return html`<div class="slash-menu-group">
      ${when(
        !this.context.searching,
        () => html`<div class="slash-menu-group-name">${groupName}</div>`
      )}
      ${items.map(this._renderItem)}
    </div>`;
  };

  private readonly _renderItem = (item: SlashMenuItem) => {
    if (isActionItem(item)) return this._renderActionItem(item);
    if (isSubMenuItem(item)) return this._renderSubMenuItem(item);
    return nothing;
  };

  private readonly _renderSubMenuItem = (item: SlashMenuSubMenu) => {
    const { name, icon, description } = item;

    const hover = item === this._activeItem;

    return html`<icon-button
      class="slash-menu-item ${slashItemClassName(item)}"
      width="100%"
      height="44px"
      text=${name}
      subText=${ifDefined(description)}
      data-testid="${name}"
      hover=${hover}
      @mousemove=${() => {
        this._activeItem = item;
        this._openSubMenu(item);
      }}
      @touchstart=${(e: TouchEvent) => {
        this._activeItem = item;
        if (this._currentSubMenu === item) {
          this._closeSubMenu();
        } else {
          this._openSubMenu(item);
        }
        this._handleTouchStart(e);
      }}
      @touchmove=${this._handleTouchMove}
      @touchend=${this._handleTouchEnd(() => {
        if (!this._currentSubMenu) {
          this._openSubMenu(item);
        }
      })}
    >
      ${icon && html`<div class="slash-menu-item-icon">${icon}</div>`}
      <div slot="suffix" style="transform: rotate(-90deg);">
        ${ArrowDownSmallIcon()}
      </div>
    </icon-button>`;
  };

  private _subMenuAbortController: AbortController | null = null;

  private _scrollToItem(item: SlashMenuItem) {
    const shadowRoot = this.shadowRoot;
    if (!shadowRoot) {
      return;
    }

    const ele = shadowRoot.querySelector(`icon-button[text="${item.name}"]`);
    if (!ele) {
      return;
    }
    ele.scrollIntoView({
      block: 'nearest',
    });
  }

  override connectedCallback() {
    super.connectedCallback();

    // close all sub menus
    this.abortController?.signal?.addEventListener('abort', () => {
      this._subMenuAbortController?.abort();
    });
    this.addEventListener('wheel', event => {
      if (this._currentSubMenu) {
        event.preventDefault();
      }
    });

    const inlineEditor = getInlineEditorByModel(
      this.context.std,
      this.context.model
    );

    if (!inlineEditor || !inlineEditor.eventSource) {
      console.error('inlineEditor or eventSource is not found');
      return;
    }

    inlineEditor.eventSource.addEventListener(
      'keydown',
      event => {
        if (this._currentSubMenu) return;
        if (event.isComposing) return;

        const { key, ctrlKey, metaKey, altKey, shiftKey } = event;

        const onlyCmd = (ctrlKey || metaKey) && !altKey && !shiftKey;
        const onlyShift = shiftKey && !isControlledKeyboardEvent(event);
        const notControlShift = !(ctrlKey || metaKey || altKey || shiftKey);

        let moveStep = 0;
        if (
          (key === 'ArrowUp' && notControlShift) ||
          (key === 'Tab' && onlyShift) ||
          (key === 'P' && onlyCmd) ||
          (key === 'p' && onlyCmd)
        ) {
          moveStep = -1;
        }

        if (
          (key === 'ArrowDown' && notControlShift) ||
          (key === 'Tab' && notControlShift) ||
          (key === 'n' && onlyCmd) ||
          (key === 'N' && onlyCmd)
        ) {
          moveStep = 1;
        }

        if (moveStep !== 0) {
          const activeItemIndex = this.menu.indexOf(this._activeItem);
          const itemIndex =
            (activeItemIndex + moveStep + this.menu.length) % this.menu.length;

          this._activeItem = this.menu[itemIndex] as typeof this._activeItem;
          this._scrollToItem(this._activeItem);

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'ArrowRight' && notControlShift) {
          if (isSubMenuItem(this._activeItem)) {
            this._openSubMenu(this._activeItem);
          }

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'ArrowLeft' && notControlShift) {
          if (this.depth != 0) this.abortController.abort();

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'Escape' && notControlShift) {
          this.abortController.abort();

          event.preventDefault();
          event.stopPropagation();
        }

        if (key === 'Enter' && notControlShift) {
          if (isSubMenuItem(this._activeItem)) {
            this._openSubMenu(this._activeItem);
          } else if (isActionItem(this._activeItem)) {
            this.context.onClickItem(this._activeItem);
          }

          event.preventDefault();
          event.stopPropagation();
        }
      },
      {
        capture: true,
        signal: this.abortController.signal,
      }
    );
  }

  override disconnectedCallback() {
    this.abortController.abort();
  }

  override render() {
    if (this.menu.length === 0) return nothing;

    const style = styleMap(this.mainMenuStyle ?? { position: 'relative' });

    const groups = groupBy(this.menu, ({ group }) =>
      group && !this.context.searching ? parseGroup(group)[1] : ''
    );

    return html`<div
      class="slash-menu"
      style=${style}
      data-testid=${`sub-menu-${this.depth}`}
      @touchmove=${this._handleTouchMove}
    >
      ${Object.entries(groups).map(([groupName, items]) =>
        this._renderGroup(groupName, items)
      )}
    </div>`;
  }

  override willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('menu') && this.menu.length !== 0) {
      this._activeItem = this.menu[0];

      // this case happen on query updated
      this._subMenuAbortController?.abort();
    }
  }

  @state()
  private accessor _activeItem!: SlashMenuActionItem | SlashMenuSubMenu;

  @property({ attribute: false })
  accessor abortController!: AbortController;

  @property({ attribute: false })
  accessor context!: InnerSlashMenuContext;

  @property({ attribute: false })
  accessor depth: number = 0;

  @property({ attribute: false })
  accessor mainMenuStyle: Parameters<typeof styleMap>[0] | null = null;

  @property({ attribute: false })
  accessor menu!: SlashMenuItem[];
}
