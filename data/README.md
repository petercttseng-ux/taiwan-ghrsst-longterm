# data/

`land_mask.png` — 0.01° 陸地遮罩（1200 × 1400，涵蓋 116–128 °E、18–32 °N），供繪圖疊加使用。

`analysis.json` — **不隨儲存庫散布**。由儀表板的「開始建置 → 匯出資料檔」產生，
或在有網路的機器上執行：

```bash
python3 tools/fetch_ghrsst.py --src oisst --from 1982 --to 2026 --out raw/
python3 tools/build_ghrsst.py --raw raw/ --base 1991 2020 --out data/
```

把產生的 `analysis.json` 放進本目錄後，儀表板開啟時會直接載入而略過建置步驟。
