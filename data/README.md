# data/

`land_mask.png` — 0.01° 陸地遮罩（1200 × 1400，涵蓋 116–128 °E、18–32 °N），供繪圖疊加使用。

`analysis.json` — **不隨儲存庫散布**。由儀表板的「開始建置 → 匯出資料檔」產生，
或在有網路的機器上執行：

```bash
python3 tools/fetch_ghrsst.py --src oisst --from 1982 --to 2026 --out raw/
python3 tools/build_ghrsst.py --raw raw/ --base 1991 2020 --out data/
```

把產生的 `analysis.json` 放進本目錄後，儀表板開啟時會直接載入而略過建置步驟。

### 目前隨附的 `analysis.json`（2026-09-20）

由於產製環境無法連到 ERDDAP／NOAA 節點，現行版本改由**水試所每日衛星海溫圖**（2018/11–2025/06，G1SST 與 JPL MUR，
約每 5 日一幅、共 474 幅）以色階反演數位化為 0.25° 網格，時間上線性內插為逐日（缺口 ≤12 日），再以
`tools/build_ghrsst.py --src fri --base 2019 2024` 產製。記錄僅約 6.5 年、基期 6 年，**長期趨勢與熱浪統計僅供參考**；
待能連上 ERDDAP 時，按「開始建置」或重跑 Python 路徑即可換成 CoralTemp／OISST 長期記錄。
