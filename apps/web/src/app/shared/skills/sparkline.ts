import { Component, computed, input } from '@angular/core';

const WIDTH = 100;
const HEIGHT = 28;

/** A tiny line of 0 to 100 scores over successive scoring passes. */
@Component({
  selector: 'app-sparkline',
  template: `
    @if (points(); as line) {
      <svg
        [attr.viewBox]="viewBox"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="label()"
      >
        <polyline [attr.points]="line" />
      </svg>
    }
  `,
  styleUrl: './sparkline.css',
})
export class Sparkline {
  readonly values = input.required<readonly number[]>();
  readonly label = input('Score over the call');

  protected readonly viewBox = `0 0 ${WIDTH} ${HEIGHT}`;
  protected readonly points = computed(() => {
    const values = this.values();
    if (values.length < 2) return null;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * WIDTH;
        const y = HEIGHT - 2 - (Math.min(100, Math.max(0, value)) / 100) * (HEIGHT - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
}
