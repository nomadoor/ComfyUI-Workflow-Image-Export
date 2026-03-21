## 0006: Offscreen Graph Configure — 安定版 frontend 対応

### 状況

- ComfyUI_frontend v1.41.x 系（例: v1.41.21）で `exportWorkflowPng` を実行すると、`Error: Offscreen render: graph.configure not available.` が発生しエクスポートが失敗していた。
- 最新版 frontend（v1.43.2 以降）では同じコードで正常に動作していた。
- `configureGraph()` 内で `tryLoad(graph.configure)` が `false` を返し（= 例外を throw）、その後 `graph.load(jsonObject)` が旧 XHR 実装のため 404 を引き起こし、最終的に例外として露出していた。

### 根本原因

`render_graph_offscreen.js` の `configureGraph()` は `new LGraphRef()` で生成した fresh な offscreen graph に対して `graph.configure(data)` を呼ぶ。

v1.41.x / v1.43.x の `LGraph.configure` 実装:

```javascript
configure(e, t) {
  let n = useLayoutMutations(),
      r = {data: e, clearGraph: !t};
  if (this.events.dispatch('configuring', r))
    try {
      r.clearGraph && this.clear(),  // ← clearGraph=true のとき呼ばれる
      this._configureBase(e);
    }
}
```

第2引数 `t` が `undefined` のとき `clearGraph = !undefined = true` となり、`this.clear()` が呼ばれる。`LGraph.clear()` の内部:

```javascript
clear() {
  this.stop();
  let e = this.id;
  if (this.isRootGraph && e !== '00000000-0000-0000-0000-000000000000'
      && (R().clearGraph(e), we().clearGraph(e))) ...
}
```

`R()` / `we()` は Pinia ストアのアクセサで、Vue コンポーネントライフサイクル外から呼ばれると例外を throw する場合がある。fresh graph はコンストラクタ内の `clear()` で `this.id = pe`（null UUID）にリセットされているため、通常この分岐には入らないが、特定バージョン・環境下では副作用が発生し configure が throw していた。

なお `CustomEventTarget.dispatch()` は `super.dispatchEvent(cancelable event)` を返すため、リスナー不在でも `false` にはならない（当初の "events gate" 仮説は誤り）。

### 決定

`configureGraph()` の `graph.configure` 呼び出しを以下のように変更する：

1. **`graph.configure(clonedData, true)` — 第2引数 `true` を追加**
   `clearGraph = !true = false` となり、fresh graph に対する不要な `this.clear()` 再呼び出しをスキップする。fresh graph はコンストラクタですでにクリア済みなので副作用なし。

2. **`structuredClone(data)` でデータをクローン**
   `configure` がデータオブジェクトを変異させた場合の影響を遮断する。

3. **`graph.load` を文字列 URL のみに制限**
   旧 LiteGraph の `graph.load()` は XHR ベースであり、JSON オブジェクトを渡すと 404 を引き起こす。`typeof workflowJson === "string"` のときのみ呼ぶようにガードする。

4. **`_configureBase` フォールバックを削除**
   `configure` をバイパスして `_configureBase` を直接呼ぶと、ComfyUI の configure 後処理（ノードサイズ計算・widget 登録等）が走らず、出力画像が崩れる。

5. **エラー時に実際の例外内容を含むメッセージを出力**
   デバッグのため、失敗した各ステップの例外を収集して `Offscreen render: graph.configure failed. <detail>` として throw する。

### 影響

- ComfyUI_frontend v1.41.x 安定版でのエクスポートエラーが解消される。
- 最新版 frontend（v1.43.2+）の動作は変わらない（`clearGraph=false` でも fresh graph では等価）。
- 次に失敗した場合、コンソールエラーに具体的な例外メッセージが含まれるため原因追跡が容易になる。

### 補足

- 修正対象: `web/js/export/render_graph_offscreen.js` の `configureGraph()` 関数のみ。
- ソース確認バンドル: `web_custom_versions/Comfy-Org_ComfyUI_frontend/1.41.13/assets/api-BdWPyz-_.js` および `1.43.2/assets/api-CEMlaPAm.js`。
