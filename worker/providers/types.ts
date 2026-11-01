export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    /** true: kota/oran sınırı veya geçici hata, sıradaki sağlayıcı denenebilir */
    public retryable = true,
  ) {
    super(`${provider}: ${message}`);
  }
}

export interface ChunkInput {
  from: number;
  to: number;
  targetLang: string;
  /** Sayfa metinleri (tarayıcıda çıkarılan), metin tabanlı sağlayıcılar için */
  pages: { page: number; text: string }[];
  figures: { page: number; filename: string; caption: string }[];
  /** Gemini Files API URI'si (varsa PDF doğrudan okunur) */
  geminiFileUri?: string | null;
}

export interface TestResult {
  ok: boolean;
  ms: number;
  message: string;
}

export interface TranslationProvider {
  id: string;
  /** Son çağrıdan elde edilen kota bilgisi (varsa) */
  lastInfo?: string | null;
  /** Küçük bir gerçek istekle anahtarı, modeli ve kotayı doğrular */
  test(): Promise<TestResult>;
  /** PDF'i doğrudan okuyabiliyor mu? */
  readsPdf: boolean;
  available(): boolean;
  translateChunk(input: ChunkInput): Promise<string>;
}
