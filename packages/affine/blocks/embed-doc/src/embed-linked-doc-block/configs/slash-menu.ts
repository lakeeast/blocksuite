import { EmbedLinkedDocBlockSchema } from '@blocksuite/affine-model';
import { insertContent } from '@blocksuite/affine-rich-text';
import { REFERENCE_NODE } from '@blocksuite/affine-shared/consts';
import { createDefaultDoc } from '@blocksuite/affine-shared/utils';
import {
  type SlashMenuConfig,
  SlashMenuConfigIdentifier,
} from '@blocksuite/affine-widget-slash-menu';
import { LinkedPageIcon, PlusIcon } from '@blocksuite/icons/lit';
import { type ExtensionType } from '@blocksuite/store';

import { LinkDocTooltip, NewDocTooltip } from './tooltips';

const linkedDocSlashMenuConfig: SlashMenuConfig = {
  items: [
  ],
};

export const LinkedDocSlashMenuConfigIdentifier = SlashMenuConfigIdentifier(
  EmbedLinkedDocBlockSchema.model.flavour
);

export const LinkedDocSlashMenuConfigExtension: ExtensionType = {
  setup: di => {
    di.addImpl(LinkedDocSlashMenuConfigIdentifier, linkedDocSlashMenuConfig);
  },
};
