# ComfyUI-Workflow-Image-Export テスト戦略

## 結論（エグゼクティブサマリー）

このリポジトリは **Python が 0.1%、JavaScript が 94%** という極端な構成で、Python 側は `__init__.py` に `WEB_DIRECTORY` と空の `NODE_CLASS_MAPPINGS` を定義するだけのシェルである。
したがって **pytest でテストすべき Python ロジックは実質ゼロ**であり、テスト戦略のほぼ全体を JavaScript 側で構築する必要がある。

幸い、コードを精査すると以下の 3 層に分離できる：

1. **Pure Function 層** — DOM にも ComfyUI にも依存しない関数群。`bbox.js`, `utils.js`（crc32, concatUint8, toUint32）, `png_embed_workflow.js`, `background_modes.js`（一部）, `index.js` 内の `parseHexColor`, `parseRgbColor`, `normalizeSelectedIds`, `shouldTile`, `clampPngCompression`, `adler32Update` など。Node.js + Vitest/Jest でそのまま単体テスト可能。
2. **DOM Mock 層** — `document.createElement("canvas")`, `getComputedStyle`, `getBoundingClientRect` 等が必要だが、ComfyUI (`app`, `LGraphCanvas`) には依存しない関数群。`dom_utils.js` の一部、`storage.js`（localStorage mock で十分）、`raster.js`, `download.js`。jsdom + モックで対応可能。
3. **ComfyUI 統合層** — `app.graph`, `LGraphCanvas`, `LiteGraph` のプロトタイプ操作、実際の canvas 描画パイプライン、DOM widget overlay の capture。実ブラウザ or Playwright が必要。

**「今すぐ書くべきテスト」は層 1 に集中しており、投資対効果が最も高い。** 層 2 は余裕があれば。層 3（E2E）はコストが高く、CI が ComfyUI インスタンスを必要とするため後回し。

**Golden Image 比較について**: このリポジトリでは **壊れやすすぎて非推奨**。理由は、出力が LiteGraph のレンダリングエンジン、ComfyUI のテーマ CSS 変数、DOM widget の動的配置、devicePixelRatio に依存しており、環境差でピクセル単位の差分が頻発するため。代わりに、構造的アサーション（PNG chunk 構造、BBox 数値、metadata roundtrip）が有効。

---

## 1. 壊れやすい箇所の大分類

ソースコード精査に基づく 8 分類：

| # | カテゴリ | 主要ファイル | 壊れやすさ |
|---|---------|-------------|-----------|
| A | **BBox 計算** | `bbox.js` | 高 — ノード配置の多様な入力形式 |
| B | **PNG Chunk 操作・Workflow 埋め込み** | `png_embed_workflow.js`, `embed.js`, `utils.js` | 高 — バイナリ互換性 |
| C | **色解析・背景モード** | `background_modes.js`, `index.js`（parseHexColor 等） | 中 |
| D | **Export パイプライン制御** | `export/index.js`（shouldTile, scale, scope 合成） | 高 — 条件分岐が複雑 |
| E | **DOM Widget Overlay** | `dom_utils.js`, `legacy_capture.js` | 高 — DOM 構造依存 |
| F | **Graph 構成・メディア同期** | `render_graph_offscreen.js`（configureGraph, syncLiveNodeMedia, syncLiveNodeText） | 高 — ComfyUI 内部構造依存 |
| G | **Settings / Storage / Menu 登録** | `storage.js`, `settings.js`, `menu.js`, `detect.js` | 低〜中 |
| H | **Dialog UI** | `dialog.js` | 低 — 主に表示ロジック |

---

## 2. 各カテゴリの詳細分析

### A. BBox 計算 (`bbox.js`)

**何が壊れうるか**
- `node.pos` が `[x, y]` でなく `{x, y}` や Float32Array で渡された場合の正規化失敗
- `node.size` が `undefined` / `[0, 0]` / 負数の場合のフォールバック不全
- `getBounding()` が返す `[x, y, w, h]` 配列で `w=0` や `h=0` のエッジケース
- `selectedNodeIds` フィルタ使用時に groups が除外されるべきところ含まれるバグ
- 全ノード位置が同一点にある場合（width/height=0）

**ユーザーへの見え方**: 画像が真っ黒、ノードが途切れる、余白がおかしい

**テスト手法**: **単体テストで十分**。Pure function。モック不要。

**推奨テストケース**:
```
test_bbox_empty_graph_returns_fallback
test_bbox_single_node_basic
test_bbox_negative_coordinates
test_bbox_padding_applied_symmetrically
test_bbox_selection_mode_excludes_unselected_nodes
test_bbox_selection_mode_excludes_groups
test_bbox_node_pos_as_object_notation
test_bbox_node_pos_as_float32array
test_bbox_node_size_zero_uses_fallback
test_bbox_node_size_negative_uses_fallback
test_bbox_node_with_getBounding_method
test_bbox_getBounding_returns_zero_width_falls_through_to_pos_size
test_bbox_all_nodes_at_same_position
test_bbox_mixed_bounding_and_pos_size_nodes
test_bbox_infinity_coordinates_handled
test_bbox_nan_coordinates_handled
test_bbox_large_graph_1000_nodes
```

---

### B. PNG Chunk 操作・Workflow 埋め込み (`png_embed_workflow.js`, `utils.js`)

**何が壊れうるか**
- CRC32 計算の誤り → ComfyUI 側で PNG 読み込み失敗
- tEXt chunk の構造が PNG 仕様に違反 → 一部 viewer で壊れる
- IEND が見つからない場合のフォールバック（embed せず返す）の漏れ
- 大きなワークフロー JSON（数 MB）での ArrayBuffer 操作
- `toUint32` の符号付き/符号なし整数の扱い

**ユーザーへの見え方**: 「Embed Workflow をオンにしたのに ComfyUI で読み戻せない」

**テスト手法**: **単体テストで十分**。Node.js 環境で `Blob` の polyfill（`node:buffer` の `Blob`）を使えばブラウザ不要。**スナップショットテスト向き**（生成された PNG バイナリの chunk 構造を検証）。

**推奨テストケース**:
```
test_crc32_known_vectors
test_crc32_empty_input
test_crc32_large_input
test_toUint32_zero
test_toUint32_max_uint32
test_toUint32_negative_wraps_correctly
test_concatUint8_empty_arrays
test_concatUint8_multiple_arrays
test_create_png_text_chunk_structure
test_create_png_text_chunk_keyword_null_separator
test_embed_workflow_in_valid_png
test_embed_workflow_roundtrip_preserved
test_embed_workflow_inserted_before_IEND
test_embed_workflow_non_png_blob_returns_unchanged
test_embed_workflow_truncated_png_returns_unchanged
test_embed_workflow_null_workflow_returns_unchanged
test_embed_workflow_large_json_5mb
test_embed_workflow_unicode_content_preserved
```

---

### C. 色解析・背景モード (`background_modes.js`, `index.js`)

**何が壊れうるか**
- `parseHexColor` が 3 桁 / 6 桁以外の hex（8 桁 RGBA など）をハンドルしない
- `parseRgbColor` が `rgb(255 128 0)` （カンマなし新構文）を解析できない
- `resolveUiBackgroundColor` が CSS 変数名の変更に追従できない
- `applyBackgroundMode` で transparent 指定時に `_pattern` 残留

**ユーザーへの見え方**: 背景が意図しない色、透過にしたのに不透明

**テスト手法**: `parseHexColor`, `parseRgbColor` は **単体テスト**。`resolveUiBackgroundColor`, `applyBackgroundMode` は **DOM mock が必要**（jsdom + CSS 変数スタブ）。

**推奨テストケース**:
```
test_parseHexColor_3digit
test_parseHexColor_6digit
test_parseHexColor_with_hash_prefix
test_parseHexColor_invalid_returns_null
test_parseHexColor_8digit_rgba_returns_null
test_parseRgbColor_standard
test_parseRgbColor_with_alpha
test_parseRgbColor_invalid_returns_null
test_applyBackgroundMode_transparent_sets_rgba_zero
test_applyBackgroundMode_solid_uses_provided_color
test_applyBackgroundMode_ui_reads_css_vars
test_applyBackgroundMode_clears_pattern
test_getExportBackgroundFillColor_transparent_returns_null
```

---

### D. Export パイプライン制御 (`export/index.js`)

**何が壊れうるか**
- `shouldTile` の閾値判定（`MAX_CANVAS_EDGE`, `TILE_THRESHOLD_PIXELS`）境界値
- `clampPngCompression` が NaN/文字列を受けた場合
- scope 合成（背景 + dim + selected の 3 レイヤー drawImage）の alpha 計算
- WebP + huge 組み合わせで適切にエラーを投げるか
- tiled PNG encode で Adler32 checksum が正しいか
- `scaleCanvas` で scale=0 や scale=Infinity

**ユーザーへの見え方**: エクスポートが無言で失敗、巨大画像が途中で壊れる、WebP で真っ黒

**テスト手法**: `shouldTile`, `clampPngCompression`, `normalizeSelectedIds`, `adler32Update` は **単体テスト**。scope 合成は canvas mock が必要で **統合テスト向き**。tiled PNG の正当性は **構造検証（PNG chunk parse）で対応可能**。

**推奨テストケース**:
```
test_shouldTile_below_threshold_returns_false
test_shouldTile_exceeds_pixel_threshold
test_shouldTile_exceeds_edge_threshold
test_shouldTile_exceeds_max_canvas_edge
test_clampPngCompression_valid_range
test_clampPngCompression_nan_returns_default
test_clampPngCompression_negative_clamped_to_zero
test_clampPngCompression_above_9_clamped
test_normalizeSelectedIds_filters_non_finite
test_normalizeSelectedIds_non_array_returns_empty
test_adler32_known_vector
test_adler32_empty_input
test_webp_huge_export_throws_specific_error_code
test_scaleCanvas_scale_1_returns_same
test_scaleCanvas_scale_0_returns_same
test_scaleCanvas_scale_2_doubles_dimensions
```

---

### E. DOM Widget Overlay (`dom_utils.js`, `legacy_capture.js`)

**何が壊れうるか**
- `getNodeIdFromElement` で `data-node-id` 属性名が ComfyUI バージョンで変わる
- `getDomElementGraphRect` で `ds.scale` / `ds.offset` の座標変換ミス（HiDPI 問題 — ADR でも言及）
- `collectTextElementsFromDom` のセレクタが ComfyUI テーマ / custom node の DOM 構造に合わない
- VHS video 要素の検出ロジック（`isVhsLikeVideo`）がURL パターン変更で壊れる

**ユーザーへの見え方**: テキストエリアの内容が画像に反映されない、動画サムネイルが欠落

**テスト手法**: `getNodeIdFromElement`, `isElementInGraphNode`, `resolveNodeIdForGraphRect` は **jsdom + mock DOM で単体テスト可能**。座標変換系（`getDomElementGraphRect`, `canvasPointToGraph`）は入力→出力の数値テストだが `getBoundingClientRect` のスタブが必要。VHS/media 検出は **統合テスト向き（実ブラウザ推奨）**。

**推奨テストケース**:
```
test_getNodeIdFromElement_data_node_id
test_getNodeIdFromElement_data_nodeid_variant
test_getNodeIdFromElement_no_ancestor_returns_null
test_getNodeIdFromElement_non_numeric_returns_null
test_isElementInGraphNode_with_comfy_node_class
test_isElementInGraphNode_with_data_attribute
test_isElementInGraphNode_detached_element_returns_false
test_resolveNodeIdForGraphRect_center_inside_node
test_resolveNodeIdForGraphRect_center_outside_all_returns_null
test_canvasPointToGraph_identity_transform
test_canvasPointToGraph_with_scale_and_offset
test_getDomElementGraphRect_no_dpr_overcorrection
```

---

### F. Graph 構成・メディア同期 (`render_graph_offscreen.js`)

**何が壊れうるか**
- `configureGraph` のフォールバックチェーン（`configure` → `deserialize` → `load`）で、
  特定の ComfyUI frontend バージョンが例外を投げるパターン（ADR-0006 に記載）
- `copyNodeMedia` のキーリストに将来の custom node が使うプロパティが欠落
- `syncLiveNodeText` で widget 値の同期が widgets_values の型（配列 vs オブジェクト）で分岐

**ユーザーへの見え方**: 「Error: Offscreen render: graph.configure failed」エラー、画像プレビューが表示されない

**テスト手法**: `configureGraph` は **mock graph オブジェクトで単体テスト可能**（configure/deserialize/load の各メソッドの有無・成功・失敗の組み合わせ）。`copyNodeMedia` も pure。`syncLiveNodeText` は widget mock 構造の準備が重いが DOM 不要。**実ブラウザ不要。**

**推奨テストケース**:
```
test_configureGraph_with_configure_method_succeeds
test_configureGraph_configure_fails_falls_back_to_deserialize
test_configureGraph_all_methods_fail_throws_detailed_error
test_configureGraph_json_string_input_parsed
test_configureGraph_invalid_json_string_throws
test_configureGraph_structuredClone_used_when_available
test_copyNodeMedia_copies_imgs_key
test_copyNodeMedia_skips_video_element_keys
test_copyNodeMedia_returns_false_when_nothing_copied
test_syncLiveNodeMedia_matches_by_id
test_syncLiveNodeText_array_widgets_values
test_syncLiveNodeText_object_widgets_values
test_syncLiveNodeText_setValue_method_preferred
test_copyRenderSettings_copies_NODE_prefixed_keys
test_disableCanvasInfoOverlay_sets_all_false
```

---

### G. Settings / Storage / Menu 登録

**何が壊れうるか**
- `loadLastUsed` で localStorage に壊れた JSON が入っている場合
- `installLegacyCanvasMenuItem` のポーリングがタイムアウトする
- `getSettingsAccess` の ComfyUI API 検出チェーン

**ユーザーへの見え方**: 前回の設定が復元されない、右クリックメニューに項目が出ない

**テスト手法**: `storage.js` は **localStorage mock で単体テスト**。menu/settings は ComfyUI 依存が強く **統合テスト向き**。

**推奨テストケース**:
```
test_loadLastUsed_valid_json
test_loadLastUsed_corrupt_json_returns_null
test_loadLastUsed_empty_returns_null
test_saveLastUsed_roundtrip
test_clearLastUsed_removes_key
test_sanitizeWorkflow_strips_unknown_keys
test_sanitizeWorkflow_missing_nodes_returns_null
test_sanitizeWorkflow_missing_links_returns_null
test_normalizeExportOptions_webp_disables_embed
test_normalizeExportOptions_png_preserves_embed
```

---

### H. Dialog UI (`dialog.js`)

**何が壊れうるか**: UI 表示の崩れ、イベントハンドラの未接続

**テスト手法**: E2E（Playwright）向き。単体テストの投資対効果が低い。**後回し推奨。**

---

## 3. 優先順位

### Tier 1: 今すぐ最低限やるべき（Pure Function、Node.js のみ）

| テスト対象 | テスト数目安 | 理由 |
|-----------|------------|------|
| `bbox.js` — computeGraphBBox | ~15 | 出力画像の正しさの根幹。入力バリエーションが多く壊れやすい |
| `utils.js` — crc32, toUint32, concatUint8 | ~8 | PNG 埋め込みの基盤。1bit 狂うと全壊 |
| `png_embed_workflow.js` — embedWorkflowInPngBlob | ~8 | ユーザーの最重要機能（workflow roundtrip）を守る |
| `index.js` — parseHexColor, parseRgbColor, shouldTile, clampPngCompression, normalizeSelectedIds, adler32Update | ~15 | 分岐が多い制御ロジック |
| `embed.js` — sanitizeWorkflow | ~4 | workflow の互換性を守る |

**合計: 約 50 テスト。Vitest + Node.js のみ。CI 実行時間 < 5 秒。**

### Tier 2: 余裕があればやる（jsdom mock 必要）

| テスト対象 | テスト数目安 | 理由 |
|-----------|------------|------|
| `dom_utils.js` — getNodeIdFromElement, isElementInGraphNode, resolveNodeIdForGraphRect, canvasPointToGraph | ~12 | DOM 依存だが jsdom で十分テスト可能 |
| `storage.js` — loadLastUsed / saveLastUsed / clearLastUsed | ~5 | localStorage mock で簡単 |
| `background_modes.js` — applyBackgroundMode | ~5 | CSS 変数 mock が必要 |
| `render_graph_offscreen.js` — configureGraph, copyNodeMedia | ~10 | mock graph で可能 |
| `capture/index.js` — normalizeExportOptions, getSelectedNodeIds | ~5 | app mock |

**合計: 約 37 テスト。jsdom 追加。CI 実行時間 < 10 秒。**

### Tier 3: コストが高いので後回し（実ブラウザ or ComfyUI 統合）

| テスト対象 | テスト数目安 | 理由 |
|-----------|------------|------|
| renderGraphOffscreen 全体 | ~5 | LGraph/LGraphCanvas の実インスタンスが必要 |
| DOM overlay capture (drawDomWidgetOverlays, drawVideoOverlays) | ~5 | 実 DOM widget + canvas が必要 |
| Dialog E2E (open → 設定変更 → export → download) | ~3 | ComfyUI 実インスタンス + Playwright |
| Selection scope 合成の visual correctness | ~3 | 3-pass rendering の結果検証 |
| Tiled PNG export の画像整合性 | ~2 | 巨大 canvas の生成が必要 |

**合計: 約 18 テスト。Playwright + ComfyUI Docker。CI 実行時間 数分。**

---

## 4. Python / JavaScript / E2E のレイヤー分担

```
┌─────────────────────────────────────────────────────┐
│  Playwright E2E (Tier 3)                            │
│  - ComfyUI 実インスタンスを起動                        │
│  - dialog 操作 → export → download file 検証          │
│  - DOM overlay の visual regression (optional)        │
├─────────────────────────────────────────────────────┤
│  Vitest + jsdom (Tier 2)                            │
│  - DOM mock 付き単体テスト                            │
│  - dom_utils, storage, configureGraph               │
├─────────────────────────────────────────────────────┤
│  Vitest / Node.js pure (Tier 1) ← ★ ここを最優先     │
│  - bbox, crc32, PNG embed, color parse, shouldTile  │
│  - ゼロ依存、最速                                    │
├─────────────────────────────────────────────────────┤
│  pytest (Python)                                    │
│  - __init__.py の import smoke test のみ (1テスト)    │
│  - WEB_DIRECTORY, NODE_CLASS_MAPPINGS の存在確認       │
└─────────────────────────────────────────────────────┘
```

### pytest で担うべきスコープ（最小限）

```python
# test_init.py
def test_init_exports():
    """ComfyUI がこの custom node を認識するために必要な変数が存在するか"""
    from ComfyUI_Workflow_Image_Export import (
        WEB_DIRECTORY,
        NODE_CLASS_MAPPINGS,
        NODE_DISPLAY_NAME_MAPPINGS,
    )
    assert WEB_DIRECTORY == "./web"
    assert isinstance(NODE_CLASS_MAPPINGS, dict)
    assert isinstance(NODE_DISPLAY_NAME_MAPPINGS, dict)
```

これ以上を Python で書く意味はない。ロジックが JavaScript に 99.9% 集中しているため。

### Vitest で担うべきスコープ（Tier 1 + Tier 2）

```
tests/
  unit/
    bbox.test.js           ← computeGraphBBox, normalizeSize, normalizePos
    utils.test.js          ← crc32, toUint32, concatUint8
    png-embed.test.js      ← embedWorkflowInPngBlob, createPngTextChunk
    color-parse.test.js    ← parseHexColor, parseRgbColor, parseColorToRgb
    export-control.test.js ← shouldTile, clampPngCompression, normalizeSelectedIds
    adler32.test.js        ← adler32Update
    sanitize.test.js       ← sanitizeWorkflow
  dom/
    dom-utils.test.js      ← getNodeIdFromElement, isElementInGraphNode, etc.
    storage.test.js        ← loadLastUsed, saveLastUsed, clearLastUsed
    background.test.js     ← applyBackgroundMode (with CSS var mocks)
    graph-config.test.js   ← configureGraph, copyNodeMedia, syncLiveNodeMedia
    capture-options.test.js ← normalizeExportOptions
```

### Playwright で担うべきスコープ（Tier 3）

```
e2e/
  export-basic.spec.js     ← dialog open → PNG export → file is valid PNG
  export-webp.spec.js      ← WebP export → no embed → valid WebP
  export-selection.spec.js ← ノード選択 → scope export → crop bounds 正常
  embed-roundtrip.spec.js  ← PNG export with embed → ComfyUI にドラッグ → workflow 復元
```

---

## 5. テストケース一覧（全量・粒度指定）

### Tier 1: Pure Function テスト

```javascript
// === bbox.test.js ===
describe("normalizeSize", () => {
  test_normalizeSize_valid_array_passthrough
  test_normalizeSize_object_with_width_height
  test_normalizeSize_object_with_w_h
  test_normalizeSize_invalid_returns_fallback
  test_normalizeSize_zero_dimensions_returns_fallback
  test_normalizeSize_negative_dimensions_returns_fallback
})

describe("normalizePos", () => {
  test_normalizePos_valid_array
  test_normalizePos_object_with_x_y
  test_normalizePos_invalid_returns_zero_zero
  test_normalizePos_nan_returns_zero_zero
})

describe("computeGraphBBox", () => {
  test_bbox_empty_graph_returns_fallback_size
  test_bbox_single_node_at_origin
  test_bbox_single_node_with_padding
  test_bbox_two_nodes_spanning_range
  test_bbox_negative_coordinates
  test_bbox_with_groups_included
  test_bbox_selection_mode_filters_to_selected_ids
  test_bbox_selection_mode_excludes_groups
  test_bbox_selection_mode_empty_selection_uses_all
  test_bbox_node_with_getBounding_method
  test_bbox_getBounding_zero_size_falls_through
  test_bbox_useBounding_false_ignores_getBounding
  test_bbox_node_pos_as_Float32Array
  test_bbox_all_infinity_coordinates_handled
  test_bbox_width_and_height_minimum_1
  test_bbox_paddedMinX_paddedMinY_correct
})

// === utils.test.js ===
describe("crc32", () => {
  test_crc32_empty_returns_0
  test_crc32_ascii_known_value            // "IEND" → known CRC
  test_crc32_binary_known_value
  test_crc32_large_buffer_consistent
})

describe("toUint32", () => {
  test_toUint32_zero
  test_toUint32_one
  test_toUint32_0xFFFFFFFF
  test_toUint32_byte_order_big_endian
})

describe("concatUint8", () => {
  test_concat_empty_arrays
  test_concat_single_array
  test_concat_multiple_arrays_correct_order
  test_concat_total_length_correct
})

// === png-embed.test.js ===
describe("embedWorkflowInPngBlob", () => {
  test_embed_in_minimal_valid_png
  test_embed_preserves_existing_chunks
  test_embed_tEXt_chunk_before_IEND
  test_embed_workflow_keyword_is_workflow
  test_embed_null_separator_between_keyword_and_text
  test_embed_roundtrip_json_preserved
  test_embed_non_png_blob_returns_unchanged
  test_embed_null_blob_returns_null
  test_embed_null_workflow_returns_blob
  test_embed_large_workflow_json
  test_embed_unicode_workflow_content
  test_embed_crc_is_valid_for_tEXt_chunk
})

// === color-parse.test.js ===
describe("parseHexColor", () => {
  test_hex_3digit_expanded_correctly    // #f00 → {r:255,g:0,b:0}
  test_hex_6digit_parsed
  test_hex_with_hash
  test_hex_without_hash
  test_hex_invalid_chars_returns_null
  test_hex_empty_string_returns_null
  test_hex_8digit_returns_null           // このコードは 8 桁非対応
})

describe("parseRgbColor", () => {
  test_rgb_standard
  test_rgba_ignores_alpha
  test_rgb_spaces_trimmed
  test_rgb_invalid_format_returns_null
  test_rgb_non_numeric_returns_null
})

// === export-control.test.js ===
describe("shouldTile", () => {
  test_shouldTile_small_image_false
  test_shouldTile_exceeds_pixel_count_true
  test_shouldTile_exceeds_edge_length_true
  test_shouldTile_exceeds_MAX_CANVAS_EDGE_true
  test_shouldTile_boundary_value_at_threshold
})

describe("clampPngCompression", () => {
  test_clamp_valid_6
  test_clamp_string_6
  test_clamp_negative_returns_0
  test_clamp_above_9_returns_9
  test_clamp_NaN_returns_6
  test_clamp_undefined_returns_6
})

describe("normalizeSelectedIds", () => {
  test_normalize_valid_ids
  test_normalize_filters_NaN
  test_normalize_non_array_returns_empty
  test_normalize_string_ids_converted
})

// === adler32.test.js ===
describe("adler32Update", () => {
  test_adler32_initial_state_1_0
  test_adler32_known_input_abc
  test_adler32_large_input_nmax_boundary
  test_adler32_incremental_equals_single_pass
})

// === sanitize.test.js ===
describe("sanitizeWorkflow", () => {
  test_sanitize_keeps_allowed_keys
  test_sanitize_strips_unknown_keys
  test_sanitize_missing_nodes_returns_null
  test_sanitize_missing_links_returns_null
  test_sanitize_non_object_returns_null
  test_sanitize_null_returns_null
})
```

### Tier 2: DOM Mock テスト

```javascript
// === dom-utils.test.js (jsdom) ===
test_getNodeIdFromElement_with_data_node_id_attribute
test_getNodeIdFromElement_with_data_nodeid_attribute
test_getNodeIdFromElement_nested_element_finds_ancestor
test_getNodeIdFromElement_no_node_ancestor_returns_null
test_getNodeIdFromElement_non_numeric_id_returns_null
test_isElementInGraphNode_true_for_comfy_node
test_isElementInGraphNode_true_for_litegraph_node
test_isElementInGraphNode_false_for_detached
test_resolveNodeIdForGraphRect_finds_containing_node
test_resolveNodeIdForGraphRect_no_match_returns_null
test_canvasPointToGraph_with_offset_and_scale
test_canvasPointToGraph_no_ds_returns_identity

// === storage.test.js (localStorage mock) ===
test_loadLastUsed_returns_parsed_object
test_loadLastUsed_corrupt_json_returns_null
test_loadLastUsed_missing_key_returns_null
test_saveLastUsed_stores_json
test_clearLastUsed_removes_key

// === graph-config.test.js (mock objects) ===
test_configureGraph_calls_configure_with_keep_old
test_configureGraph_configure_throws_tries_deserialize
test_configureGraph_all_methods_fail_throws_with_details
test_configureGraph_json_string_is_parsed
test_configureGraph_uses_structuredClone_for_object
test_copyNodeMedia_copies_known_media_keys
test_copyNodeMedia_skips_video_html_elements
test_copyNodeMedia_null_source_returns_false
test_syncLiveNodeMedia_copies_by_node_id
test_syncLiveNodeText_syncs_widget_values_array
test_syncLiveNodeText_syncs_widget_values_object
```

---

## 6. 構成案

### 6A. 最小構成（Tier 1 のみ、約 50 テスト）

```
vitest.config.js
tests/
  unit/
    bbox.test.js             (16 tests)
    utils.test.js            (10 tests)
    png-embed.test.js        (12 tests)
    color-parse.test.js      (10 tests)
    export-control.test.js   (12 tests)
    sanitize.test.js         (5 tests)
  helpers/
    minimal-png.js           ← 最小有効 PNG を生成するヘルパー
test_init.py                 ← pytest 1 テスト
```

**要件**: `vitest`, `@vitest/coverage-v8`。jsdom 不要。CI で 3 秒以内。

**vitest.config.js**:
```javascript
export default {
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
  },
};
```

**この構成だけで守れるもの**:
- BBox 計算の全エッジケース
- PNG workflow 埋め込みの互換性
- CRC32 / バイナリ操作の正確性
- 色解析の全入力パターン
- タイル判定・圧縮レベルの境界値
- Workflow JSON サニタイズ

### 6B. 中規模構成（Tier 1 + Tier 2、約 87 テスト）

```
vitest.config.js
tests/
  unit/                      ← environment: "node"
    bbox.test.js
    utils.test.js
    png-embed.test.js
    color-parse.test.js
    export-control.test.js
    adler32.test.js
    sanitize.test.js
  dom/                       ← environment: "jsdom"
    dom-utils.test.js
    storage.test.js
    background.test.js
    graph-config.test.js
    capture-options.test.js
  helpers/
    minimal-png.js
    mock-graph.js            ← LGraph/LGraphCanvas のスタブ
    mock-dom-node.js         ← data-node-id 付き DOM 要素のファクトリ
test_init.py
```

**vitest.config.js**:
```javascript
export default {
  test: {
    include: ["tests/**/*.test.js"],
    environmentMatchGlobs: [
      ["tests/dom/**", "jsdom"],
      ["tests/unit/**", "node"],
    ],
  },
};
```

**追加要件**: `jsdom`。CI で 8 秒以内。

**追加で守れるもの**:
- DOM 上のノード ID 検出
- 座標変換（HiDPI 問題の回帰防止）
- localStorage 永続化
- Graph configure フォールバックチェーン
- メディア同期ロジック

---

## 7. Codex 向け実装指示書（草案）

```markdown
# テスト実装タスク

## 前提
- このリポジトリは ComfyUI custom node で、ロジックの 99% が JavaScript。
- テストフレームワークは Vitest を使用。
- `web/js/` 配下の ES Module をテストする。
  一部ファイルは `import { app } from "/scripts/app.js"` のように
  ComfyUI 固有のパスを import しているため、テスト時は
  vitest.config.js の `resolve.alias` でスタブに差し替える。

## Step 1: プロジェクト初期化
1. `package.json` を作成（`vitest`, `@vitest/coverage-v8` を devDependencies に追加）
2. `vitest.config.js` を作成
   - `resolve.alias`: `"/scripts/app.js"` → `"./tests/stubs/app.js"`
   - environment: unit は `"node"`, dom は `"jsdom"`
3. `tests/stubs/app.js` を作成:
   ```javascript
   export const app = { graph: null, canvas: null };
   ```

## Step 2: ヘルパー作成
1. `tests/helpers/minimal-png.js`:
   - 1x1 白ピクセルの最小有効 PNG を Uint8Array で返す関数
   - Node.js の Blob（`import { Blob } from "node:buffer"`）でラップ
2. `tests/helpers/mock-graph.js`:
   - `_nodes`, `_groups` 配列を持つ mock graph ファクトリ
   - `configure()`, `deserialize()`, `load()` を任意で注入可能

## Step 3: Tier 1 テスト実装
以下のファイルを順に実装。各テストケースの仕様は上記テストケース一覧に従う。

1. `tests/unit/bbox.test.js`
   - `web/js/export/bbox.js` から `computeGraphBBox` を直接 import
   - normalizeSize, normalizePos は export されていないため、
     computeGraphBBox 経由で間接テストする
2. `tests/unit/utils.test.js`
3. `tests/unit/png-embed.test.js`
   - `embedWorkflowInPngBlob` は async。`Blob` は `node:buffer` から import。
   - 結果の Blob を `arrayBuffer()` → Uint8Array に変換して chunk 構造を検証
4. `tests/unit/color-parse.test.js`
   - parseHexColor, parseRgbColor は export されていない。
     → 選択肢 A: テスト用に export を追加（小さな変更）
     → 選択肢 B: `export/index.js` 全体を import し間接テスト
     推奨: 選択肢 A（テスト容易性のため）
5. `tests/unit/export-control.test.js`
   - 同上。shouldTile 等も現状 unexported。テスト用 export 追加推奨。
6. `tests/unit/sanitize.test.js`
   - `embed.js` の `sanitizeWorkflow` も unexported → export 追加

## Step 4: Tier 2 テスト実装（余裕があれば）
1. `tests/dom/dom-utils.test.js` — jsdom 環境
2. `tests/dom/storage.test.js` — localStorage mock
3. `tests/dom/graph-config.test.js` — mock graph オブジェクト

## 重要な注意事項
- `index.js` 内の多くの関数は現状 unexported。
  テスト可能にするには `export` を追加する最小限のリファクタが必要。
  影響範囲: 関数シグネチャは変えない、export 追加のみ。
- PNG embed テストでは、生成した PNG を読み戻して
  tEXt chunk の keyword が "workflow" であること、
  値が元の JSON 文字列と一致することを検証する。
  画像のピクセル内容は検証しない（golden image 不使用）。
- crc32 テストでは、既知のテストベクトル（RFC 3720 等）と比較する。
```

---

## 8. Golden Image 比較に関する見解

**結論: この repo では golden image 比較は推奨しない。**

理由:

1. **レンダリング環境依存が大きすぎる**: 出力は LiteGraph の `drawNode`, `drawNodeShape`, `drawConnections` 等のメソッドに完全に依存しており、LiteGraph のバージョン、ComfyUI のテーマ、OS のフォントレンダリング、devicePixelRatio で結果が変わる。
2. **DOM overlay が非決定的**: テキストエリアの内容やビデオサムネイルは実行時の状態に依存する。
3. **ComfyUI 自体の更新頻度が高い**: CSS 変数名の変更、ノード描画ロジックの変更が頻繁で、golden image が即座に陳腐化する。
4. **メンテナンスコスト**: 正当な変更（例: padding アルゴリズム改善）のたびに全 golden image を再生成する必要があり、CI の信頼性が低下する。

**代替アプローチ**:
- BBox の数値アサーション（構造テスト）
- PNG chunk 構造の検証（tEXt chunk 存在、CRC 有効性）
- Canvas の `width` / `height` が期待値であることの検証
- `isCanvasTransparent` のような boolean 判定のテスト

これらの構造的テストは、golden image よりも安定し、問題の根本原因を直接特定できる。
