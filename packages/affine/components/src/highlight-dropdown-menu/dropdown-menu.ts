import type { AffineTextStyleAttributes } from '@blocksuite/affine-shared/types';
import { PropTypes, requiredProperties } from '@blocksuite/std';
import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { html, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { EditorChevronDown } from '../toolbar';

const colors = [
  'default',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'grey',
] as const;

const colorLabelsZh: Record<typeof colors[number], string> = {
  default: '默认颜色',
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  teal: '蓝绿色',
  blue: '蓝色',
  purple: '紫色',
  grey: '灰色',
};

export type HighlightType = Pick<
  AffineTextStyleAttributes,
  'color' | 'background'
>;

// TODO(@fundon): these recent settings should be added to the dropdown menu
// tests/blocksutie/e2e/format-bar.spec.ts#253
//
// let latestHighlightColor: string | null = null;
// let latestHighlightType: HighlightType = 'background';

@requiredProperties({
  updateHighlight: PropTypes.instanceOf(Function),
})
export class HighlightDropdownMenu extends LitElement {
  @property({ attribute: false })
  accessor updateHighlight!: (styles: HighlightType) => void;

  private readonly _update = (style: HighlightType) => {
    // latestHighlightColor = value;
    // latestHighlightType = type;

    this.updateHighlight(style);
  };

  override render() {
    const prefix = '--affine-text-highlight';
    const _button = (html`
      <editor-icon-button aria-label="highlight" .tooltip="${'颜色'}">
        <affine-highlight-duotone-icon
          style=${styleMap({
            '--color':
              // latestHighlightColor ?? 'var(--affine-text-primary-color)',
              'var(--affine-text-primary-color)',
          })}
        ></affine-highlight-duotone-icon>
        ${EditorChevronDown}
      </editor-icon-button>
    ` as unknown as any);

    const tpl = html`
      <editor-menu-button
        .contentPadding="${'8px'}"
        .button=${_button}
      >
        <div data-size="large" data-orientation="vertical">
          <div class="highlight-heading">字体颜色</div>
          ${repeat(colors, color => {
            const isDefault = color === 'default';
            const value = isDefault
              ? null
              : `var(${prefix}-foreground-${color})`;
            return html`
              <editor-menu-action
                data-testid="foreground-${color}"
                @click=${() => this._update({ color: value })}
              >
                <affine-text-duotone-icon
                  style=${styleMap({
                    '--color': value ?? 'var(--affine-text-primary-color)',
                  })}
                ></affine-text-duotone-icon>
                <span class="label capitalize"
                  >${isDefault ? colorLabelsZh.default : colorLabelsZh[color]}</span
                >
              </editor-menu-action>
            `;
          })}

          <div class="highlight-heading">字体背景颜色</div>
          ${repeat(colors, color => {
            const isDefault = color === 'default';
            const value = isDefault ? null : `var(${prefix}-${color})`;
            return html`
              <editor-menu-action
                data-testid="background-${color}"
                @click=${() => this._update({ background: value })}
              >
                <affine-text-duotone-icon
                  style=${styleMap({
                    '--color': 'var(--affine-text-primary-color)',
                    '--background': value ?? 'transparent',
                  })}
                ></affine-text-duotone-icon>

                <span class="label capitalize"
                  >${isDefault ? colorLabelsZh.default : colorLabelsZh[color]}</span
                >
              </editor-menu-action>
            `;
          })}
        </div>
      </editor-menu-button>
    `;

    return tpl as unknown as TemplateResult;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-highlight-dropdown-menu': HighlightDropdownMenu;
  }
}
