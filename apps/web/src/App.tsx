import { Route, Routes } from "react-router-dom";
import { useThemeSync } from "./lib/theme";
import { Picker } from "./pages/Picker";
import { Shop } from "./pages/Shop";
import { Orders } from "./pages/Orders";
import { Merchant } from "./pages/Merchant";
import { Wall } from "./pages/Wall";
import { Admin } from "./pages/Admin";

export function App() {
  useThemeSync();
  return (
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
  );
}
