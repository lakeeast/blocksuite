import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine-ext-loader';
import { ParagraphBlockModel } from '@blocksuite/affine-model';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import { literal } from 'lit/static-html.js';
import { z } from 'zod';

import { effects } from './effects';
import { ParagraphMarkdownExtension } from './markdown.js';
import { ParagraphBlockConfigExtension } from './paragraph-block-config.js';
import {
  ParagraphKeymapExtension,
  ParagraphTextKeymapExtension,
} from './paragraph-keymap.js';

const placeholders = {
  text: "输入'/'唤醒菜单",
  h1: '标题 1',
  h2: '标题 2',
  h3: '标题 3',
  h4: '标题 4',
  h5: '标题 5',
  h6: '标题 6',
  quote: '',
};

const optionsSchema = z.object({
  getPlaceholder: z.optional(
    z.function().args(z.instanceof(ParagraphBlockModel)).returns(z.string())
  ),
});

export class ParagraphViewExtension extends ViewExtensionProvider<
  z.infer<typeof optionsSchema>
> {
  override name = 'affine-paragraph-block';

  override schema = optionsSchema;

  override effect(): void {
    super.effect();
    effects();
  }

  override setup(
    context: ViewExtensionContext,
    options?: z.infer<typeof optionsSchema>
  ) {
    super.setup(context, options);
    const getPlaceholder =
      options?.getPlaceholder ?? (model => placeholders[model.props.type]);

    context.register([
      FlavourExtension('affine:paragraph'),
      BlockViewExtension('affine:paragraph', literal`affine-paragraph`),
      ParagraphTextKeymapExtension,
      ParagraphKeymapExtension,
      ParagraphBlockConfigExtension({
        getPlaceholder,
      }),
      ParagraphMarkdownExtension,
    ]);
  }
}
