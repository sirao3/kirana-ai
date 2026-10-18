import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { C, Spinner } from "./components/ui/kit";

// Route-level code splitting: every page is its own chunk; the boot skeleton in index.html covers the first load.
const Picker = lazy(() => import("./pages/Picker").then((m) => ({ default: m.Picker })));
const Shop = lazy(() => import("./pages/Shop").then((m) => ({ default: m.Shop })));
const Merchant = lazy(() => import("./pages/Merchant").then((m) => ({ default: m.Merchant })));
const Wall = lazy(() => import("./pages/Wall").then((m) => ({ default: m.Wall })));
const Demo = lazy(() => import("./pages/Demo").then((m) => ({ default: m.Demo })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));

function RouteFallback() {
  // The landing page, the cockpit and the shop sit on the map colour; the apps on the grouped grey. Keep it while a chunk loads.
  const map = ["/", "/demo"].includes(window.location.pathname) || window.location.pathname.startsWith("/shop");
  return (
    <div className="flex min-h-dvh items-center justify-center" style={{ background: map ? C.land : C.bg }} role="status" aria-label="Loading">
      {!map && <Spinner size={24} />}
    </div>
  );
}

export function App() {
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
