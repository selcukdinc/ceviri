import { useMemo, useState } from "react";
import { Link } from "react-router";
import { buildAgentFile, buildGuestPrompt, figureCandidatesMarkdown, targetNames, type GuestPromptOptions } from "../../shared/prompt";
import { LANGUAGES } from "../../shared/types";
import { AnalysisSummary, PdfPicker, type PickedPdf } from "../components/PdfPicker";
import { Button, Card, CardHeader, CopyButton, Field, Input, Select, Tabs, Textarea } from "../components/ui";
import { downloadText } from "../lib/api";
import { useAuth } from "../lib/auth";

type Tab = "prompt" | "agent" | "figures";

export default function GuestTool() {
  const { user } = useAuth();
  const [picked, setPicked] = useState<PickedPdf | null>(null);
  const [opts, setOpts] = useState<GuestPromptOptions>({ subject: "", targetLang: "tr", style: "exam" });
  const [tab, setTab] = useState<Tab>("prompt");

  const outputs = useMemo(() => {
    if (!picked) return null;
    const names = targetNames(picked.analysis.fileName);
    return {
      names,
      prompt: buildGuestPrompt(picked.analysis, opts),
      agent: buildAgentFile(opts),
      figures: `# ${picked.analysis.fileName} — görsel ön analizi\n\n${figureCandidatesMarkdown(picked.analysis)}\n`,
    };
  }, [picked, opts]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Prompt aracı</h1>
        <p className="mt-1 text-muted">
          PDF'iniz tarayıcınızda analiz edilir, sunucuya yüklenmez. Çıkan prompt ve ajan dosyasını kendi IDE'nizdeki yapay zekâ ajanına verip PDF'i aynı sohbete ekleyin.
        </p>
      </div>

      {!picked ? (
        <PdfPicker onReady={setPicked} maxMb={200} hint="Sunum veya ders notu PDF'i (en fazla 200 MB)" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted">Seçilen PDF</div>
                  <div className="truncate font-medium" title={picked.file.name}>{picked.file.name}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Değiştir</Button>
              </div>
              <AnalysisSummary a={picked.analysis} fileSize={picked.file.size} />
            </Card>
            <Card className="space-y-4 p-5">
              <Field label="Konu / ders" hint="Örn. Computer Networking, Sinyaller ve Sistemler">
                <Input value={opts.subject} onChange={(e) => setOpts({ ...opts, subject: e.target.value })} placeholder="PDF'ten çıkarılsın" />
              </Field>
              <Field label="Hedef dil">
                <Select value={opts.targetLang} onChange={(e) => setOpts({ ...opts, targetLang: e.target.value })}>
                  {Object.entries(LANGUAGES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Çıktı biçimi">
                <Select value={opts.style} onChange={(e) => setOpts({ ...opts, style: e.target.value as GuestPromptOptions["style"] })}>
                  <option value="exam">Sınav odaklı teknik özet</option>
                  <option value="full">Sayfa sayfa tam çeviri</option>
                </Select>
              </Field>
            </Card>
            <Card className="p-5 text-sm">
              <h3 className="font-semibold">Nasıl kullanılır?</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                <li>Ajan dosyasını IDE'nize ekleyin (ör. <code>.github/agents/</code>).</li>
                <li>Yeni bir sohbet açın, prompt'u yapıştırın ve aynı PDF'i ekleyin.</li>
                <li>Ön taramadaki görselleri <code>figures/</code> klasörüne kaydedin.</li>
                <li>"Görselleri hazırladım" yazın; ajan HTML'i üretsin, tarayıcıdan PDF alın.</li>
              </ol>
            </Card>
            {!user ? (
              <Card className="border-accent/40 bg-accent-soft p-5 text-sm">
                Bu adımları sizin yerinize sunucunun yapmasını ister misiniz?{" "}
                <Link to="/kayit" className="font-medium text-accent underline">Kayıt olun</Link>; otomatik çeviri kredi ile çalışır.
              </Card>
            ) : (
              <Card className="p-5 text-sm">
                Bu PDF'i otomatik çevirmek için <Link to="/panel" className="font-medium text-accent underline">panele</Link> gidin.
              </Card>
            )}
          </div>

          {outputs && (
            <Card className="min-w-0">
              <CardHeader
                title="Çıktılar"
                desc={`Hedef dosyalar: ${outputs.names.html} · ${outputs.names.figures}`}
                action={<Tabs value={tab} onChange={setTab} items={[
                  { value: "prompt", label: "Prompt" },
                  { value: "agent", label: "Ajan dosyası" },
                  { value: "figures", label: "Görsel ön analizi" },
                ]} />}
              />
              <div className="space-y-3 p-5">
                {tab === "prompt" && (
                  <OutputBlock text={outputs.prompt} file={`${outputs.names.base}-prompt.md`} />
                )}
                {tab === "agent" && (
                  <OutputBlock text={outputs.agent} file={`${(opts.subject || "ceviri").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-tr.agent.md`} />
                )}
                {tab === "figures" && (
                  <OutputBlock text={outputs.figures} file={outputs.names.figures} />
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function OutputBlock({ text, file }: { text: string; file: string }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text} />
        <Button variant="secondary" size="sm" onClick={() => downloadText(file, text)}>{file} indir</Button>
      </div>
      <Textarea readOnly value={text} rows={24} className="min-h-[420px]" />
    </>
  );
}
