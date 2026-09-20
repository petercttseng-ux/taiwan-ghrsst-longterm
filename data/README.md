# data/

`land_mask.png` — 0.01° 陸地遮罩（1200 × 1400，涵蓋 116–128 °E、18–32 °N），供繪圖疊加使用。

`analysis.json` — **不隨儲存庫散布**。由儀表板的「開始建置 → 匯出資料檔」產生，
或在有網路的機器上執行：

```bash
python3 tools/fetch_ghrsst.py --src oisst --from 1982 --to 2026 --out raw/
python3 tools/build_ghrsst.py --raw raw/ --base 1991 2020 --out data/
```

把產生的 `analysis.json` 放進本目錄後，儀表板開啟時會直接載入而略過建置步驟。

### 目前隨附的 `analysis.json`（2026-09-21）

現行版本為 **NOAA Coral Reef Watch CoralTemp v3.1**（每日 5 km，1985/01–2026/09 共 15,231 日），
自 NOAA OceanWatch 的 ERDDAP（`CRW_sst_v3_1`）以每 5 格取樣為 0.25° 後，執行：

```bash
python3 tools/build_ghrsst.py --raw raw_crw/ --src crw --base 1991 2020 --out data/
```

氣候基期為 WMO 標準期 1991–2020，41 年記錄足以支持趨勢與海洋熱浪統計。
（2026-09-20 以前的版本是由水試所每日衛星海溫圖數位化、基期僅 6 年的暫代資料，已停用。）
