import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { useThemeSync } from "./lib/theme";
import { CircularProgress } from "./components/m3";

// Route-level code splitting: every page is its own chunk; the boot skeleton in index.html covers the first load.
const Picker = lazy(() => import("./pages/Picker").then((m) => ({ default: m.Picker })));
const Shop = lazy(() => import("./pages/Shop").then((m) => ({ default: m.Shop })));
const Merchant = lazy(() => import("./pages/Merchant").then((m) => ({ default: m.Merchant })));
const Wall = lazy(() => import("./pages/Wall").then((m) => ({ default: m.Wall })));
const Demo = lazy(() => import("./pages/Demo").then((m) => ({ default: m.Demo })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));

function RouteFallback() {
  // The landing page, the cockpit and the shop sit on the map colour; keep it while their chunk loads (no flash of the M3 surface).
  if (["/", "/demo"].includes(window.location.pathname) || window.location.pathname.startsWith("/shop")) return <div className="min-h-dvh" style={{ background: "#F3F1EC" }} role="status" aria-label="Loading" />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface" role="status" aria-label="Loading">
      <CircularProgress size={32} className="text-primary" />
    </div>
  );
}

export function App() {
  useThemeSync();
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Picker />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop/orders" element={<Shop />} />
        <Route path="/shop/orders/:id" element={<Shop />} />
        <Route path="/merchant" element={<Merchant />} />
        <Route path="/wall" element={<Wall />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Picker />} />
      </Routes>
    </Suspense>
  );
}
