import { toast } from '@blocksuite/affine-components/toast';
import type {
  ListBlockModel,
  ParagraphBlockModel,
} from '@blocksuite/affine-model';
import { insertContent } from '@blocksuite/affine-rich-text';
import {
  ArrowDownBigIcon,
  ArrowUpBigIcon,
  CopyIcon,
  DeleteIcon,
  DualLinkIcon,
  NowIcon,
  TodayIcon,
  TomorrowIcon,
  YesterdayIcon,
} from '@blocksuite/icons/lit';
import { type DeltaInsert, Slice, Text } from '@blocksuite/store';

import { slashMenuToolTips } from './tooltips';
import type { SlashMenuConfig } from './types';
import { formatDate, formatTime } from './utils';

export const defaultSlashMenuConfig: SlashMenuConfig = {
  items: () => {
    const now = new Date();
    const tomorrow = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return [
      {
        name: 'Today',
        icon: TodayIcon(),
        tooltip: slashMenuToolTips['Today'],
        description: formatDate(now),
        group: '6_Date@0',
        action: ({ std, model }) => {
          insertContent(std, model, formatDate(now));
        },
      },
      {
        name: 'Tomorrow',
        icon: TomorrowIcon(),
        tooltip: slashMenuToolTips['Tomorrow'],
        description: formatDate(tomorrow),
        group: '6_Date@1',
        action: ({ std, model }) => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          insertContent(std, model, formatDate(tomorrow));
        },
      },
      {
        name: 'Yesterday',
        icon: YesterdayIcon(),
        tooltip: slashMenuToolTips['Yesterday'],
        description: formatDate(yesterday),
        group: '6_Date@2',
        action: ({ std, model }) => {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          insertContent(std, model, formatDate(yesterday));
        },
      },
      {
        name: 'Now',
        icon: NowIcon(),
        tooltip: slashMenuToolTips['Now'],
        description: formatTime(now),
        group: '6_Date@3',
        action: ({ std, model }) => {
          insertContent(std, model, formatTime(now));
        },
      },
    ];
  },
};
