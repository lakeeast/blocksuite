import {
  convertToDatabase,
  DATABASE_CONVERT_WHITE_LIST,
} from '@blocksuite/affine-block-database';
// import {
//   convertSelectedBlocksToLinkedDoc,
//   getTitleFromSelectedModels,
//   notifyDocCreated,
//   promptDocTitle,
// } from '@blocksuite/affine-block-embed';
import {
  updateBlockAlign,
  updateBlockType,
} from '@blocksuite/affine-block-note';
import type { HighlightType } from '@blocksuite/affine-components/highlight-dropdown-menu';
import { toast } from '@blocksuite/affine-components/toast';
import { EditorChevronDown } from '@blocksuite/affine-components/toolbar';
import {
  deleteTextCommand,
  formatBlockCommand,
  formatNativeCommand,
  formatTextCommand,
  isFormatSupported,
  textFormatConfigs,
} from '@blocksuite/affine-inline-preset';
import {
  type TextAlign,
} from '@blocksuite/affine-model';
import {
  textAlignConfigs,
  textConversionConfigs,
} from '@blocksuite/affine-rich-text';
import {
  copySelectedModelsCommand,
  deleteSelectedModelsCommand,
  draftSelectedModelsCommand,
  duplicateSelectedModelsCommand,
  getBlockSelectionsCommand,
  getImageSelectionsCommand,
  getSelectedBlocksCommand,
  getSelectedModelsCommand,
  getTextSelectionCommand,
} from '@blocksuite/affine-shared/commands';
import type {
  ToolbarAction,
  ToolbarActionGenerator,
  ToolbarActionGroup,
  ToolbarModuleConfig,
} from '@blocksuite/affine-shared/services';
import {
  ActionPlacement,
  blockCommentToolbarButton,
} from '@blocksuite/affine-shared/services';
import { getMostCommonValue } from '@blocksuite/affine-shared/utils';
import { tableViewMeta } from '@blocksuite/data-view/view-presets';
import {
  CopyIcon,
  DatabaseTableViewIcon,
  DeleteIcon,
  DuplicateIcon,
} from '@blocksuite/icons/lit';
import {
  type BlockComponent,
  BlockSelection,
} from '@blocksuite/std';
// import { toDraftModel } from '@blocksuite/store';
import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

const conversionsActionGroup = {
  id: 'a.conversions',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  generate({ chain }) {
    const [ok, { selectedModels = [] }] = chain
      .tryAll(chain => [
        chain.pipe(getTextSelectionCommand),
        chain.pipe(getBlockSelectionsCommand),
      ])
      .pipe(getSelectedModelsCommand, { types: ['text', 'block'] })
      .run();

    // only support model with text
    // TODO(@fundon): displays only in a single paragraph, `length === 1`.
    const allowed = ok && selectedModels.filter(model => model.text).length > 0;
    if (!allowed) return null;

    const model = selectedModels[0];
    const conversion =
      textConversionConfigs.find(
        ({ flavour, type }) =>
          flavour === model.flavour &&
          (type ? 'type' in model.props && type === model.props.type : true)
      ) ?? textConversionConfigs[0];
    const update = (flavour: string, type?: string) => {
      chain
        .pipe(updateBlockType, {
          flavour,
          ...(type && { props: { type } }),
        })
        .run();
    };

    return {
      content: html`
        <editor-menu-button
          .contentPadding="${'8px'}"
          .button=${html`
            <editor-icon-button
              aria-label="Conversions"
              .tooltip="${'改变字体'}"
            >
              ${conversion.icon} ${EditorChevronDown}
            </editor-icon-button>
          `}
        >
          <div data-size="large" data-orientation="vertical">
            ${repeat(
              textConversionConfigs.filter(c => c.flavour !== 'affine:divider'),
              item => item.name,
              ({ flavour, type, name, icon }) => html`
                <editor-menu-action
                  aria-label=${name}
                  ?data-selected=${conversion.name === name}
                  @click=${() => update(flavour, type)}
                >
                  ${icon}<span class="label">${name}</span>
                </editor-menu-action>
              `
            )}
          </div>
        </editor-menu-button>
      `,
    };
  },
} as const satisfies ToolbarActionGenerator;

const alignActionGroup = {
  id: 'b.align',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  generate({ chain }) {
    const [ok, { selectedModels = [] }] = chain
      .tryAll(chain => [
        chain.pipe(getTextSelectionCommand),
        chain.pipe(getBlockSelectionsCommand),
      ])
      .pipe(getSelectedModelsCommand, { types: ['text', 'block'] })
      .run();
    if (!ok) return null;

    const alignment =
      textAlignConfigs.find(
        ({ textAlign }) =>
          textAlign ===
          getMostCommonValue(
            selectedModels.map(
              ({ props }) => props as { textAlign?: TextAlign }
            ),
            'textAlign'
          )
      ) ?? textAlignConfigs[0];
    const update = (textAlign: TextAlign) => {
      chain.pipe(updateBlockAlign, { textAlign }).run();
    };

    return {
      content: html`
        <editor-menu-button
          .contentPadding="${'8px'}"
          .button=${html`
            <editor-icon-button aria-label="Align" .tooltip="${'Align'}">
              ${alignment.icon} ${EditorChevronDown}
            </editor-icon-button>
          `}
        >
          <div data-size="large" data-orientation="vertical">
            ${repeat(
              textAlignConfigs,
              item => item.name,
              ({ textAlign, name, icon }) => html`
                <editor-menu-action
                  aria-label=${name}
                  @click=${() => update(textAlign)}
                >
                  ${icon}<span class="label">${name}</span>
                </editor-menu-action>
              `
            )}
          </div>
        </editor-menu-button>
      `,
    };
  },
} as const satisfies ToolbarActionGenerator;

const inlineTextActionGroup = {
  id: 'b.inline-text',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  actions: textFormatConfigs.map(
    ({ id, name, action, activeWhen, icon }, score) => {
      return {
        id,
        icon,
        score,
        tooltip: name,
        run: ({ host }) => action(host),
        active: ({ host }) => activeWhen(host),
      };
    }
  ),
} as const satisfies ToolbarActionGroup;

const highlightActionGroup = {
  id: 'c.highlight',
  when: ({ chain }) => isFormatSupported(chain).run()[0],
  content({ chain }) {
    const updateHighlight = (styles: HighlightType) => {
      const payload = { styles };
      chain
        .try(chain => [
          chain.pipe(getTextSelectionCommand).pipe(formatTextCommand, payload),
          chain
            .pipe(getBlockSelectionsCommand)
            .pipe(formatBlockCommand, payload),
          chain.pipe(formatNativeCommand, payload),
        ])
        .run();
    };
    return html`
      <affine-highlight-dropdown-menu
        .updateHighlight=${updateHighlight}
      ></affine-highlight-dropdown-menu>
    `;
  },
} as const satisfies ToolbarAction;

const turnIntoDatabase = {
  id: 'e.convert-to-database',
  tooltip: 'Create Table',
  icon: DatabaseTableViewIcon(),
  when({ chain }) {
    const middleware = (count = 0) => {
      return (ctx: { selectedBlocks: BlockComponent[] }, next: () => void) => {
        const { selectedBlocks } = ctx;
        if (!selectedBlocks || selectedBlocks.length === count) return;

        const allowed = selectedBlocks.every(block =>
          DATABASE_CONVERT_WHITE_LIST.includes(block.flavour)
        );
        if (!allowed) return;

        next();
      };
    };

    let [ok] = chain
      .pipe(getTextSelectionCommand)
      .pipe(getSelectedBlocksCommand, {
        types: ['text'],
      })
      .pipe(middleware(1))
      .run();

    if (ok) return true;

    [ok] = chain
      .tryAll(chain => [
        chain.pipe(getBlockSelectionsCommand),
        chain.pipe(getImageSelectionsCommand),
      ])
      .pipe(getSelectedBlocksCommand, {
        types: ['block', 'image'],
      })
      .pipe(middleware(0))
      .run();

    return ok;
  },
  run({ host }) {
    convertToDatabase(host, tableViewMeta.type);
  },
} as const satisfies ToolbarAction;

// turnIntoLinkedDoc is disabled - commented out to avoid unused variable errors
// const turnIntoLinkedDoc = { ... } as const satisfies ToolbarAction;

export const builtinToolbarConfig = {
  actions: [
    conversionsActionGroup,
    alignActionGroup,
    inlineTextActionGroup,
    highlightActionGroup,
    turnIntoDatabase,
    //turnIntoLinkedDoc,
    {
      id: 'g.comment',
      ...blockCommentToolbarButton,
    },
    {
      placement: ActionPlacement.More,
      id: 'a.clipboard',
      actions: [
        {
          id: 'copy',
          label: '拷贝',
          icon: CopyIcon(),
          run({ chain, host }) {
            const [ok] = chain
              .pipe(getSelectedModelsCommand)
              .pipe(draftSelectedModelsCommand)
              .pipe(copySelectedModelsCommand)
              .run();

            if (!ok) return;

            toast(host, 'Copied to clipboard');
          },
        },
        {
          id: 'duplicate',
          label: '复制',
          icon: DuplicateIcon(),
          run({ chain, store, selection }) {
            store.captureSync();

            const [ok, { selectedBlocks = [] }] = chain
              .pipe(getTextSelectionCommand)
              .pipe(getSelectedBlocksCommand, {
                types: ['text'],
                mode: 'highest',
              })
              .run();

            // If text selection exists, convert to block selection
            if (ok && selectedBlocks.length) {
              selection.setGroup(
                'note',
                selectedBlocks.map(block =>
                  selection.create(BlockSelection, {
                    blockId: block.model.id,
                  })
                )
              );
            }

            chain
              .pipe(getSelectedModelsCommand, {
                types: ['block', 'image'],
                mode: 'highest',
              })
              .pipe(duplicateSelectedModelsCommand)
              .run();
          },
        },
      ],
      when(ctx) {
        return !ctx.flags.isNative();
      },
    },
    {
      placement: ActionPlacement.More,
      id: 'c.delete',
      actions: [
        {
          id: 'delete',
          label: '删除',
          icon: DeleteIcon(),
          variant: 'destructive',
          run({ chain }) {
            // removes text
            const [ok] = chain
              .pipe(getTextSelectionCommand)
              .pipe(deleteTextCommand)
              .run();

            if (ok) return;

            // removes blocks
            chain
              .tryAll(chain => [
                chain.pipe(getBlockSelectionsCommand),
                chain.pipe(getImageSelectionsCommand),
              ])
              .pipe(getSelectedModelsCommand)
              .pipe(deleteSelectedModelsCommand)
              .run();
          },
        },
      ],
      when(ctx) {
        return !ctx.flags.isNative();
      },
    },
  ],
} as const satisfies ToolbarModuleConfig;
