# 臺灣周邊海域 GHRSST 長期海溫時空動態分析

**Taiwan Seas Long-term SST Dynamics — GHRSST / NOAA OISST**

以每日衛星海面水溫分析場，對臺灣周邊海域（116–128 °E、18–32 °N，0.25° 網格）進行
44 年尺度的時空動態統計：氣候基期、距平、逐格升溫速率、海洋熱浪與 Hovmöller 剖面。

🔗 **[開啟儀表板 / Open the dashboard](https://petercttseng-ux.github.io/taiwan-ghrsst-longterm/)**

> 姊妹專案：[臺灣周邊海域衛星遙測海面水溫時空分布儀表板](https://petercttseng-ux.github.io/taiwan-sst-dashboard/)
> （由水試所每日發布之 SST 圖檔反演，2018 迄今、逐日）。本專案則直接取用原始數值產品，
> 時間長、可做氣候尺度統計；兩者在重疊期間可互為驗證。

---

## 這個儲存庫有什麼不一樣

**它不隨附海溫資料。** 儀表板本身內建擷取引擎：開啟頁面後按「開始建置」，
瀏覽器會直接向 **ERDDAP griddap** 介面請求本範圍的 NetCDF 次集，
在瀏覽器內完成全部統計運算，並快取於 IndexedDB。第一次約 10–25 分鐘，之後開啟只需數秒。

這樣設計有三個理由：

1. **取到的是物理量，不是顏色。** 從網頁圖磚（例如 OceanDataLab OVL 的圖層）反推溫度，
   會引入色階量化誤差（約 ±0.15 °C）、調色盤改版風險與等值線／地名疊加物污染，
   而且需要對第三方檢視器做長年份大量爬取。ERDDAP／OPeNDAP 是資料提供者為程式存取所設計的介面。
2. **儲存庫不散布第三方資料集**，也就沒有再散布授權的問題。
3. **可重現**：任何人在任何時間重新建置，都會取到當下最新版本的官方資料。

若您的網路無法連到 ERDDAP（機關防火牆常見），改走 Python 路徑即可，見下方〈離線建置〉。

## 資料來源 Data

| 產品 | 解析度 | 期間 | 路徑 | 用途 |
|---|---|---|---|---|
| **NOAA Coral Reef Watch CoralTemp v3.1**（`dhw_5km` @ PacIOOS） | 5 km，每日 | 1985-04 迄今 | 瀏覽器／Python | **主要長期記錄** |
| **NOAA OISST v2.1**（`ncdc_oisst_v2_avhrr…` @ NCEI） | 0.25°，每日 | 約 2020 迄今（滾動視窗） | 瀏覽器 | 交叉檢核 |
| **NOAA OISST v2.1**（`ncdcOisst21Agg` @ CoastWatch） | 0.25°，每日 | 1981-09 迄今 | 僅 Python | 全記錄 |
| **GHRSST MUR L4**（`jplMURSST41` @ CoastWatch） | 0.01°，每日 | 2002-06 迄今 | 僅 Python | OVL 圖層之底層產品 |

### 為什麼瀏覽器端用的不是 MUR

OceanDataLab OVL 上的 `GIBS_GHRSST_L4_MUR_Sea_Surface_Temperature` 圖層，底層就是 JPL 的 GHRSST MUR L4。
該產品在 ERDDAP 上由 NOAA CoastWatch 提供，但**經實測，CoastWatch、upwell、PIFSC、PolarWatch、OSMC
等 NOAA 節點皆未送出 `Access-Control-Allow-Origin` 標頭**，瀏覽器因同源政策無法讀取其回應
（`no-cors` 請求可通、`cors` 請求失敗，證實是標頭而非網路阻擋）。

因此本專案採雙軌設計：

* **瀏覽器路徑**用有送 CORS 的節點 —— PacIOOS 的 CoralTemp（5 km、1985 年起，公開節點中唯一同時具備
  長記錄與 CORS 者）與 NCEI 的 OISST。
* **伺服器路徑**（`tools/fetch_ghrsst.py`）不受同源政策限制，可直接取用 MUR L4 與 OISST 全記錄。

兩條路徑輸出格式與演算法完全相同，結果可互相驗證。

## 分析內容 Features

- **總覽** — 全域升溫速率、最暖年、熱浪日數年代變化、各海域趨勢排序
- **空間分布** — 1982 迄今逐月海溫／距平場動畫，點選格點看完整時間序列
- **長期趨勢** — 逐格 Theil–Sen 升溫速率、Mann–Kendall p 值、季節振幅、最暖日相位、年際標準差、熱浪日數及其年代變化
- **時間序列** — 11 個海域分區的逐日、距平與年內變化（含近三年疊圖）
- **Hovmöller** — 時緯／時經剖面，月平均或候（5 日）平均，海溫或距平
- **年月矩陣** — 年 × 月距平熱圖
- **海洋熱浪** — Hobday 判準之事件偵測、強度分級與事件清單
- **方法與限制** — 完整演算法定義與已知限制

分區：臺灣周邊全域、臺灣海峽南／北部、澎湖、東北部、東部（黑潮）、西南部（高屏）、
巴士海峽、南海北部（東沙）、東海南部、西北太平洋。

## 方法 Methods

| 項目 | 定義 |
|---|---|
| 氣候基期 | 1991–2020（WMO 標準 30 年，可調整） |
| 日序氣候值／門檻 | ±5 日視窗（共 11 日）× 基期各年，再沿日序 31 日環狀移動平均（Hobday et al. 2016） |
| 海洋熱浪 | 連續 ≥5 日超過日序 90 百分位；間隔 ≤2 日合併；分級依 Hobday et al. (2018) |
| 趨勢 | 年平均（有效日數 >300）之 Theil–Sen 中位斜率 + Mann–Kendall 檢定 |
| 區域平均 | cos(緯度) 面積加權 |
| 網格對齊 | CoralTemp 之 0.05° 格點與 0.25° 格心恰好重合，以每 5 格取樣（非區塊平均）取值 |
| 資料編碼 | `int16`，溫度 ×100，`-32768` 表無資料 |

JavaScript 與 Python 兩條路徑實作同一組定義，其核心函式已對 `numpy`／`scipy` 參考值驗證：
百分位與 `numpy.percentile` 完全一致、Theil–Sen 斜率吻合至小數第 8 位、
海洋熱浪事件起訖與強度完全相同、氣候場最大差異 2.3 × 10⁻⁶ °C（float32 捨入）。

## 離線建置 Offline route

在有網路的機器上：

```bash
pip install numpy scipy
python3 tools/fetch_ghrsst.py --src crw   --from 1985 --to 2026 --out raw/   # CoralTemp 5 km
python3 tools/fetch_ghrsst.py --src oisst --from 1982 --to 2026 --out raw/   # OISST 全記錄
python3 tools/fetch_ghrsst.py --src mur   --from 2002 --to 2026 --out raw/   # GHRSST MUR L4
python3 tools/build_ghrsst.py --raw raw/ --src crw --base 1991 2020 --out data/
```

產出的 `data/analysis.json` 放回本目錄，儀表板即會直接載入而略過建置步驟
（瀏覽器版的「匯出資料檔」按鈕也會產生同一個檔案）。

## 檔案結構 Structure

```
index.html              儀表板主頁
css/style.css           樣式
js/netcdf.js            最小 NetCDF-3 讀取器（解析 ERDDAP 的 .nc 回應）
js/harvest.js           ERDDAP griddap 擷取、IndexedDB 快取、續傳
js/analysis.js          氣候基期、熱浪、Theil–Sen／Mann–Kendall、Hovmöller
js/app.js               介面與繪圖（原生 canvas，無外部相依）
data/land_mask.png      0.01° 陸地遮罩
tools/fetch_ghrsst.py   Python 版擷取
tools/build_ghrsst.py   Python 版統計與資料檔產製
```

前端無任何外部相依，不載入第三方指令碼或字型。

## 已知限制 Limitations

- CoralTemp、OISST 與 MUR 皆為 **L4 分析場**（內插／融合產品），非直接觀測；雲量高的期間倚賴背景場與現場資料。
- 取樣至 0.25°（約 25 km），**無法解析**臺灣海峽內的中小尺度鋒面、上升流與潮汐混合帶；CoralTemp 原生為 5 km，如需該尺度可改以全解析度擷取。
- CoralTemp 以**取樣**而非區塊平均降至 0.25°，在梯度劇烈的近岸與鋒面帶與平均值可能有數十分之一度的差異。
- CoralTemp 1985–2002 段與 2002 年後的輸入來源不同（Pathfinder／OSTIA 重分析 vs. Geo-Polar Blended），跨越該接點的趨勢應審慎解讀。
- 局部升溫速率同時包含全球暖化訊號與環流位移（如黑潮路徑變動）造成的重新分配，兩者未分離。
- 熱浪統計以**固定基期**定義，暖化本身會使近年超標日數自然增加；與採移動基期的研究不可直接比較。
- OISST 最近數週屬 preliminary 版，日後會由 final 版取代，數值可能微調。

## 引用 Citation

- NOAA Coral Reef Watch (2018, updated daily). NOAA Coral Reef Watch Daily Global 5km Satellite Sea Surface Temperature (CoralTemp v3.1). College Park, Maryland, USA: NOAA Coral Reef Watch.
- Huang, B. et al. (2021). Improvements of the Daily Optimum Interpolation Sea Surface Temperature (DOISST) Version 2.1. *J. Climate*, 34, 2923–2939. doi:10.1175/JCLI-D-20-0166.1
- JPL MUR MEaSUREs Project (2015). GHRSST Level 4 MUR Global Foundation SST Analysis. PO.DAAC. doi:10.5067/GHGMR-4FJ04
- Hobday, A. J. et al. (2016). A hierarchical approach to defining marine heatwaves. *Prog. Oceanogr.*, 141, 227–238.
- Hobday, A. J. et al. (2018). Categorizing and naming marine heatwaves. *Oceanography*, 31(2), 162–173.

## 授權 License

程式碼 [MIT](LICENSE)。本儲存庫未散布任何第三方資料集；
使用者自行擷取之 NOAA／JPL 資料依其各自之使用條款。
