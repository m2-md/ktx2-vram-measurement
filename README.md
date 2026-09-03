# Doku Belleği Ölçümü — Byte-per-pixel, KTX2 Transcode Hedefi ve Sürücü Blok Doğrulaması

"Kargo Kutusu Küçüldü, Raf Küçülmedi: Tek Bir 4K Doku ~90 MB VRAM ve KTX2'nin Asıl
Kazancı" makalesinin çalışan kodu. Bir dokunun **rafta** (VRAM'de) kapladığı yeri bir
formüle döker, formülü vitest ile deterministik olarak kanıtlar ve tarayıcıda **sürücünün
kendisine** doğrulatır: `compressedTexImage2D` yanlış boyutlu tamponu `INVALID_VALUE` ile
reddeder.

Kargo = dosyanın diskte/ağda kapladığı yer (PNG, WebP). Raf = dokunun GPU belleğinde
kapladığı yer. İki sütun aynı yöne hareket etmez; demo bunu yan yana gösterir.

Three.js 3D serisinin asset-pipeline kolundaki proje. Kardeş proje
`threejs-dispose-vram-audit` ile aynı `RendererInfoLike` sözleşmesini paylaşır (sahte
renderer ile GPU'suz test) ama derdi farklıdır: orada sızıntı, burada format ve bütçe.

Sürüm: `three@0.185.1` (r185), klasik `WebGLRenderer`. WebGPU'ya girmez.

## ⚠️ KTX2 dosyası bu projede ENCODE EDİLMEZ

KTX2/Basis encode etmek `toktx` (KTX-Software) ya da `basisu` gibi **global bir CLI**
ister; npm'den gelen saf-JS bir encoder yok. Bu depo global araç kurmuyor ve varlık
indirmiyor. Dolayısıyla:

- Tablolarda KTX2 dosya-boyutu hücresi **`— (encode edilmedi)`** olarak kalır. Oraya sayı
  uydurulmaz.
- Bunun yerine GERÇEKTEN ölçülen dört şey: **formül**, **transcode hedefi**, **sürücü blok
  doğrulaması**, **PNG/WebP dosya boyutu**.
- `KTX2Loader.detectSupport(renderer)` bir dosya indirmez, transcoder'ı bile başlatmaz —
  yalnızca GPU'ya hangi sıkıştırılmış doku uzantılarının açık olduğunu sorar. Demo bu
  raporu basar.

## Ne içerir

- **`src/texture-memory.ts`** — rafın formülü. 20 girişli `FORMATS` tablosu (blok
  genişliği/yüksekliği/baytı), `bytesPerPixel`, `levelBytes` (`Math.ceil` ile blok
  hizalaması), `mipLevelCount` (`32 - Math.clz32(size)` — `Math.log2` DEĞİL),
  `estimateTextureMemory` (mip zinciri + `layers`). Hiçbir şey import etmez; herkes ondan
  alır.
- **`src/three-format.ts`** — `THREE.Texture` → format/seviye/katman/boyut köprüsü.
  Sıkıştırılmış format haritası, mip filtresi kümesi, `isDepthTexture`/`isCompressedTexture`/
  `isCubeTexture` dalları.
- **`src/texture-budget.ts`** — sahne grafiğini gezip formülle toplayan `TextureBudget`.
  `Map` anahtarı doku **nesnesinin kendisi** → paylaşılan atlas bir kez sayılır.
  `addMaterial` sabit slot listesi yerine `Object.entries` ile materyalin BÜTÜN doku
  alanlarını tarar. `crossCheck` eşitlik iddia etmez, `{ counted, gpu, delta }` döndürür.
- **`src/transcode-target.ts`** — `detectFormatSupport` (ham WebGL uzantıları) +
  `pickTranscodeTarget`: three'nin `KTX2Loader.js` içindeki `FORMAT_OPTIONS` öncelik
  tablosunun ETC1S/UASTC alt kümesinin taşınabilir portu (PVRTC ve UASTC_HDR satırları
  bilerek dışarıda). ETC1S'in ASTC önceliği `Infinity` — ETC1S ASTC destekleyen
  cihazda bile ASTC'ye gitmez. ETC1 satırı TEK elemanlıdır (alfa kanalı yok) ve
  `engineFormat.length < 2` koruması alfalı dokuyu o satıra düşürmez.
- **`src/block-probe.ts`** — `probeBlockSize`: İKİ YÖNLÜ deney. Doğru boyut kabul ediliyor
  mu (`NO_ERROR`), bir bayt eksiği reddediliyor mu (`INVALID_VALUE`)? Bir hipotezi yalnızca
  doğrulamaya çalışırsanız kendinizi kandırırsınız.
- **`src/file-size.ts`** — `encodedSizes`: `canvas.toBlob` ile PNG/WebP gerçek baytı.
  `blob.type === mime` kontrolü var: tarayıcı WebP üretemezse sessizce PNG döner.
- **`src/procedural-texture.ts`** — `makeRng` (mulberry32) + `drawPattern`. Desen
  PROSEDÜREL; hiçbir varlık indirilmez. Gürültü parametresi entropiyi (→ PNG baytını)
  değiştirir, boyutu (→ VRAM'i) değiştirmez.
- **`src/budget-plan.ts`** — `howManyFit`, `MOBILE_TEXTURE_BUDGET_BYTES = 268_435_456`,
  `comparisonRows`.
- **`src/ktx2.ts`** — `createKTX2Loader` + `readWorkerConfig`. Transcoder yolu
  `/basis/`'tir; dosyalar `npm run prepare-basis` ile node_modules'tan kopyalanır.
- **`src/main.ts` + `src/view/stage.ts` + `index.html`** — tarayıcı demosu (dark cinematic
  + neon). Ölçüm renderer'ı = sunum renderer'ı; tek context, tek sahne.

## Kurulum

```bash
npm install
```

`npm run dev` ve `npm run build` öncesinde `prepare-basis` otomatik koşar
(`predev`/`prebuild`); elle çalıştırmak isterseniz:

```bash
npm run prepare-basis   # node_modules/three/.../libs/basis → public/basis/ (İNDİRME YOK)
```

## Test

```bash
npm test
```

47 test — hepsi deterministik, **WebGL/GPU GEREKTİRMEZ** (Node'da koşar). `THREE.DataTexture`,
`MeshStandardMaterial`, `Scene`, `WebGLRenderTarget`, `CompressedTexture`, `CubeTexture`
WebGL context olmadan kurulur.

Beklenen çıktı:

```
 ✓ test/budget-plan.test.ts       (6 tests)
 ✓ test/texture-memory.test.ts   (12 tests)
 ✓ test/transcode-target.test.ts (12 tests)
 ✓ test/three-format.test.ts     (11 tests)
 ✓ test/texture-budget.test.ts    (6 tests)

 Test Files  5 passed (5)
      Tests  47 passed (47)
```

### Testlerin çivilediği deterministik sayılar

Kod hep bayt, tablolar hep MiB. Hepsi `estimateTextureMemory`'nin çıktısı — hiçbiri
"yaklaşık" değil:

| Doku | Format | Taban (B) | + mip zinciri (B) | MiB |
|---|---|---|---|---|
| 4096² | RGBA16F | 134.217.728 | 178.956.968 | 170,67 |
| 4096² | RGBA8 | 67.108.864 | **89.478.484** | 85,33 |
| 4096² | BC7 / ASTC 4×4 | 16.777.216 | 22.369.648 | 21,33 |
| 4096² | BC1 / ETC1 | 8.388.608 | 11.184.824 | 10,67 |
| 2048² | RGBA8 | 16.777.216 | 22.369.620 | 21,33 |
| 2048² | BC7 | 4.194.304 | 5.592.432 | 5,33 |
| 2048² | BC1 | 2.097.152 | 2.796.216 | 2,67 |
| 1000² (NPOT) | RGBA8 | 4.000.000 | 5.332.856 | 5,09 |

- **`×4/3` bir sezgi, bütçe değil.** 4096² RGBA8'de gerçek 89.478.484 B, `4/3 × 67.108.864`
  ise 89.478.485,33 → **1,33 bayt** fark. NPOT'ta sapma büyür (5.332.856 vs 5.333.333,33);
  sıkıştırılmış formatlarda blok dolgusu yüzünden ters yöne döner.
- **4096² BC7 (22.369.648) − 2048² RGBA8 (22.369.620) = 28 bayt.** Çözünürlüğü yarıya
  indirmek, tam çözünürlükte BC7'ye geçmekle rafta neredeyse birebir aynı yeri kazandırıyor.
- **256 MiB'lık (268.435.456 B) mobil bütçe:** mip'li 4K doku olarak **3** RGBA8, **11**
  BC7, **23** BC1 sığar. Üç RGBA8 tam 268.435.452 B eder — geriye **4 bayt** kalır. BC7'de
  on ikinci doku bütçeyi **320 baytla** aşar (kuyruk mip'lerindeki blok dolgusu).
- **Alfa kanalı rafı ikiye katlar:** 4K BC1 10,67 MiB → BC3 21,33 MiB (tam olarak ×2).
- Blok hizalaması: `levelBytes(5, 5, "BC1")` = **32** (2×2 blok), 12,5 değil.
  `levelBytes(1, 1, "BC7")` = **16** — 4×4 bir mip ile tam olarak aynı.

## Demo (tarayıcı)

```bash
npm run dev
```

`http://localhost:5173/` → sinematik sahne + cam kontrol paneli.

> Demo bir dev sunucusu ister. `index.html`'i `file://` ile açmak **boş ekran** verir
> (Vite bare module specifier'ları çözer). Her zaman `npm run dev` kullanın.

### Düğmeler

| Düğme / kontrol | Ne yapar |
|---|---|
| **1024 üret** / **2048 üret** | Prosedürel deseni bir `<canvas>`'a çizer, `CanvasTexture` olarak GPU'ya yükler (mip zinciri VAR). |
| **Gürültü (entropi)** kaydırıcısı | 0 → düz gradyan (PNG küçük) · 100 → piksel başına sapma (PNG megabaytlara tırmanır). **VRAM sütununu etkilemez.** |
| **Bütçeyi ölç** | `TextureBudget` sahneyi gezer, tabloyu ve `crossCheck` sonucunu basar. |
| **Dosya boyutunu ölç (PNG/WebP)** | `canvas.toBlob` ile gerçek baytlar. Geçmiş tabloya birikir: gürültüyü değiştirip yeniden üretin, PNG oynar / VRAM sabit kalır. |
| **Blok boyutunu doğrula (GPU)** | Desteklenen her format için 256×256 (tam blok) ve 250×250 (kısmi blok, `ceil` gerekir) probu. Her satır `exactAccepted ✓` ve `shortRejected ✓` göstermeli. |
| **Boşalt (dispose)** | Dokuları materyalden koparıp `dispose()` eder; `renderer.info.memory.textures` **baseline'a dönmeli**. |
| **Döndür** onay kutusu | Varsayılan **KAPALI**. Kapalıyken animasyon döngüsü yoktur, render on-demand. |

### Demo bilerek HAFİF

Bütçe ölçen bir aracın kendi kendine sızdırması ironik olurdu — ve makineyi kasması daha da
kötü. O yüzden:

- Aynı anda **en fazla 2** canlı büyük doku. Üçüncü üretilirse en eskisi otomatik dispose
  edilir (önce `material.map = null`, SONRA `texture.dispose()` — ters sırada three bir
  sonraki render'da canvas'tan yeniden yükler ve sayaç geri tırmanır).
- Prosedürel üretim üst sınırı **2048**. **4096 asla üretilmez**; 4K satırları yalnızca
  HESAPLANIR ve tabloda `hesaplandı` etiketiyle gösterilir.
- **Otomatik süpürme yok, otomatik ölçüm yok.** Her ölçüm düğmeyle tetiklenir.
- Sahne en fazla 3 mesh, **gölge yok**, **post-process yok**, `pixelRatio ≤ 1.5`.

### Ölçüm koşulu (yoksa kendinizi kandırırsınız)

`renderer.info.memory.textures` yalnızca GPU'ya **yüklenmiş** dokuları sayar. Bir doku,
onu kullanan mesh ilk kez çizilene kadar sayaca girmez. Bu yüzden demo her eylemden sonra
tek bir `renderer.render()` çağırır ve `crossCheck`'i **render'dan sonra** yapar. Ayrıca
`delta`'nın sıfır olması **beklenmez**: renderer bizim gezmediğimiz şeyleri de sayar
(gölge haritaları, PMREM ara hedefleri, varsayılan 1×1 beyaz doku). `delta`'nın işi
eşitlik ispatı değil, alarm.

Blok probu ham `gl.compressedTexImage2D` çağırdığı için three'nin state cache'ini şaşırtır;
demo probun ardından `renderer.resetState()` çağırır.

## Build

```bash
npm run build   # prepare-basis && tsc && vite build → dist/
```

## Makale ↔ kod paritesi

Makaledeki 15 TypeScript bloğunun tamamı bu dosyalarda birebir bulunur. `TARGETS` tablosu
sütun hizasını koruduğu için `// prettier-ignore` ile işaretlidir; `.prettierrc`
(`printWidth: 120`) makaledeki tek satırlık `FORMATS` girişlerinin bölünmemesini sağlar.
`(ilgili kısım)` / `(özet)` etiketli bloklar yalnızca `import` satırlarını eler.

## Lisans

MIT — bkz. `LICENSE`.
