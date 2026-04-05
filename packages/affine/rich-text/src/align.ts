import { TextAlign } from '@blocksuite/affine-model';
import {
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
} from '@blocksuite/icons/lit';
import type { TemplateResult } from 'lit';

export interface TextAlignConfig {
  textAlign: TextAlign;
  name: string;
  hotkey: string[] | null;
  icon: TemplateResult<1>;
}

export const textAlignConfigs: TextAlignConfig[] = [
  {
    textAlign: TextAlign.Left,
    name: '左对齐',
    hotkey: [`Mod-Shift-L`],
    icon: TextAlignLeftIcon(),
  },
  {
    textAlign: TextAlign.Center,
    name: '居中对齐',
    hotkey: [`Mod-Shift-E`],
    icon: TextAlignCenterIcon(),
  },
  {
    textAlign: TextAlign.Right,
    name: '右对齐',
    hotkey: [`Mod-Shift-R`],
    icon: TextAlignRightIcon(),
  },
];
