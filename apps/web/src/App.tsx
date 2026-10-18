import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { useThemeSync } from "./lib/theme";
import { CircularProgress } from "./components/m3";
import { Picker } from "./pages/Picker";

// Route-level code splitting: only the landing page ships in the entry chunk.
const Shop = lazy(() => import("./pages/Shop").then((m) => ({ default: m.Shop })));
const Orders = lazy(() => import("./pages/Orders").then((m) => ({ default: m.Orders })));
const Merchant = lazy(() => import("./pages/Merchant").then((m) => ({ default: m.Merchant })));
const Wall = lazy(() => import("./pages/Wall").then((m) => ({ default: m.Wall })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));

function RouteFallback() {
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
        <Route path="/shop/orders" element={<Orders />} />
        <Route path="/shop/orders/:id" element={<Orders />} />
        <Route path="/merchant" element={<Merchant />} />
        <Route path="/wall" element={<Wall />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Picker />} />
      </Routes>
    </Suspense>
  );
}
