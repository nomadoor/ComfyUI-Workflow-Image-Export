## 0003: PNG ワークフロー埋め込みの互換性

### 状況

workflow を PNG に埋め込み、ComfyUI 側で読み戻せる必要がある。
以前 iTXt を使う実装に切り替えたが、ComfyUI 側で
`Failed to parse workflow: Unexpected token ''` が発生し、
PNG から workflow JSON を復元できなかった。

### 決定

- 埋め込みは **tEXt チャンクのみ**を使用する。
- iTXt は ComfyUI 側で誤読される可能性があるため使わない。

### 理由

- ComfyUI が iTXt を tEXt として扱ってしまい、NULL 文字混入で
  JSON 解析に失敗するケースが確認された。
- tEXt であれば ComfyUI が確実に読み取れる。

### 影響

- 非 Latin-1 文字の完全な互換性は保証されない可能性がある。
  ただし現状は「読み戻せること」を最優先する。
- 将来 ComfyUI 側が iTXt を正式対応した場合は再検討する。

### 補足

- 実装は `web/js/export/png_embed_workflow.js` で
  tEXt チャンクを挿入する。
