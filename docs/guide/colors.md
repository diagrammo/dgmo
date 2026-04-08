# Colors

Diagrammo uses named colors throughout. There are two ways colors appear in diagrams: **inline annotations** directly on elements, and **tags** that map metadata values to colors across many elements at once.

## Named Colors

Eleven color names are available everywhere colors are accepted:

<table>
<tr><th>Name</th><th>Swatch (Nord)</th></tr>
<tr><td><code>red</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#bf616a;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>orange</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#d08770;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>yellow</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#ebcb8b;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>green</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#a3be8c;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>blue</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#5e81ac;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>purple</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#b48ead;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>teal</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#8fbcbb;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>cyan</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#88c0d0;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>gray</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#4c566a;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>black</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#2e3440;border-radius:3px;vertical-align:middle"></span></td></tr>
<tr><td><code>white</code></td><td><span style="display:inline-block;width:20px;height:20px;background:#e5e9f0;border-radius:3px;vertical-align:middle;border:1px solid #d8dee9"></span></td></tr>
</table>

`black` and `white` are theme-stable — each palette picks near-darkest / near-lightest values that stay distinct from the canvas.

Swatches above use Nord values. The actual color rendered depends on your active color scheme — see [Color Schemes](#color-schemes) below.

---

## Color Schemes

Diagrammo includes ten built-in color schemes. Change yours in **Settings**. The same eleven color names resolve to different hex values in each scheme. Swatches show all eleven colors (red → white) for light / dark mode.

<table>
<tr><th>Scheme</th><th style="text-align:center">Light</th><th style="text-align:center">Dark</th></tr>
<tr>
  <td><strong>Bold</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#ffffff;padding:4px 6px;border-radius:4px;border:1px solid #cccccc"><span style="display:inline-block;width:14px;height:14px;background:#ff0000;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ff8000;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ffcc00;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#00cc00;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#0000ff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#cc00cc;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#009999;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#00bfff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#666666;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#000000;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f0f0f0;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#000000;padding:4px 6px;border-radius:4px;border:1px solid #333333"><span style="display:inline-block;width:14px;height:14px;background:#ff0000;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ff8000;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ffff00;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#00ff00;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#0066ff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ff00ff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#00cccc;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#00ffff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#999999;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#111111;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ffffff;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Catppuccin</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#eff1f5;padding:4px 6px;border-radius:4px;border:1px solid #ccd0da"><span style="display:inline-block;width:14px;height:14px;background:#d20f39;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fe640b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#df8e1d;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#40a02b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#1e66f5;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8839ef;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#179299;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#04a5e5;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#9ca0b0;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#4c4f69;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e6e9ef;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#1e1e2e;padding:4px 6px;border-radius:4px;border:1px solid #45475a"><span style="display:inline-block;width:14px;height:14px;background:#f38ba8;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fab387;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f9e2af;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a6e3a1;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#89b4fa;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#cba6f7;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#94e2d5;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#89dceb;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a6adc8;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#313244;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#cdd6f4;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Dracula</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#f8f8f2;padding:4px 6px;border-radius:4px;border:1px solid #d8d8d2"><span style="display:inline-block;width:14px;height:14px;background:#ff5555;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ffb86c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f1fa8c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#50fa7b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#6272a4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#bd93f9;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8be9fd;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8be9fd;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#6272a4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#282a36;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f0f0ec;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#282a36;padding:4px 6px;border-radius:4px;border:1px solid #6272a4"><span style="display:inline-block;width:14px;height:14px;background:#ff5555;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ffb86c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f1fa8c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#50fa7b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#6272a4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#bd93f9;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8be9fd;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8be9fd;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#6272a4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#343746;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f8f8f2;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Gruvbox</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#fbf1c7;padding:4px 6px;border-radius:4px;border:1px solid #d5c4a1"><span style="display:inline-block;width:14px;height:14px;background:#9d0006;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#af3a03;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b57614;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#79740e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#076678;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8f3f71;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#427b58;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#689d6a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#7c6f64;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#3c3836;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ebdbb2;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#282828;padding:4px 6px;border-radius:4px;border:1px solid #504945"><span style="display:inline-block;width:14px;height:14px;background:#fb4934;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fe8019;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fabd2f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b8bb26;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#83a598;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#d3869b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8ec07c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8ec07c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#928374;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#3c3836;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ebdbb2;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Monokai</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#fafaf8;padding:4px 6px;border-radius:4px;border:1px solid #d4d3cc"><span style="display:inline-block;width:14px;height:14px;background:#f92672;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fd971f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e6db74;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a6e22e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#5c7eab;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ae81ff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#66d9ef;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#66d9ef;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#75715e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#272822;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f0efe8;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#272822;padding:4px 6px;border-radius:4px;border:1px solid #49483e"><span style="display:inline-block;width:14px;height:14px;background:#f92672;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fd971f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e6db74;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a6e22e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#5c7eab;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ae81ff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#66d9ef;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#66d9ef;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#75715e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2d2e27;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f8f8f2;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Nord</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#eceff4;padding:4px 6px;border-radius:4px;border:1px solid #d8dee9"><span style="display:inline-block;width:14px;height:14px;background:#bf616a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#d08770;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ebcb8b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a3be8c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#5e81ac;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b48ead;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8fbcbb;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#88c0d0;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#4c566a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2e3440;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e5e9f0;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#2e3440;padding:4px 6px;border-radius:4px;border:1px solid #4c566a"><span style="display:inline-block;width:14px;height:14px;background:#bf616a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#d08770;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ebcb8b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a3be8c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#5e81ac;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b48ead;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8fbcbb;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#88c0d0;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#4c566a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#3b4252;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#eceff4;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>One Dark</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#fafafa;padding:4px 6px;border-radius:4px;border:1px solid #d0d0d0"><span style="display:inline-block;width:14px;height:14px;background:#e45649;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#c18401;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#c18401;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#50a14f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#4078f2;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a626a4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#0184bc;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#0184bc;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#a0a1a7;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#383a42;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f0f0f0;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#282c34;padding:4px 6px;border-radius:4px;border:1px solid #3e4451"><span style="display:inline-block;width:14px;height:14px;background:#e06c75;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#d19a66;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e5c07b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#98c379;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#61afef;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#c678dd;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#56b6c2;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#56b6c2;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#abb2bf;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#21252b;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#abb2bf;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Rosé Pine</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#faf4ed;padding:4px 6px;border-radius:4px;border:1px solid #f2e9e1"><span style="display:inline-block;width:14px;height:14px;background:#b4637a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#d7827e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ea9d34;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#286983;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#56949f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#907aa9;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#56949f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#56949f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#9893a5;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#575279;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#fffaf3;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#191724;padding:4px 6px;border-radius:4px;border:1px solid #26233a"><span style="display:inline-block;width:14px;height:14px;background:#eb6f92;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ea9a97;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#f6c177;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#3e8fb0;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#9ccfd8;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#c4a7e7;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#9ccfd8;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#9ccfd8;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#908caa;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2a273f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e0def4;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Solarized</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#fdf6e3;padding:4px 6px;border-radius:4px;border:1px solid #eee8d5"><span style="display:inline-block;width:14px;height:14px;background:#dc322f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#cb4b16;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b58900;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#859900;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#268bd2;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#6c71c4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2aa198;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2aa198;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#93a1a1;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#657b83;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#eee8d5;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#002b36;padding:4px 6px;border-radius:4px;border:1px solid #073642"><span style="display:inline-block;width:14px;height:14px;background:#dc322f;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#cb4b16;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b58900;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#859900;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#268bd2;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#6c71c4;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2aa198;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2aa198;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#586e75;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#073642;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#839496;border-radius:2px"></span></span></td>
</tr>
<tr>
  <td><strong>Tokyo Night</strong></td>
  <td><span style="display:inline-flex;gap:2px;background:#d5d6db;padding:4px 6px;border-radius:4px;border:1px solid #9699a3"><span style="display:inline-block;width:14px;height:14px;background:#f52a65;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#b15c00;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8c6c3e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#587539;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#2e7de9;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#7847bd;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#118c74;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#007197;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#8990b3;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#1a1b26;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#d0d5e3;border-radius:2px"></span></span></td>
  <td><span style="display:inline-flex;gap:2px;background:#1a1b26;padding:4px 6px;border-radius:4px;border:1px solid #3b4261"><span style="display:inline-block;width:14px;height:14px;background:#f7768e;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#ff9e64;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#e0af68;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#9ece6a;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#7aa2f7;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#bb9af7;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#1abc9c;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#7dcfff;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#565f89;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#292e42;border-radius:2px"></span><span style="display:inline-block;width:14px;height:14px;background:#c0caf5;border-radius:2px"></span></span></td>
</tr>
</table>

---

## Editor vs Export Palette

Your editor palette and your export palette don't have to match. You might prefer a dark scheme like Dracula or Tokyo Night while working — easier on the eyes during long sessions — but switch to a light scheme for exports that will end up in presentations, documentation, or shared links.

Diagrammo lets you set a separate **Export Color Scheme** in **Settings**. When configured, all exports (PNG, SVG, clipboard, share links) use that palette instead of your editor palette. The export theme (light, dark, or transparent background) is also independent and can be set in the **Export** dialog.

If no export palette is set, exports use whatever palette and theme you're currently editing in.

---

## Inline Color Annotations

Place a color name in parentheses directly on an element to color it explicitly.

### Flowchart nodes and edges

Append `(color)` inside the node definition or on an edge label:

```
flowchart Request Pipeline

(Start(green)) -> [Parse Input] -> <Valid?(blue)>
  -yes(green)-> [Process(teal)] -> (Success(green))
  -no(red)-> [Error Handler(red)] -> /Log Error(orange)/ -> (Failure(red))
```

Every node shape supports inline color — rounds `()`, rectangles `[]`, diamonds `<>`, parallelograms `//`, and more.

### Timeline eras and markers

```
timeline Project Roadmap

era 2025-01 -> 2025-06 Foundation (blue)
era 2025-07 -> 2025-12 Growth (green)

marker 2025-03 Beta Launch (orange)
marker 2025-09 GA Release (purple)
```

---

## Tags: Color by Metadata

Tags let you define named groups of values, assign a color to each value, then annotate your diagram elements with metadata. When a tag group is active, every element is colored by its matching value — without scattering color names throughout the diagram.

This is the primary way to color sequence diagrams, org charts, infrastructure diagrams, and timelines.

### Declaring a tag group

```
tag GroupName alias g
  Value1(blue)
  Value2(green)
  Value3(orange) default
```

- **`alias g`** — a short alias you use when assigning metadata (optional but recommended)
- **`(color)`** — the color for that value
- **`default`** — the fallback value applied to elements that have no explicit tag assignment

You can define multiple tag groups in one diagram. Only one group is "active" (coloring the diagram) at a time — the active group is selected in the diagram legend.

### Assigning metadata to elements

Use `| key: Value` after any element to attach metadata:

```
Gateway | t: Platform
Redis | c: Caching, t: Platform
```

Multiple metadata keys are separated by commas. Use the tag alias as the key.

### Sequence diagrams

Tags color participant boxes, self-messages, and message arrows. Use `active-tag` to set which tag group is shown by default.

```
sequence API Gateway — Infrastructure Concerns
active-tag Concern

tag Concern alias c
  Caching(blue)
  Auth(green)
  RateLimiting(orange)
  BusinessLogic(purple) default

tag Team alias t
  Platform(teal)
  Product(orange)
  Security(red)

Mobile is an actor
Gateway is a gateway | t: Platform
Redis is a cache | c: Caching, t: Platform

[Backend | t: Product]
  UserAPI is a service
  OrderAPI is a service
  DB is a database

== Authentication ==
Mobile -POST /orders-> Gateway
Gateway -verify token-> Gateway | c: Auth
Gateway -check rate limit-> Redis | c: RateLimiting

== Business Logic ==
Gateway -POST /orders-> OrderAPI
OrderAPI -INSERT order-> DB
OrderAPI -201 Created-> Gateway

== Response ==
Gateway -cache response-> Redis | c: Caching
Gateway -201 Created-> Mobile
```

Elements that share a tag value with the active group are highlighted in that color. Elements with no matching tag are shown in a neutral gray.

### Org charts

Org charts use tag groups to color nodes by any metadata field — location, seniority, status, team, etc. Switch between views using the legend.

```
org Acme Corp

tag Location
  NY(blue)
  LA(yellow)
  Remote(purple)

tag Status
  FTE(green)
  Contractor(orange)

Jane Smith
  role: CEO
  location: NY
  status: FTE

  Alex Chen
    role: CTO
    location: LA
    status: FTE

    [Platform Team]
      Alice Park
        role: Senior Engineer
        location: NY
        status: FTE
      Bob Torres
        role: Junior Engineer
        location: Remote
        status: Contractor
```

### Infrastructure diagrams

```
infra Production Traffic Flow

tag Team alias t
  Backend(blue)
  Platform(teal)

CloudFront | t: Platform
  -> CloudArmor

CloudArmor | t: Platform
  -> ALB

ALB | t: Platform
  -/api-> [API Pods]

[API Pods]
  APIServer | t: Backend
    instances: 3
    latency-ms: 45
```

### Timeline diagrams

Tags in timelines sort and color swim lanes. Use `sort tag:GroupName` to arrange items by tag value.

```
timeline Product Roadmap 2025

tag Team alias t
  Engineering(blue)
  Design(purple)
  Product(green)

era 2025-01 -> 2025-06 Phase 1 - Foundation

2025-01->2025-03 Core API Development | t: Engineering
2025-01->2025-02 Design System v1 | t: Design
2025-02 Competitor Analysis | t: Product
```
