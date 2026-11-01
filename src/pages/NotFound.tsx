import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <Link to="/" className="mt-4 inline-block text-accent underline">Ana sayfaya dön</Link>
    </div>
  );
}
