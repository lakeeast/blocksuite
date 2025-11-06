import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import { IS_MOBILE } from '@blocksuite/global/env';

import { effects } from './effects';
import { SlashMenuExtension } from './extensions';

export class SlashMenuViewExtension extends ViewExtensionProvider {
  override name = 'affine-slash-menu-widget';

  override effect() {
    super.effect();
    effects();
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    // Enable slash menu on all devices including mobile
    // Support both new scope-based mobile detection and legacy IS_MOBILE detection
    context.register(SlashMenuExtension);
  }
}
