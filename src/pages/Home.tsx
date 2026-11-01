import { Link } from "react-router";
import { Card } from "../components/ui";
import { useAuth } from "../lib/auth";

const steps = [
  { n: "1", t: "PDF'i bırakın", d: "Sayfa sayısı, metin yoğunluğu ve görsel içeren sayfalar tarayıcıda analiz edilir." },
  { n: "2", t: "Ön tarama", d: "Korunması gereken diyagramlar belirlenir ve slide-XX-fig-YY adlarıyla listelenir." },
  { n: "3", t: "Çeviri", d: "Sayfalar gruplar halinde teknik kayıp olmadan çevrilir, görseller doğru yere yerleşir." },
  { n: "4", t: "HTML ve PDF", d: "A4 düzeninde, yazdırmaya hazır HTML ve PDF indirirsiniz." },
];

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="space-y-14">
      <section className="pt-6 text-center">
        <h1 className="mx-auto max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Ders sunularınızı <span className="text-accent">Türkçe ders notuna</span> dönüştürün
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted sm:text-lg">
          İngilizce veya başka dildeki PDF sunuları, görselleri korunarak teknik ve sınav odaklı Türkçe HTML/PDF notlarına çevrilir.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/arac" className="rounded-lg border border-line bg-surface px-5 py-2.5 font-medium hover:bg-surface-2">
            Ücretsiz prompt oluştur
          </Link>
          <Link to={user ? "/panel" : "/kayit"} className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink hover:opacity-90">
            {user ? "Panele git" : "Otomatik çeviri için kayıt ol"}
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Misafir</div>
          <h2 className="mt-1 text-xl font-semibold">Kendi ajanınızla çevirin</h2>
          <p className="mt-2 text-sm text-muted">
            PDF sunucuya yüklenmez. Tarayıcınızda analiz edilir; size kendi IDE'nizdeki yapay zekâ ajanına verebileceğiniz hazır bir prompt, ajan dosyası ve görsel listesi verilir.
          </p>
          <Link to="/arac" className="mt-4 inline-block text-sm font-medium text-accent">Prompt aracını aç →</Link>
        </Card>
        <Card className="p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Kayıtlı kullanıcı</div>
          <h2 className="mt-1 text-xl font-semibold">Otomatik, uçtan uca çeviri</h2>
          <p className="mt-2 text-sm text-muted">
            PDF'i yükleyin; ön tarama, çeviri, görsel yerleştirme ve PDF üretimi sunucuda yapılır. Kredi, PDF'in sayfa sayısına ve içeriğine göre hesaplanır.
          </p>
          <Link to={user ? "/panel" : "/kayit"} className="mt-4 inline-block text-sm font-medium text-accent">
            {user ? "Yeni çeviri başlat →" : "Hesap oluştur →"}
          </Link>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Nasıl çalışır?</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n} className="rounded-xl border border-line bg-surface p-5">
              <span className="grid size-8 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{s.n}</span>
              <h3 className="mt-3 font-semibold">{s.t}</h3>
              <p className="mt-1 text-sm text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
