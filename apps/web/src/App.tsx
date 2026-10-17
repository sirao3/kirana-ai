import { Route, Routes } from "react-router-dom";
import { Picker } from "./pages/Picker";
import { Shop } from "./pages/Shop";
import { Tracker } from "./pages/Tracker";
import { Merchant } from "./pages/Merchant";
import { Wall } from "./pages/Wall";
import { Admin } from "./pages/Admin";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Picker />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/orders/:id" element={<Tracker />} />
      <Route path="/merchant" element={<Merchant />} />
      <Route path="/wall" element={<Wall />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Picker />} />
    </Routes>
  );
}
