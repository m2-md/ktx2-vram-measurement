# Kargo Kutusu Küçüldü, Raf Küçülmedi: Tek Bir 4K Doku ~90 MB VRAM ve KTX2'nin Asıl Kazancı

*8 MB'lık PNG'yi 900 KB'lık WebP'ye çevirdiğinizde kazandığınız şey indirme süresidir; VRAM değil. GPU'ya giden doku her hâlükârda RGBA8'e açılır. Doku belleğini bir formüle döküyor, formülü sürücünün kendisine doğrulatıyor ve KTX2'nin dosya boyutunda değil rafta kazandırdığını sayılarla gösteriyoruz.*

*Tahmini okuma süresi: 19 dakika*

---

Bir sahnenin doku klasörünü 46 MB'tan 5 MB'a indirmiştim. PNG'leri WebP'ye çevirdim, kalite 85, gözle fark yok. Lighthouse skoru zıpladı, ekran görüntüsünü ekibe attım, "yüzde doksan" yazdım altına. Ertesi gün test cihazındaki sekme yine çöktü. Aynı yerde, aynı şekilde, hiç değişmeden.

Çünkü küçülttüğüm şey kargo kutusuydu. Raf aynı kalmıştı.

Bu yazının taşıyıcı mecazı bu: bir doku hayatı boyunca iki farklı yerde ölçülür. Biri **kargo**: dosyanın diskte ve ağda kapladığı yer. Diğeri **raf**: dokunun GPU belleğinde, VRAM'de kapladığı yer. PNG, JPEG, WebP, AVIF; hepsi kargo formatıdır. Kutuyu vakumlar, ucuza taşır, hedefte açar. Rafa konan şey açılmış hâlidir. 4096×4096 bir doku o rafta 64 MiB yer kaplar, mipmap'leriyle birlikte 85 MiB — dosyası 8 MB da olsa, 900 KB da olsa.

KTX2/Basis'in yaptığı iş bambaşka. O, giysiyi katlanmış hâlde rafa koyar. GPU sıkıştırılmış bloğu doğrudan okuyabildiği için doku VRAM'de açılmaz. Kazanç kargoda değil, rafta.

Bu ayrımı bilmeyen bir asset pipeline'ı, mobilde doku bütçesini üç kat aşarken "biz zaten optimize ettik" diyebilir. O yüzden yazı boyunca tek bir soruyu kovalayacağız: bir dokunun rafta kapladığı yeri nasıl ölçeriz?

Yol haritası şu. Önce dosya boyutunun neden yanıltıcı olduğunu, GPU'nun neden PNG örnekleyemediğini konuşacağız. Sonra byte-per-pixel (piksel başına bayt) formülünü yazacağız; blok hizalaması, mip zinciri ve cubemap çarpanı dâhil. `renderer.info.memory.textures`'ın neden yetmediğini görüp sahnedeki bütün dokuları gezen bir `TextureBudget` sınıfı kuracağız. KTX2Loader'ın transcode kararını three'nin kendi tablosundan çıkarıp taşınabilir bir fonksiyona çevireceğiz. Ardından formülü tarayıcıda sürücüye doğrulatacağız — evet, WebGL sürücüsü bizim bayt hesabımızı denetliyor ve yanlışsa reddediyor. Kapanışta da 256 MiB'lık bir mobil doku bütçesine kaç 4K dokunun sığdığını hesaplayacağız. Orada bazen KTX2'den daha iyi bir cevap çıkıyor.

Bir de dürüstlük notu, en baştan: bu projede KTX2 dosyası **encode edilmiyor**. Encode `toktx` ya da Basis encoder gibi global bir CLI ister, bu depo global araç kurmuyor ve asset indirmiyor. Ölçtüğümüz şey formül, transcode hedefi ve sürücünün blok doğrulaması. Encode adımını koşmadık, koştuk da demiyoruz.

Serinin ilk yazısında GPU kaynaklarını serbest bırakmayı, `dispose()` disiplinini konuşmuştuk. Orada dert sızıntıydı: rafa koyduğun şeyi indirmeyi unutmak. Burada dert format ve bütçe: rafa koyduğun şeyin ne kadar yer kapladığını hiç bilmemek. İkisi aynı rafın iki farklı sorusu, ama tedavileri ayrı.

Sürüm notu: `three@0.185.1` (r185), klasik `WebGLRenderer`, Vite + TypeScript + vitest.

### Dosya Boyutu Kargo Ölçüsüdür

GPU bir PNG'yi örnekleyemez. Apaçık bir cümle. Sonuçları ise çoğu pipeline tartışmasının atladığı yerde duruyor.

Bir fragment shader'da `texture(map, uv)` yazdığınızda, texture unit (doku birimi) o an istediği tek bir texel'e gitmek zorundadır. Rastgele erişim, sabit maliyet, kare başına milyonlarca kez. PNG'nin içindeki DEFLATE akışı ise sıralıdır: 3000. satırdaki bir pikseli okumak için ondan öncekileri çözmeniz gerekir. JPEG'in DCT blokları değişken uzunlukludur, nerede başladıklarını bilmezsiniz. WebP ve AVIF daha da karmaşık — onlar video codec'lerinden türeme, kare içi tahmine dayalı formatlar.

O yüzden yol şöyle işler: baytlar indirilir, CPU (ya da tarayıcının donanım decoder'ı) görüntüyü çözer, ortaya ham bir RGBA piksel tamponu çıkar, `texImage2D` o tamponu sürücüye verir, sürücü VRAM'e yerleştirir. Zincirin sonunda duran şey her zaman ham pikseldir. 8 MB'lık PNG de 900 KB'lık WebP de aynı 67.108.864 baytlık tampona açılır.

Kötü haberin ikinci yarısı: yükleme anında bu iki maliyet üst üste biner. Decode edilmiş CPU tamponu bellekte dururken sürücü kopyasını VRAM'e alır. Bir an için aynı doku iki yerdedir. Mobilde peak memory'nin (tepe bellek kullanımı) ölçüldüğü an tam da bu andır.

Peki blok sıkıştırma neden farklı? Çünkü BC7, ASTC ve ETC fixed-rate (sabit oranlı) çalışır ve blok yereldir. Bir BC7 dokusunda her 4×4 piksel tam olarak 16 bayttır — ne bir eksik ne bir fazla. Herhangi bir texel'in hangi bayt aralığında olduğunu çarpma-bölmeyle bulursunuz. Texture unit o 16 baytı donanımda, örnekleme anında çözer. Sıkıştırma GPU'ya kadar hayatta kalır, çünkü GPU onu okumayı biliyor.

Kısacası PNG "küçük dosya, büyük raf", BC7 ise "orta dosya, küçük raf" demektir. İki sütun aynı yöne hareket etmiyor.

### Byte-per-pixel: Rafın Formülü

Rafı ölçmek için bir tabloya ve dört satır aritmetiğe ihtiyacımız var. Tablo, formatın bir bloğunun kaç piksel kapladığını ve kaç bayt tuttuğunu söyler. Sıkıştırılmamış formatlar için "blok" tek bir pikseldir; böylece iki dünyayı tek bir veri yapısıyla anlatabiliriz.

```ts
// texture-memory.ts
export interface FormatSpec {
  label: string;
  blockWidth: number; // sıkıştırılmamış formatlarda 1
  blockHeight: number;
  blockBytes: number; // bir bloğun bayt karşılığı
  compressed: boolean;
}

export const FORMATS = {
  RGBA8: { label: "RGBA8", blockWidth: 1, blockHeight: 1, blockBytes: 4, compressed: false },
  RGB565: { label: "RGB565", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  RGBA4444: { label: "RGBA4444", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  R8: { label: "R8", blockWidth: 1, blockHeight: 1, blockBytes: 1, compressed: false },
  RG8: { label: "RG8", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  RGBA16F: { label: "RGBA16F", blockWidth: 1, blockHeight: 1, blockBytes: 8, compressed: false },
  RGBA32F: { label: "RGBA32F", blockWidth: 1, blockHeight: 1, blockBytes: 16, compressed: false },
  DEPTH16: { label: "DEPTH16", blockWidth: 1, blockHeight: 1, blockBytes: 2, compressed: false },
  DEPTH24_STENCIL8: { label: "DEPTH24_STENCIL8", blockWidth: 1, blockHeight: 1, blockBytes: 4, compressed: false },

  BC1: { label: "BC1 (DXT1)", blockWidth: 4, blockHeight: 4, blockBytes: 8, compressed: true },
  BC2: { label: "BC2 (DXT3)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  BC3: { label: "BC3 (DXT5)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  BC5: { label: "BC5", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  BC7: { label: "BC7 (BPTC)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  ETC1: { label: "ETC1", blockWidth: 4, blockHeight: 4, blockBytes: 8, compressed: true },
  ETC2_RGB: { label: "ETC2 RGB", blockWidth: 4, blockHeight: 4, blockBytes: 8, compressed: true },
  ETC2_RGBA: { label: "ETC2 RGBA (EAC)", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  ASTC_4x4: { label: "ASTC 4x4", blockWidth: 4, blockHeight: 4, blockBytes: 16, compressed: true },
  ASTC_6x6: { label: "ASTC 6x6", blockWidth: 6, blockHeight: 6, blockBytes: 16, compressed: true },
  ASTC_8x8: { label: "ASTC 8x8", blockWidth: 8, blockHeight: 8, blockBytes: 16, compressed: true },
} as const satisfies Record<string, FormatSpec>;

export type FormatKey = keyof typeof FORMATS;

export function bytesPerPixel(format: FormatKey): number {
  const f = FORMATS[format];
  return f.blockBytes / (f.blockWidth * f.blockHeight);
}
```

Bu tablodaki sayılar keyfi değil, format spesifikasyonlarından gelir: S3TC'de DXT1 bloğu 8 bayt, DXT5 bloğu 16 bayt; BPTC (BC7) bloğu 16 bayt; ETC2 RGB 8, alfalı EAC varyantı 16; ASTC'de blok her zaman 16 bayttır ve oranı değiştiren şey bloğun kaç pikseli kapsadığıdır. ASTC 4×4 böylece 1 bayt/piksel, ASTC 8×8 ise 0,25 bayt/piksel eder.

| Format | bayt/piksel | Nerede karşınıza çıkar |
|---|---|---|
| RGBA32F | 16 | HDR render target, float veri dokusu |
| RGBA16F | 8 | HDR ortam haritası, post-process tamponu |
| RGBA8 | 4 | Bütün PNG/JPEG/WebP dokularının GPU'daki hâli |
| RGB565 / RGBA4444 | 2 | Eski mobil, düşük renk derinliği |
| BC7 / ASTC 4×4 / BC3 / ETC2 RGBA | 1 | UASTC transcode hedefleri, alfalı sıkıştırma |
| R8 | 1 | Maske, height map, tek kanal |
| BC1 / ETC1 / ETC2 RGB | 0,5 | ETC1S transcode hedefleri, alfasız |
| ASTC 6×6 | ~0,44 | Mobilde agresif ASTC ayarı |
| ASTC 8×8 | 0,25 | Arka plan, düşük detay yüzeyler |

Şimdi aritmetik. Bir mip seviyesinin baytı, o seviyenin kaç bloğa yuvarlandığıyla belirlenir. Buradaki `Math.ceil` kritik: 5×5 bir BC1 dokusu 2×2 = 4 blok tutar, 32 bayt eder; 25 pikselin 0,5 katı olan 12,5 bayt değil. Sıkıştırılmış formatlarda kısmi blok diye bir şey yoktur.

```ts
// texture-memory.ts (devamı)
export function levelBytes(width: number, height: number, format: FormatKey): number {
  const f = FORMATS[format];
  const cols = Math.ceil(Math.max(1, width) / f.blockWidth);
  const rows = Math.ceil(Math.max(1, height) / f.blockHeight);
  return cols * rows * f.blockBytes;
}

/** floor(log2(max(w,h))) + 1 — kayan nokta hatasına açık olmayan hâli. */
export function mipLevelCount(width: number, height: number): number {
  const size = Math.max(1, Math.max(width, height) | 0);
  return 32 - Math.clz32(size);
}

export interface MemoryOptions {
  mipmaps?: boolean;
  levels?: number; // hazır bir mip zinciri varsa (CompressedTexture.mipmaps.length)
  layers?: number; // cubemap = 6, array texture = katman sayısı
}

export function estimateTextureMemory(
  width: number,
  height: number,
  format: FormatKey,
  options: MemoryOptions = {},
): number {
  const { mipmaps = false, layers = 1 } = options;
  const levels = options.levels ?? (mipmaps ? mipLevelCount(width, height) : 1);
  let bytes = 0;
  for (let i = 0; i < levels; i++) {
    bytes += levelBytes(Math.max(1, width >> i), Math.max(1, height >> i), format);
  }
  return bytes * layers;
}
```

`mipLevelCount`'taki `Math.clz32` numarasına bir saniye durun. `Math.floor(Math.log2(size)) + 1` de aynı sonucu verir — motorun `log2(8)`'i tam olarak 3 döndürdüğü sürece. Döndürmediği bir motor bulursanız mip zinciriniz bir seviye eksilir ve hesabınız sessizce kayar. `32 - Math.clz32(size)` tamsayı aritmetiğidir, kayması mümkün değil.

Bir de `width >> i` var. Bir mip seviyesinin boyutu bir öncekinin yarısının aşağı yuvarlanmışıdır ve arka arkaya aşağı yuvarlanmış yarılama, doğrudan kaydırmaya eşittir — `floor(floor(x/2)/2) = floor(x/4)`. Bu yüzden döngüde her seviyeyi tek tek yarılamak yerine tek kaydırma yeter. NPOT (power-of-two olmayan) boyutlarda bile doğru çalışır.

Gelelim meşhur `×4/3`'e. Tam mip zincirli bir doku, taban seviyesinin yaklaşık dörtte bir fazlasını tutar, çünkü her seviye bir öncekinin dörtte biridir: 1 + 1/4 + 1/16 + ... Sonsuz toplamda bu 4/3 eder. Ama zincir sonsuz değil, 1×1'de biter. 4096×4096 RGBA8 için gerçek sayı 89.478.484 bayt; `4/3 × 67.108.864` ise 89.478.485,33. 1,33 bayt fark. Önemsiz görünüyor, öyle de — ta ki NPOT bir dokuya gelene kadar. 1000×1000 RGBA8'in mip zinciriyle birlikte gerçek boyutu 5.332.856 bayt, `×4/3` yaklaşımı ise 5.333.333 der. Sıkıştırılmış formatlarda ise sapma ters yöne döner: kuyruktaki 2×2 ve 1×1 seviyeleri tam blok yer kapladığı için gerçek boyut yaklaşımdan **büyük** çıkar.

Kısacası `×4/3` bir sezgi aracı, bir bütçe aracı değil. Bütçe için döngüyü koşun.

Kenar durumlarının özeti şöyle: mipmap yoksa `levels = 1`, tek satır. Cubemap için `layers = 6`; altı yüzün her biri tam bir mip zinciri taşır. Array texture'da `layers` katman sayısıdır. Sıkıştırılmış formatlarda ise hiçbir seviye bir bloktan küçük olamaz, o yüzden 1×1 bir BC7 mip'i 16 bayttır — 4×4 bir mip ile tam olarak aynı.

Aynı 4K dokunun formata göre rafta ne kadar yer kapladığı, formülün çıktısıyla:

| Format | bayt/piksel | 4096² taban | + mip zinciri | MiB (mip dâhil) | RGBA8'e oran |
|---|---|---|---|---|---|
| RGBA16F | 8 | 134.217.728 | 178.956.968 | 170,67 | 0,5× (iki kat kötü) |
| RGBA8 | 4 | 67.108.864 | 89.478.484 | 85,33 | 1× |
| BC7 / ASTC 4×4 | 1 | 16.777.216 | 22.369.648 | 21,33 | 4× |
| BC1 / ETC1 | 0,5 | 8.388.608 | 11.184.824 | 10,67 | 8× |

Başlıktaki "~90 MB" işte bu tablonun ikinci satırı. 89.478.484 bayt, onluk sistemde 89,5 MB; ikilik sistemde 85,33 MiB. Aynı sayı, iki farklı ölçek — ve bu iki ölçek karıştığı için bütçe tartışmalarında sürekli yüzde beşlik hayali bir pay kayboluyor. Bu yazıda kod hep bayt, tablolar hep MiB.

### renderer.info.memory Sayar, Tartmaz

Three.js'te GPU tarafına bakmanın standart yolu `renderer.info.memory`. Serinin ilk yazısında sızıntıyı bu sayaçla yakalamıştık. Ama şimdi sorduğumuz soru farklı. O sayaç bu soruya cevap vermiyor:

```ts
// three.js API'si — tek satırlık gösterim, proje dosyasından alıntı değil
renderer.info.memory.textures; // GPU'da duran doku SAYISI — bayt DEĞİL
```

Üç sayı ile bir sayı arasındaki fark burada uçurum. `textures: 3` size hiçbir şey söylemez: üç tane 32×32 ikon dokusu da üç eder, üç tane 4K albedo da. Biri 12 KiB, diğeri 256 MiB. Aynı sayaç, yirmi bin kat fark.

WebGL'de gerçek VRAM kullanımını sorgulayan bir API yok. `WEBGL_debug_renderer_info` size GPU'nun adını verir, boş belleğini değil. Masaüstünde sürücüye özel uzantılar var ama tarayıcıda yoklar, olmayacaklar da — fingerprinting (parmak izi) yüzeyi çok geniş. Dolayısıyla elimizde tek yol kalıyor: sahnedeki her dokuyu gezip formülle toplamak, sonuç sayısını da renderer'ın sayacıyla çapraz kontrol etmek.

```ts
// texture-budget.ts
import * as THREE from "three";
import { estimateTextureMemory, type FormatKey } from "./texture-memory";
import { formatOfTexture, layersOfTexture, levelsOfTexture, sizeOfTexture } from "./three-format";

export interface BudgetEntry {
  name: string;
  width: number;
  height: number;
  format: FormatKey;
  levels: number;
  layers: number;
  bytes: number;
}

export interface RendererInfoLike {
  info: { memory: { textures: number; geometries: number } };
}

export class TextureBudget {
  // Anahtar Texture nesnesinin KENDİSİ → paylaşılan atlas bir kez sayılır
  private readonly entries = new Map<THREE.Texture, BudgetEntry>();

  addTexture(texture: THREE.Texture, name?: string): BudgetEntry | null {
    const existing = this.entries.get(texture);
    if (existing) return existing;

    const { width, height } = sizeOfTexture(texture);
    if (width === 0 || height === 0) return null; // kaynağı henüz yüklenmemiş

    const format = formatOfTexture(texture);
    const levels = levelsOfTexture(texture);
    const layers = layersOfTexture(texture);
    const entry: BudgetEntry = {
      name: name ?? texture.name ?? "(isimsiz)",
      width,
      height,
      format,
      levels,
      layers,
      bytes: estimateTextureMemory(width, height, format, { levels, layers }),
    };
    this.entries.set(texture, entry);
    return entry;
  }

  addMaterial(material: THREE.Material, owner: string): void {
    // 7 slotluk sabit liste değil: materyalin BÜTÜN doku alanlarını tara
    for (const [slot, value] of Object.entries(material)) {
      if (value instanceof THREE.Texture) this.addTexture(value, `${owner}.${slot}`);
    }
  }

  addScene(scene: THREE.Object3D): void {
    scene.traverse((obj) => {
      const material = (obj as THREE.Mesh).material;
      if (!material) return;
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) this.addMaterial(m, obj.name || obj.type);
    });

    const s = scene as THREE.Scene;
    if (s.background instanceof THREE.Texture) this.addTexture(s.background, "scene.background");
    if (s.environment instanceof THREE.Texture) this.addTexture(s.environment, "scene.environment");
  }

  addRenderTarget(rt: THREE.WebGLRenderTarget, name = "renderTarget"): void {
    this.addTexture(rt.texture, `${name}.texture`);
    if (rt.depthTexture) this.addTexture(rt.depthTexture, `${name}.depthTexture`);
  }

  get totalBytes(): number {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.bytes;
    return sum;
  }

  get count(): number {
    return this.entries.size;
  }

  table(): BudgetEntry[] {
    return [...this.entries.values()].sort((a, b) => b.bytes - a.bytes);
  }

  crossCheck(renderer: RendererInfoLike): { counted: number; gpu: number; delta: number } {
    const gpu = renderer.info.memory.textures;
    return { counted: this.count, gpu, delta: gpu - this.count };
  }

  clear(): void {
    this.entries.clear();
  }
}
```

Bu sınıfta iki karar var ki, ikisi de kolayca yanlış yapılıyor.

`Map`'in anahtarı doku nesnesinin kendisi, adı değil. İki materyal aynı atlas'ı paylaşıyorsa VRAM'de tek kopya vardır; bütçe de onu tek kez saymalıdır. Sahne grafiğini dolaşırken aynı dokuya beş kez rastlarsınız, `Map` beşini bire indirir.

İkinci karar `addMaterial`'da: sabit bir slot listesi yerine `Object.entries` ile materyalin bütün alanları taranıyor, `Texture` olanlar toplanıyor. Serinin ilk yazısında yedi elemanlı sabit bir liste yeterliydi — orada dispose ettiğimiz kaynakları biz üretmiştik, listeyi biliyorduk. Burada iş farklı: bir bütçe raporunda gözden kaçan tek bir `clearcoatNormalMap`, tabloyu yalancı yapar. Rapor çıkarırken cömert taramak, dispose ederken temkinli davranmaktan daha doğru.

`crossCheck` ise gerçek renderer'la konuştuğumuz yer. Ama beklentiyi baştan doğru kuralım: `delta` genellikle sıfır çıkmaz, çıkmaması da normaldir. Renderer bizim gezmediğimiz şeyleri de sayar — gölge haritaları, PMREM'in ürettiği ara hedefler, materyal bir doku beklerken bulamayınca kullandığı varsayılan 1×1 beyaz doku, post-process zincirindeki render target'lar. Bir de şu var: `info.memory.textures` yalnızca GPU'ya **yüklenmiş** dokuları sayar. Sahneye eklediğiniz bir doku, o dokuyu kullanan bir mesh ilk kez çizilene kadar sayaca girmez. Çapraz kontrolü ilk `render()` çağrısından sonra yapın, yoksa kendi kendinizi kandırırsınız.

`delta`'nın işi eşitlik ispatı değil, alarm. Sayı beklediğinizden çok büyükse sahnede haberiniz olmayan dokular var demektir; küçükse henüz yüklenmemiş dokuları bütçeye yazmışsınızdır.

Geriye üç köprü fonksiyonu kalıyor: bir `THREE.Texture`'dan boyut, format ve seviye sayısı çıkarmak.

```ts
// three-format.ts (özet)
import * as THREE from "three";
import { mipLevelCount, type FormatKey } from "./texture-memory";

const COMPRESSED: ReadonlyMap<number, FormatKey> = new Map([
  [THREE.RGB_S3TC_DXT1_Format, "BC1"],
  [THREE.RGBA_S3TC_DXT1_Format, "BC1"],
  [THREE.RGBA_S3TC_DXT3_Format, "BC2"],
  [THREE.RGBA_S3TC_DXT5_Format, "BC3"],
  [THREE.RGBA_BPTC_Format, "BC7"],
  [THREE.RGB_ETC1_Format, "ETC1"],
  [THREE.RGB_ETC2_Format, "ETC2_RGB"],
  [THREE.RGBA_ETC2_EAC_Format, "ETC2_RGBA"],
  [THREE.RGBA_ASTC_4x4_Format, "ASTC_4x4"],
  [THREE.RGBA_ASTC_6x6_Format, "ASTC_6x6"],
  [THREE.RGBA_ASTC_8x8_Format, "ASTC_8x8"],
]);

const MIP_FILTERS: ReadonlySet<number> = new Set([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

export function formatOfTexture(texture: THREE.Texture): FormatKey {
  if ((texture as THREE.DepthTexture).isDepthTexture) {
    return texture.type === THREE.UnsignedShortType ? "DEPTH16" : "DEPTH24_STENCIL8";
  }
  const compressed = COMPRESSED.get(texture.format as number);
  if (compressed) return compressed;
  if (texture.type === THREE.FloatType) return "RGBA32F";
  if (texture.type === THREE.HalfFloatType) return "RGBA16F";
  if (texture.format === THREE.RedFormat) return "R8";
  if (texture.format === THREE.RGFormat) return "RG8";
  return "RGBA8"; // three r137'den beri RGBFormat yok: RGB kaynak da RGBA8 olarak yatar
}

export function levelsOfTexture(texture: THREE.Texture): number {
  const { width, height } = sizeOfTexture(texture);
  if ((texture as THREE.CompressedTexture).isCompressedTexture) {
    return Math.max(1, texture.mipmaps?.length ?? 1);
  }
  const wantsMips = texture.generateMipmaps && MIP_FILTERS.has(texture.minFilter as number);
  return wantsMips ? mipLevelCount(width, height) : 1;
}
```

Son satırdaki yorum üzerinde durmaya değer. Three.js r137'de `RGBFormat` kaldırıldı. Kaynağınız üç kanallı bir JPEG olsa bile GPU'da dört kanal yer kaplar — dördüncü kanal hep 255 olsa bile. "Alfası yok, daha az yer kaplar" sezgisi sıkıştırılmamış dünyada geçerli değil.

`levelsOfTexture`'daki mip tespiti de gerçek Three.js davranışını izler: mipmap yalnızca `generateMipmaps` açıkken **ve** `minFilter` mipmap'li bir filtre iken üretilir. `DataTexture`'ın varsayılanları `generateMipmaps: false` ve `minFilter: NearestFilter`'dır; bu yüzden prosedürel ürettiğiniz dokular varsayılan hâlde mip zinciri taşımaz ve tam olarak taban boyutu kadar yer kaplar. `CanvasTexture` ve `TextureLoader` çıktılarında ise varsayılan mipmap'li, dolayısıyla o `×4/3` sizin haberiniz olmadan devreye girer.

### KTX2 Tarafı: Sıkıştırılmış Kalmak

Katlanmış giysiyi rafa koyma kısmı burası.

KTX2 bir konteyner formatıdır; içinde genellikle Basis Universal ile kodlanmış iki tür yük taşır. ETC1S düşük bit hızlı, palet tabanlı bir kodlamadır; hedef formatlarda tipik olarak 0,5 bayt/piksele iner ve dosyası çok küçüktür. UASTC ise yüksek kaliteli, 1 bayt/piksellik bir ara formattır; dosyası ETC1S'ten çok daha büyüktür ama normal haritası gibi hassas verilerde ayakta kalır.

"Universal" kelimesi buradaki kilit fikir: KTX2 dosyası bir GPU formatı içermez, bir **ara** format içerir. Yükleme anında, çalıştığı cihazın desteklediği gerçek GPU formatına transcode edilir. Bu dönüşüm hızlıdır ve yeniden sıkıştırma değil, blok yeniden yazımıdır.

Bağlama şöyle:

```ts
// ktx2.ts
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export function createKTX2Loader(renderer: THREE.WebGLRenderer): KTX2Loader {
  const loader = new KTX2Loader();
  // basis_transcoder.js + .wasm → node_modules/three/examples/jsm/libs/basis/'ten public/basis/'e kopyalanır
  loader.setTranscoderPath("/basis/");
  loader.detectSupport(renderer); // GPU'ya sorar, transcode hedefini belirler
  return loader;
}

export interface WorkerConfig {
  astcSupported: boolean;
  bptcSupported: boolean;
  dxtSupported: boolean;
  etc1Supported: boolean;
  etc2Supported: boolean;
  pvrtcSupported: boolean;
}

/** detectSupport'un GPU'dan topladığı sonucu okunur hâle getirir. */
export function readWorkerConfig(loader: KTX2Loader): WorkerConfig | null {
  return (loader as unknown as { workerConfig?: WorkerConfig }).workerConfig ?? null;
}
```

`detectSupport(renderer)` bir dosya indirmez, transcoder'ı bile başlatmaz — sadece renderer'a hangi sıkıştırılmış doku uzantılarının açık olduğunu sorar ve sonucu `workerConfig`'e yazar. Bu yüzden onu KTX2 varlığı olmadan da koşabiliriz, ki bu projede tam olarak öyle yapıyoruz.

Uzantıların ham hâlini doğrudan WebGL context'inden de okuyabilirsiniz:

```ts
// transcode-target.ts
import { FORMATS, type FormatKey } from "./texture-memory";

export interface FormatSupport {
  astc: boolean;
  bptc: boolean;
  s3tc: boolean;
  etc2: boolean;
  etc1: boolean;
  pvrtc: boolean;
}

export const EXTENSION_NAMES = {
  astc: "WEBGL_compressed_texture_astc",
  bptc: "EXT_texture_compression_bptc",
  s3tc: "WEBGL_compressed_texture_s3tc",
  etc2: "WEBGL_compressed_texture_etc",
  etc1: "WEBGL_compressed_texture_etc1",
  pvrtc: "WEBGL_compressed_texture_pvrtc",
} as const;

export function detectFormatSupport(gl: WebGLRenderingContext | WebGL2RenderingContext): FormatSupport {
  const has = (name: string) => gl.getExtension(name) !== null;
  return {
    astc: has(EXTENSION_NAMES.astc),
    bptc: has(EXTENSION_NAMES.bptc),
    s3tc: has(EXTENSION_NAMES.s3tc),
    etc2: has(EXTENSION_NAMES.etc2),
    etc1: has(EXTENSION_NAMES.etc1),
    pvrtc: has(EXTENSION_NAMES.pvrtc) || has("WEBKIT_WEBGL_compressed_texture_pvrtc"),
  };
}
```

Peki bu bayraklardan hangi formata gidileceğine kim karar veriyor? KTX2Loader'ın içinde önceliklendirilmiş bir tablo var ve bu tablo göründüğünden ilginç. Kaynağından çıkarıp taşınabilir, test edilebilir bir fonksiyona çevirelim:

```ts
// transcode-target.ts (devamı)
type BasisFormat = "ETC1S" | "UASTC";

interface TargetOption {
  requires: keyof FormatSupport | null;
  /** `[alfasız, alfalı]`. TEK elemanlı satır = o format alfa taşıyamaz. */
  engineFormat: readonly FormatKey[];
  priorityETC1S: number;
  priorityUASTC: number;
  needsPowerOfTwo: boolean;
}

// three'nin KTX2Loader.js dosyasındaki FORMAT_OPTIONS tablosunun ETC1S/UASTC alt kümesi
// (PVRTC ve UASTC_HDR satırları bilerek dışarıda — bu projede o formatlar yok)
//
// Dizi UZUNLUKLARI da tablonun bir parçası: ETC1'in alfa kanalı yoktur, o yüzden
// three'de o satır tek elemanlıdır ve alfa istendiğinde atlanır. Satırı ["ETC1","ETC1"]
// diye doldurmak alfayı bedava gösterir ve VRAM'i 2×–8× EKSİK tahmin ettirir.
// prettier-ignore
const TARGETS: readonly TargetOption[] = [
  { requires: "astc",  engineFormat: ["ASTC_4x4", "ASTC_4x4"],  priorityETC1S: Infinity, priorityUASTC: 1, needsPowerOfTwo: false },
  { requires: "bptc",  engineFormat: ["BC7", "BC7"],            priorityETC1S: 3,        priorityUASTC: 2, needsPowerOfTwo: false },
  { requires: "s3tc",  engineFormat: ["BC1", "BC3"],            priorityETC1S: 4,        priorityUASTC: 5, needsPowerOfTwo: false },
  { requires: "etc2",  engineFormat: ["ETC2_RGB", "ETC2_RGBA"], priorityETC1S: 1,        priorityUASTC: 3, needsPowerOfTwo: false },
  { requires: "etc1",  engineFormat: ["ETC1"],                  priorityETC1S: 2,        priorityUASTC: 4, needsPowerOfTwo: false },
  { requires: null,    engineFormat: ["RGBA8", "RGBA8"],        priorityETC1S: 100,      priorityUASTC: 100, needsPowerOfTwo: false },
];

export interface TranscodeChoice {
  format: FormatKey;
  compressed: boolean;
}

export function pickTranscodeTarget(
  support: FormatSupport,
  basisFormat: BasisFormat,
  hasAlpha: boolean,
): TranscodeChoice {
  const key = basisFormat === "ETC1S" ? "priorityETC1S" : "priorityUASTC";
  const sorted = [...TARGETS].sort((a, b) => a[key] - b[key]);
  for (const opt of sorted) {
    if (opt.requires && !support[opt.requires]) continue;
    if (basisFormat === "ETC1S" && opt.priorityETC1S === Infinity) continue;
    // three'nin koruması: alfa isteniyorsa alfa taşıyamayan satırı atla.
    // ETC1-var / ETC2-yok bir GPU'da alfalı doku ETC1'e DEĞİL, bir sonraki
    // uygun hedefe (BC3/BC7) ya da RGBA8'e gider.
    if (hasAlpha && opt.engineFormat.length < 2) continue;
    const format = opt.engineFormat[hasAlpha ? 1 : 0];
    return { format, compressed: FORMATS[format].compressed };
  }
  return { format: "RGBA8", compressed: false };
}
```

Tabloda üç şey var ki ilk okuyuşta atlanır, sonra da insanın kafasına dank eder.

Birincisi, ETC1S için ASTC önceliği `Infinity`. ETC1S yükü, ASTC destekleyen bir cihazda bile ASTC'ye gitmez. Mantıklı: ASTC 4×4 blok başına 16 bayttır, ETC2 ise 8. ETC1S'in zaten düşük olan kalitesini ASTC'ye taşımak rafta iki kat yer harcar, karşılığında hiçbir şey kazandırmaz. Öncelik tablosu bir kalite sıralaması değil, bir kalite-boyut pazarlığı.

İkincisi, UASTC için sıralama ASTC → BC7 → ETC2 → ETC1 → S3TC. Modern bir mobil cihazda ASTC, masaüstünde BC7 — ikisi de 1 bayt/piksel. UASTC'nin ara formatı da 1 bayt/piksel olduğu için burada dönüşüm neredeyse kayıpsızdır.

Üçüncüsü ve pratikte en pahalısı: alfa kanalı bedava değil. `engineFormat` çiftinin ikinci elemanına bakın. S3TC'de alfasız BC1 (0,5) iken alfalı BC3 (1,0); ETC2'de alfasız 0,5 iken alfalı EAC 1,0. Aynı doku, tek bir alfa kanalı yüzünden rafta iki katına çıkıyor. 4K bir doku için bu 10,67 MiB ile 21,33 MiB arasındaki fark demek. Maskeyi ayrı bir R8 dokusuna almak ya da alfayı hiç taşımamak, bazen KTX2'ye geçmek kadar kazandırır.

Alfanın ETC1 satırında yaptığı ise daha sinsi, çünkü orada bir çift yok — tek eleman var. ETC1'in alfa kanalı yoktur; spesifikasyonda yok, transcoder'da da yok. Satırı `["ETC1", "ETC1"]` diye doldurmak (ilk yazdığımda tam olarak bunu yapmıştım) alfayı bedavaya getiriyor: aynı 0,5 bayt/piksel, hiçbir ceza yok. Gerçekte ETC1'i olup ETC2'si olmayan bir cihazda alfalı doku ETC1'e hiç gitmez, sıradaki uygun hedefe düşer — elde S3TC varsa BC3 ile 1,0, hiçbiri yoksa RGBA8 ile 4,0 bayt/piksel. Yani o dolgu, bir VRAM bütçe aracını iki ilâ sekiz kat iyimser gösteriyordu; bir bütçe aracının yanılmayı en az göze alabileceği yönde. Döngüdeki `engineFormat.length < 2` kontrolü bu yüzden var, ve `TARGETS` tablosunda dizi uzunlukları da en az öncelik sayıları kadar veri.

En tepedeki uyarıyı da atlamayalım: hiçbir sıkıştırılmış format desteklenmiyorsa transcoder RGBA8'e açar. O durumda KTX2 kullanmanın VRAM kazancı tam olarak sıfırdır — hatta transcode maliyeti yüzünden bir miktar zarardır. Nadir bir senaryo ama imkânsız değil; eski bir WebGL1 bağlamında ya da yazılım renderer'ında karşınıza çıkar.

### Sürücüye Soralım: Blok Boyutu Doğru mu?

Buraya kadar her şey hesap. Hesabın doğruluğunu neye dayandırıyoruz?

Şansımıza, WebGL sürücüsünün kendisine dayandırabiliyoruz. `compressedTexImage2D` çağrısına verdiğiniz tampon, o boyut ve format için beklenen bayt sayısıyla **tam olarak** eşleşmek zorundadır. Eşleşmezse WebGL spesifikasyonu gereği çağrı `INVALID_VALUE` ile reddedilir. Yani sürücü, bizim blok hesabımızı denetleyen ücretsiz bir hakem.

Bunu iki yönlü bir deneye çevirelim: doğru boyutu kabul ediyor mu, bir bayt eksiğini reddediyor mu?

```ts
// block-probe.ts
import { levelBytes, type FormatKey } from "./texture-memory";

export interface BlockProbeResult {
  format: FormatKey;
  width: number;
  height: number;
  expectedBytes: number;
  exactAccepted: boolean; // formülün verdiği bayt → sürücü kabul etti mi?
  shortRejected: boolean; // bir bayt eksik → sürücü reddetti mi?
}

export function probeBlockSize(
  gl: WebGL2RenderingContext,
  format: FormatKey,
  glFormat: number,
  width: number,
  height: number,
): BlockProbeResult {
  const expectedBytes = levelBytes(width, height, format);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  while (gl.getError() !== gl.NO_ERROR) {
    /* önceki hataları kuyruktan boşalt */
  }

  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, glFormat, width, height, 0, new Uint8Array(expectedBytes));
  const exactAccepted = gl.getError() === gl.NO_ERROR;

  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, glFormat, width, height, 0, new Uint8Array(expectedBytes - 1));
  const shortRejected = gl.getError() === gl.INVALID_VALUE;

  gl.deleteTexture(texture);
  return { format, width, height, expectedBytes, exactAccepted, shortRejected };
}
```

İkinci çağrı testin ruhu. Bir hipotezi yalnızca doğrulamaya çalışırsanız kendinizi kandırırsınız; onu yanlışlamaya da çalışmanız gerekir. Eğer sürücü bir bayt eksiği de kabul ediyorsa, ilk çağrının geçmesi hiçbir şey ispatlamıyordur.

Hangi GL formatlarının elimizde olduğunu uzantı nesnelerinden okuruz:

```ts
// block-probe.ts (devamı)
export interface CompressedFormatEntry {
  key: FormatKey;
  glFormat: number;
  label: string;
}

export function availableCompressedFormats(gl: WebGL2RenderingContext): CompressedFormatEntry[] {
  const out: CompressedFormatEntry[] = [];

  const s3tc = gl.getExtension("WEBGL_compressed_texture_s3tc");
  if (s3tc) {
    out.push({ key: "BC1", glFormat: s3tc.COMPRESSED_RGB_S3TC_DXT1_EXT, label: "BC1 (DXT1)" });
    out.push({ key: "BC3", glFormat: s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT, label: "BC3 (DXT5)" });
  }

  const bptc = gl.getExtension("EXT_texture_compression_bptc") as { COMPRESSED_RGBA_BPTC_UNORM_EXT: number } | null;
  if (bptc) out.push({ key: "BC7", glFormat: bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT, label: "BC7 (BPTC)" });

  const astc = gl.getExtension("WEBGL_compressed_texture_astc");
  if (astc) out.push({ key: "ASTC_4x4", glFormat: astc.COMPRESSED_RGBA_ASTC_4x4_KHR, label: "ASTC 4x4" });

  const etc = gl.getExtension("WEBGL_compressed_texture_etc") as { COMPRESSED_RGB8_ETC2: number } | null;
  if (etc) out.push({ key: "ETC2_RGB", glFormat: etc.COMPRESSED_RGB8_ETC2, label: "ETC2 RGB" });

  return out;
}
```

Demo bu iki fonksiyonu birleştirip her desteklenen format için hem 256×256 (tam blok) hem 250×250 (kısmi blok, `ceil` gerektiren) ölçümü koşuyor. 250×250 satırı özellikle kıymetli: `ceil(250/4) = 63` — 63×63 blok. Formülü `Math.floor` ile yazsaydınız sürücü tamponunuzu reddederdi ve bunu ancak o cihazda öğrenirdiniz.

Bu, tarayıcıda alabileceğimiz "VRAM ölçümü"ne en yakın şey. Sürücü bize kaç bayt kullandığını söylemiyor, ama kaç bayt beklediğini söylüyor — ve allocation (doku yerleşimi) tam olarak o kadar.

### İki Sütun, İki Yön

Tezi bir tabloda görelim. Demo, prosedürel bir deseni bir `<canvas>`'a çiziyor, sonra üç ölçüm alıyor: `canvas.toBlob` ile PNG'nin bayt sayısı, aynı yolla WebP'nin bayt sayısı ve aynı dokunun formüle göre VRAM karşılığı.

```ts
// file-size.ts
export interface EncodedSize {
  mime: string;
  bytes: number;
  supported: boolean;
}

export async function encodedSizes(
  canvas: HTMLCanvasElement,
  mimes: readonly string[] = ["image/png", "image/webp"],
  quality = 0.85,
): Promise<EncodedSize[]> {
  const out: EncodedSize[] = [];
  for (const mime of mimes) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    // Tarayıcı istenen formatı üretemezse sessizce PNG döner — type kontrolü şart
    out.push({ mime, bytes: blob?.size ?? 0, supported: blob?.type === mime });
  }
  return out;
}
```

Demodaki desen üretecinin bir "gürültü" kaydırıcısı var ve bu kaydırıcı bütün yazının tezini tek hamlede gösteriyor. Gürültüyü sıfıra çekin: desen düz gradyan olur, PNG birkaç on KB'a iner. Sonuna kadar açın: PNG megabaytlara tırmanır. Kaydırıcıyı oynatırken VRAM sütunu bir bayt bile kıpırdamaz.

Çünkü kargo sütunu içeriğin entropisine bakar. Raf sütunu yalnızca genişlik, yükseklik ve formata bakar.

| Ölçüm (2048×2048 prosedürel doku) | Değer | Kaynak |
|---|---|---|
| PNG dosya boyutu | — (demoda ölçülür) | `canvas.toBlob("image/png")` |
| WebP dosya boyutu (q=0.85) | — (demoda ölçülür) | `canvas.toBlob("image/webp")` |
| KTX2/ETC1S dosya boyutu | — (encode edilmedi) | bu projede koşulmuyor |
| VRAM · RGBA8, mip yok | 16.777.216 B (16,00 MiB) | formül |
| VRAM · RGBA8, mip dâhil | 22.369.620 B (21,33 MiB) | formül |
| VRAM · BC7/ASTC 4×4, mip dâhil | 5.592.432 B (5,33 MiB) | formül · blok boyutunu demo sürücüye doğrulatır |
| VRAM · BC1/ETC1S, mip dâhil | 2.796.216 B (2,67 MiB) | formül · blok boyutunu demo sürücüye doğrulatır |

PNG ve WebP hücrelerini boş bıraktım çünkü onları ben ölçmedim; ayrıca bu iki sayı tarayıcının encoder'ına göre değişir — Chrome'un WebP çıktısı ile Safari'ninki aynı olmak zorunda değil. Demoyu kendi makinenizde koşarsanız kendi sayınızı görürsünüz. Uydurma sayı yazmıyorum.

KTX2 satırındaki boşluk ise kasıtlı ve öğretici. Şunu söyleyebiliriz: bir UASTC KTX2 dosyası, aynı dokunun WebP'sinden **daha büyük** olabilir. Bir bayt/piksellik yükü Zstandard ile sıkıştırır, ama WebP'nin kayıplı DCT'siyle yarışmaz. Bir sütun kötüleşirken diğeri dört kat iyileşiyor. Kargo ile raf arasındaki bağın koptuğu yer tam olarak burası.

Tabloya girmeyen ama sahada hissedilen iki kazanç daha var. Sıkıştırılmış doku GPU'ya daha az bant genişliğiyle ulaşır; texture cache (doku önbelleği) aynı miktarda cache satırında dört kat fazla texel tutar, bu da fill-rate'e dokunur. Transcode ise ana thread'i JPEG decode kadar meşgul etmez — KTX2Loader işi bir worker havuzunda yapar. Bunlar bu yazının ölçtüğü şeyler değil, o yüzden sayı vermiyorum; sadece rafın tek kazanç olmadığını not ediyorum.

### 256 MiB'lık Rafa Ne Sığar?

Sayılar ancak bütçeye dönüşünce işe yarıyor; asıl karar orada veriliyor.

Orta seviye bir mobil cihazda doku için ayırabileceğiniz gerçekçi pay, uygulamanın tamamına düşen bellekten sonra 256 MiB civarıdır. Bu bir spesifikasyon değil, saha kuralı — cihaz, tarayıcı ve o an açık olan diğer sekmeler payı aşağı çeker. Ama hesap yapmak için bir sayı gerekiyor, o yüzden 268.435.456 baytla çalışalım.

```ts
// budget-plan.ts
export function howManyFit(budgetBytes: number, perTextureBytes: number): number {
  return Math.floor(budgetBytes / perTextureBytes);
}
```

Aynı 4K doku, üç formatta:

| Format | doku başına (mip dâhil) | 256 MiB'a kaç tane sığar |
|---|---|---|
| RGBA8 | 89.478.484 B | 3 |
| BC7 / ASTC 4×4 | 22.369.648 B | 11 |
| BC1 / ETC1S | 11.184.824 B | 23 |

Üç, on bir, yirmi üç. Aynı asset, aynı çözünürlük, aynı ekran görüntüsü — sekiz kata varan bir raf farkı.

İki tuhaflığa dikkat edin, ikisi de bu tabloyu gerçekten hesaplattığınızda ortaya çıkıyor. Üç tane RGBA8 doku tam 268.435.452 bayt eder; bütçeden geriye dört bayt kalır. Neredeyse şaka gibi bir denk gelme. BC7 tarafında ise on iki doku 268.435.776 bayt tutuyor, bütçeyi 320 baytla aşıyor; tabloda on iki değil on bir yazmasının sebebi bu. Kuyruk mip'lerindeki block padding (blok dolgusu), "dört kat küçük, o hâlde dört katı sığar" sezgisini son adımda deviriyor.

Peki KTX2 her zaman doğru cevap mı? Hayır. Buradaki alternatifi ciddiye almak lazım.

Bakın: 2048×2048 RGBA8 bir doku, mip zinciriyle birlikte 22.369.620 bayt tutar. 4096×4096 BC7 ise 22.369.648 bayt. Aradaki fark **28 bayt**. Çözünürlüğü yarıya indirmek, tam çözünürlükte BC7'ye geçmekle rafta neredeyse birebir aynı yeri kazandırıyor. Encode pipeline'ı yok, transcoder wasm'ı yok, `detectSupport` yok, format matrisi yok — sadece bir `resize`.

O hâlde karar tablosu şöyle çıkıyor. Doku ekranda küçük kalıyorsa, arka planda duruyorsa ya da texel yoğunluğu zaten ekran pikselinin altındaysa boyutu düşürün; en ucuz kazanç orada. Bir sürü küçük doku ayrı ayrı yer kaplıyorsa atlas'a alın: hem raf hem draw call kazanırsınız, üstelik `ceil` yuvarlamasından kaynaklanan blok israfını da toplarsınız. Ama 4K detay gerçekten gerekiyorsa — kamera yüzeye yaklaşıyor, karakterin derisi ya da zeminin taş dokusu okunmak zorunda — işte orada KTX2'nin alternatifi yok. Çözünürlüğü koruyup rafı dörde bölen tek yol o.

İkisini birleştirmek de serbest: 2048 BC7 ile 4096 RGBA8 arasında on altı kat var.

Son bir uyarı, çünkü bu tuzağa düşen çok oluyor. ETC1S'i her dokuya uygulamayın. Albedo ve ambient occlusion'da ETC1S gayet iyi durur. Normal haritasında ise yüzey ölür — palet tabanlı kodlama normal vektörlerinin ince açı farklarını taşıyamaz, aydınlatma bantlanır. Normal haritaları için UASTC (dolayısıyla BC7/ASTC) kullanın, ya da masaüstü hedefliyorsanız iki kanallı BC5 tercih edin. Format seçimi doku başına bir karardır, klasör başına değil.

Mipmap'ten vazgeçme fikrine gelince: evet, `generateMipmaps = false` yazarak 4K bir dokudan 21 MiB kazanırsınız. Sonra kamera uzaklaşınca yüzey titrer, minification aliasing başlar ve doku önbelleği her karede boşa çalışır. Yüzde yirmi beş bellek için performans ve görüntü kalitesi vermek nadiren iyi bir takas. Mipmap'i yalnızca ekranda hep aynı ölçekte duran şeylerde — UI sprite'ları, tam ekran quad'lar — kapatın.

### Kanıt: Tarayıcısız, Deterministik Testler

Formül bir iddiadır; iddianın testi olmalı. İyi haber, buradaki iddiaların tamamı saf aritmetik — ne WebGL ne GPU gerekiyor, vitest node altında milisaniyelerde koşuyor.

```ts
// texture-memory.test.ts
import { describe, expect, it } from "vitest";
import { estimateTextureMemory, levelBytes, mipLevelCount } from "../src/texture-memory";

describe("byte-per-pixel formülü", () => {
  it("4096² RGBA8, mipmap yok → 67.108.864 bayt (64 MiB)", () => {
    expect(estimateTextureMemory(4096, 4096, "RGBA8")).toBe(67_108_864);
  });

  it("4096² RGBA8, mip zinciriyle → 89.478.484 bayt", () => {
    const bytes = estimateTextureMemory(4096, 4096, "RGBA8", { mipmaps: true });
    expect(bytes).toBe(89_478_484);
    // ×4/3 bir ÜST SINIR, tam eşitlik değil
    expect(bytes).toBeLessThan((67_108_864 * 4) / 3);
    expect(bytes / 67_108_864).toBeCloseTo(4 / 3, 6);
  });

  it("mip zinciri uzunluğu: 4096→13, 1024→11, 1→1, NPOT 1000→10", () => {
    expect(mipLevelCount(4096, 4096)).toBe(13);
    expect(mipLevelCount(1024, 256)).toBe(11); // uzun kenar belirler
    expect(mipLevelCount(1, 1)).toBe(1);
    expect(mipLevelCount(1000, 1000)).toBe(10);
  });

  it("NPOT 1000² RGBA8 mip zinciri, ×4/3 yaklaşımının ALTINDA kalır", () => {
    expect(estimateTextureMemory(1000, 1000, "RGBA8", { mipmaps: true })).toBe(5_332_856);
  });

  it("sıkıştırılmış format blok hizalaması: kısmi blok tam blok sayılır", () => {
    expect(levelBytes(4, 4, "BC1")).toBe(8); // tam bir blok
    expect(levelBytes(5, 5, "BC1")).toBe(32); // 2×2 blok — 12,5 DEĞİL
    expect(levelBytes(1, 1, "BC7")).toBe(16); // 1×1 mip bile tam blok
    expect(levelBytes(250, 250, "BC7")).toBe(63 * 63 * 16);
    expect(levelBytes(1024, 1024, "ASTC_8x8")).toBe(128 * 128 * 16);
  });

  it("cubemap çarpanı ×6, katmanların her biri kendi mip zincirini taşır", () => {
    const face = estimateTextureMemory(512, 512, "RGBA8", { mipmaps: true });
    const cube = estimateTextureMemory(512, 512, "RGBA8", { mipmaps: true, layers: 6 });
    expect(cube).toBe(face * 6);
  });

  it("4K BC7 ile 2K RGBA8 rafta aynı yeri kaplar (28 bayt farkla)", () => {
    const bc7 = estimateTextureMemory(4096, 4096, "BC7", { mipmaps: true });
    const rgba2k = estimateTextureMemory(2048, 2048, "RGBA8", { mipmaps: true });
    expect(bc7).toBe(22_369_648);
    expect(rgba2k).toBe(22_369_620);
    expect(bc7 - rgba2k).toBe(28);
  });
});
```

Son test benim en sevdiğim, çünkü bir cümlelik tavsiyeyi ("çözünürlüğü yarıya indirmek BC7'ye geçmekle aynı kapıya çıkar") bir sayıya bağlıyor. Tavsiyeler eskir, testler eskimez.

`TextureBudget` tarafında da asıl kanıtlanacak şey toplama değil, tekilleştirme:

```ts
// texture-budget.test.ts (ilgili kısım)
it("paylaşılan doku bir kez sayılır", () => {
  const shared = new THREE.DataTexture(new Uint8Array(64 * 64 * 4), 64, 64);
  const a = new THREE.MeshStandardMaterial({ map: shared });
  const b = new THREE.MeshStandardMaterial({ map: shared });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), a));
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), b));

  const budget = new TextureBudget();
  budget.addScene(scene);

  expect(budget.count).toBe(1); // iki materyal, TEK doku
  expect(budget.totalBytes).toBe(64 * 64 * 4); // DataTexture varsayılanı: mipmap YOK
});

it("crossCheck sahte renderer'ın sayacıyla karşılaştırır", () => {
  const budget = new TextureBudget();
  budget.addTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const fake = { info: { memory: { textures: 3, geometries: 0 } } };
  expect(budget.crossCheck(fake)).toEqual({ counted: 1, gpu: 3, delta: 2 });
});
```

İkinci testteki sahte renderer, serinin ilk yazısındaki `RendererInfoLike` sözleşmesinin aynısı: `info.memory` şeklini taklit eden düz bir nesne. Aynı arayüzü paylaştıkları için `TextureBudget` gerçek `WebGLRenderer` ile sahte olanı ayırt edemiyor, biz de çapraz kontrol mantığını GPU'suz test edebiliyoruz.

Transcode seçimi de saf mantık olduğu için testi kolay:

```ts
// transcode-target.test.ts (ilgili kısım)
const NONE = { astc: false, bptc: false, s3tc: false, etc2: false, etc1: false, pvrtc: false };

it("UASTC + ASTC destekli mobil → ASTC 4x4", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true, etc2: true }, "UASTC", false).format).toBe("ASTC_4x4");
});

it("ETC1S ASTC'ye ASLA gitmez, ETC2'yi tercih eder", () => {
  expect(pickTranscodeTarget({ ...NONE, astc: true, etc2: true }, "ETC1S", false).format).toBe("ETC2_RGB");
});

it("alfa kanalı hedefi 0,5 bpp'den 1,0 bpp'ye çıkarır", () => {
  const s3tc = { ...NONE, s3tc: true };
  expect(pickTranscodeTarget(s3tc, "ETC1S", false).format).toBe("BC1"); // 0,5
  expect(pickTranscodeTarget(s3tc, "ETC1S", true).format).toBe("BC3"); // 1,0
});

it("hiç destek yoksa RGBA8'e düşer — VRAM kazancı sıfır", () => {
  const choice = pickTranscodeTarget(NONE, "UASTC", true);
  expect(choice.format).toBe("RGBA8");
  expect(choice.compressed).toBe(false);
});

it("alfa istenirken ETC1 atlanır: tek başına ETC1'li GPU RGBA8'e düşer", () => {
  const etc1Only = { ...NONE, etc1: true };
  expect(pickTranscodeTarget(etc1Only, "ETC1S", false).format).toBe("ETC1");
  expect(pickTranscodeTarget(etc1Only, "ETC1S", true)).toEqual({
    format: "RGBA8",
    compressed: false,
  });
  expect(pickTranscodeTarget(etc1Only, "UASTC", true).format).toBe("RGBA8");
});
```

Üçüncü test, alfa kanalının bedelini bir daha çiviliyor. Dördüncüsü ise en kötü senaryonun sessizce gerçekleşebileceğini hatırlatıyor: KTX2 kullanıyorsunuz, her şey çalışıyor, hiçbir hata yok — ve raf hiç küçülmemiş.

Beşincisi benim yediğim golü bekliyor. `engineFormat.length < 2` korumasını silin, o test kırmızıya döner — denedim, tam üç test kızarıyor. Koruma olmadan aynı senaryo ETC1 diyor ve bütçe aracı 0,5 bayt/piksel sayıyor; doğrusu 4,0. Bir hesap makinesinin sekiz kat yanılması için tek elemanlı bir diziyi çift yazmak yetiyor.

Sürücü doğrulaması ve dosya boyutu ölçümü tarayıcı gerektirdiği için testlerde değil, demoda duruyor. Bir şeyi node altında ölçemiyorsak orada ölçtüğümüzü iddia etmeyiz; demoyu açar, sayıyı gözümüzle görürüz.

Demo bilerek hafif tutuldu: aynı anda en fazla iki büyük doku canlı kalıyor, üretim 2048'de sınırlı, 4K satırları yalnızca hesaplanıyor. Ölçüm otomatik değil, düğmeyle tetikleniyor. "Boşalt" düğmesi ise serinin ilk yazısındaki disiplini uyguluyor: dokuları dispose edip `renderer.info.memory.textures` sayacının başlangıç değerine döndüğünü gösteriyor. Bütçe ölçen bir aracın kendi kendine sızdırması, en azından, ironik olurdu.

### Özetle:

1. Dosya boyutu kargo ölçüsüdür, raf ölçüsü değil. PNG/JPEG/WebP/AVIF CPU'da çözülür; GPU'ya ham piksel gider. 8 MB'lık PNG de 900 KB'lık WebP de VRAM'de aynı 67.108.864 baytı kaplar.
2. GPU'nun blok sıkıştırmayı okuyabilmesinin sebebi sabit oran ve blok yerelliğidir: BC7'de her 4×4 piksel tam 16 bayttır, adresi hesaplanabilir, donanım örnekleme anında çözer. DEFLATE ve DCT'de bu mümkün değil.
3. Formül tek satır: `ceil(w/blockW) × ceil(h/blockH) × blockBytes`, mip seviyeleri boyunca toplanır, `layers` (cubemap = 6) ile çarpılır. Mip sayısı `32 - Math.clz32(max(w,h))`.
4. `×4/3` bir sezgi, bütçe değil. Sıkıştırılmamış NPOT dokularda yaklaşımın altında, sıkıştırılmış formatlarda blok dolgusu yüzünden üstünde kalır. Döngüyü koşun.
5. `renderer.info.memory.textures` doku sayısını verir, baytını değil — üç ikon da üç eder, üç tane 4K albedo da. Sahneyi gezip formülle toplayan bir `TextureBudget` yazın, sayacı yalnızca çapraz kontrol için kullanın (ve ilk `render()`'dan sonra okuyun).
6. KTX2 bir GPU formatı değil, bir konteynerdir; ETC1S/UASTC yükü cihazın desteklediği formata transcode edilir. Seçim tablosu three'nin kaynağında duruyor: UASTC için ASTC → BC7 → ETC2, ETC1S için ETC2 → ETC1 → BC7 → S3TC. ETC1S asla ASTC'ye gitmez.
7. Alfa kanalı rafı ikiye katlar: S3TC'de BC1 (0,5) yerine BC3 (1,0), ETC2'de RGB (0,5) yerine EAC (1,0). ETC1'de ise ikiye katlamaz — alfayı hiç taşımaz, doku sıradaki hedefe düşer (0,5 → 1,0 ya da 4,0). Maskeyi ayrı bir R8 dokusuna almak bazen format değiştirmek kadar kazandırır.
8. Hiçbir sıkıştırılmış format desteklenmiyorsa transcoder RGBA8'e açar ve KTX2'nin VRAM kazancı sıfırlanır. Sessizce olur; `detectSupport` sonucunu raporlayın.
9. Formülü tarayıcıda sürücüye doğrulatabilirsiniz: `compressedTexImage2D` yanlış boyutlu tamponu `INVALID_VALUE` ile reddeder. Doğru boyutun kabul edilmesi ve bir bayt eksiğin reddedilmesi birlikte ölçülürse hesap ispatlanmış olur.
10. 256 MiB'lık mobil doku bütçesine mip'li 4K doku olarak üç RGBA8, on bir BC7 ya da yirmi üç BC1 sığar. Ve 4096² BC7 ile 2048² RGBA8 rafta 28 bayt farkla aynı yeri kaplar — encode pipeline'ı kurmadan önce bir kez daha düşünmeye değer bir sayı.

Kodun tamamı — format tablosu, `estimateTextureMemory`, `TextureBudget`, transcode seçici, sürücü blok probu, prosedürel doku üreteci ve testler — GitHub'da. `npm test` formül kanıtlarını yeşile boyar; `npm run dev` demoyu açar, PNG/WebP baytlarını kendi tarayıcınızda ölçer, GPU'nuzun hangi sıkıştırılmış formatları desteklediğini ve blok hesabını doğrulayıp doğrulamadığını gösterir.

Bu yazıyı yazarken beni asıl durduran şey formül değildi, formülün ne kadar basit olduğuydu. Dört satır aritmetik. Bir çarpma, bir yukarı yuvarlama, bir döngü. Yıllarca "dokuları optimize ettik" cümlesini kurarken bu dört satırı hiç yazmamışım — çünkü Lighthouse bana bir sayı veriyordu ve o sayı iyileşiyordu. Ölçtüğüm şeyin sorduğum soruya cevap vermediğini fark etmek, cevabı bulmaktan daha uzun sürdü. Doğru ölçüm aletini seçmek, ölçüm yapmanın kendisinden zor. ⚙️🧠
