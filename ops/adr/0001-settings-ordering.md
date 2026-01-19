## 0001: ComfyUI Settings の表示順固定

### 状況

ComfyUI Settings の拡張項目は、定義順（配列順）で表示されない場合があり、
実際の UI では逆順に積まれる / あるいはソートが入るような挙動が観測された。
結果として Basic / Advanced の並びや、Basic 内の項目順が意図と逆転する。

### 決定

1. セクション見出しの順序は "0. Basic" / "1. Advanced" の接頭辞で固定する。
2. 項目順は UI が逆に積む前提で **定義順を逆順**にする。
   - Basic: format → embed → background → solid color → padding を UI でこの順に見せるため、
     `SETTINGS_DEFINITIONS` では padding から format へ逆順に定義する。
   - Advanced も同様に逆順定義する。
3. 項目名に a/b/c の可視プレフィックスは付けない（視認性優先）。

### 影響

- `web/js/core/settings.js` の `SETTINGS_DEFINITIONS` は UI 反映順に合わせて逆順に並べる。
- Basic/Advanced 見出しは数字が表示されるが、順序の安定性を優先する。
