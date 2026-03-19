## 0005: 👻 ゴーストCanvasリークの修正 (Ghost Canvas Cleanup)

### 状況

- ComfyUI (LiteGraph) 環境でエクスポートを実行すると、一時的な Canvas インスタンスが `app.graph` にバインドされたまま残ってしまう。
- これにより、エクスポート完了後も LiteGraph の描画ループが非表示の Canvas（parentNode が null の状態）を参照し続け、`TypeError: this.canvas.parentNode was null` エラーを引き起こしていた。
- また、古いエクスポート用 Canvas がメモリ上に残り続け、イベントリスナーも解除されないため、ブラウザの動作が重くなる原因となっていた。

### 決定

- `captureLegacy` (legacy_capture.js) および `safeCleanup` (render_graph_offscreen.js) において、エクスポート完了時に確実に Canvas を解除する処理を追加する。
- 処理を `try...finally` ブロックで囲み、以下のメソッドを確実に呼び出す：
  1. `offscreen.stopRendering()`: 描画ループの停止
  2. `offscreen.setCanvas(null)`: LiteGraph 内部での Canvas 参照の解除
  3. `offscreen.unbind_events()`: イベントリスナーの解除

### 理由

- エラーの直接的な原因は DOM から切り離された Canvas に対して LiteGraph が `checkPanels` 等を実行しようとすることにある。
- `setCanvas(null)` および `unbind_events()` を呼び出すことで、LiteGraph の管理下から Canvas を安全に切り離すことができる。

### 影響

- エクスポート後の安定性が向上し、コンソールエラーが解消される。
- UI 操作のパフォーマンス低下が防止される。

### 補足

- 修正は `web/js/core/backends/legacy_capture.js` および `web/js/export/render_graph_offscreen.js` の両方に適用する。
