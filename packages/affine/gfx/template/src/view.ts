import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine-ext-loader';

import { effects } from './effects';

export class TemplateViewExtension extends ViewExtensionProvider {
  override name = 'affine-template-view';

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(_context: ViewExtensionContext) {
    /*
    super.setup(_context);
    if (this.isEdgeless(_context.scope)) {
      // TemplateTool and templateSeniorTool registration disabled
    }
    */
  }
}
