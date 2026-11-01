import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import Home from "./pages/Home";
import { Login, Register } from "./pages/Auth";
import NotFound from "./pages/NotFound";

// PDF.js içeren sayfalar ayrı paketlerde yüklenir
const Admin = lazy(() => import("./pages/Admin"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const GuestTool = lazy(() => import("./pages/GuestTool"));
const JobDetail = lazy(() => import("./pages/JobDetail"));

const loading = (
  <div className="grid place-items-center py-24 text-muted">
    <Spinner />
  </div>
);

function Guard({ role, children }: { role: "user" | "admin"; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner />
      </div>
    );
  if (!user) return <Navigate to={`/giris?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (role === "admin" && user.role !== "admin") return <Navigate to="/panel" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={loading}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="arac" element={<GuestTool />} />
        <Route path="giris" element={<Login />} />
        <Route path="kayit" element={<Register />} />
        <Route path="panel" element={<Guard role="user"><Dashboard /></Guard>} />
        <Route path="panel/is/:id" element={<Guard role="user"><JobDetail /></Guard>} />
        <Route path="admin" element={<Guard role="admin"><Admin /></Guard>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
