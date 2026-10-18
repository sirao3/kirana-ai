import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { setSession, type Session } from "../../lib/session";
import { AccountMenu, AppShell, BrandMark, ThemeToggle, TopAppBar, type NavItem } from "../m3";
import { bap } from "./bap";

/** Customer scaffold: Shop and Orders destinations (bar on compact, rail from 600 px), account menu, theme toggle. */
export function CustomerShell({ session, active, title, subtitle, leading, actions, children }: {
  session: Session;
  active: "shop" | "orders";
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const nav = useNavigate();
  const orders = useQuery({ queryKey: ["orders"], queryFn: bap.orders, refetchInterval: 5000 });
  const inFlight = (orders.data ?? []).filter((o) => o.paymentStatus === "PAID" && !o.settled).length;
  const items: NavItem[] = [
    { key: "shop", label: "Shop", icon: "shopping_basket", to: "/shop" },
    { key: "orders", label: "Orders", icon: "receipt_long", to: "/shop/orders", badge: inFlight },
  ];
  return (
    <AppShell
      nav={items}
      active={active}
      navLabel="Customer"
      topBar={
        <TopAppBar
          leading={leading ?? <BrandMark />}
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {actions}
              <ThemeToggle />
              <AccountMenu
                name={session.name}
                role="customer"
                onSwitch={() => {
                  setSession(null);
                  nav("/");
                }}
              />
            </>
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
