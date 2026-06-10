"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Heart, ShoppingBag, Menu } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";
import { SideMenu } from "@/components/side-menu";
import { SearchOverlay } from "@/components/search-overlay";
import { SignInPanel } from "@/components/sign-in-panel";
import { useCart } from "@/components/cart/cart-provider";
import { useWishlist } from "@/components/wishlist/wishlist-provider";

const quickLinks = [
  { label: "Gold", href: "/kategorien/gold" },
  { label: "Münzen", href: "/kategorien/muenzen" },
  { label: "Antiquitäten", href: "/kategorien/antiquitaeten" },
  { label: "Uhren", href: "/kategorien/uhren" },
  { label: "Goldankauf", href: "/goldankauf" },
];

export function SiteHeader({ solid = false }: { solid?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const { count, openCart } = useCart();
  const { count: wishlistCount } = useWishlist();
  const router = useRouter();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const dark = !scrolled && !solid;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 transition-[background-color,color,border-color,box-shadow] duration-base ease-hover",
          scrolled || solid ? "glass border-b border-rule text-ink" : "bg-[#17130c] text-white",
        )}
      >
        <div className="mx-auto flex h-16 max-w-edge items-center justify-between gap-2 px-4 sm:h-[72px] sm:gap-3 sm:px-5">
          <div className="flex items-center gap-2">
            <button
              aria-label="Menü öffnen"
              aria-expanded={menu}
              aria-controls="side-menu"
              onClick={() => setMenu(true)}
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center rounded-button transition-colors duration-fast ease-hover",
                dark ? "text-white/85 hover:bg-white/10" : "text-ink-aged hover:bg-raised hover:text-ink",
              )}
            >
              <Menu className="h-[20px] w-[20px]" aria-hidden="true" />
            </button>
            <a href="#top" className="rounded-button transition-opacity duration-fast ease-hover hover:opacity-80">
              <Logo />
            </a>
          </div>

          <nav aria-label="Hauptnavigation" className="hidden items-center gap-8 lg:flex">
            {quickLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className={cn(
                  "group relative py-1 text-[0.92rem] font-medium transition-colors duration-fast ease-hover",
                  dark ? "text-white/75 hover:text-white" : "text-ink-aged hover:text-ink",
                )}
              >
                {l.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-gold transition-[width] duration-base ease-out group-hover:w-full" />
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <IconBtn label="Suche" dark={dark} onClick={() => setSearch(true)}>
              <Search className="h-[18px] w-[18px]" aria-hidden="true" />
            </IconBtn>
            <IconBtn label="Anmelden" dark={dark} onClick={() => setSignIn(true)} className="hidden sm:inline-flex">
              <User className="h-[18px] w-[18px]" aria-hidden="true" />
            </IconBtn>
            <IconBtn
              label="Merkliste"
              dark={dark}
              onClick={() => router.push("/merkliste")}
              className="relative hidden sm:inline-flex"
            >
              <Heart className="h-[18px] w-[18px]" aria-hidden="true" />
              {wishlistCount > 0 && <CountBadge value={wishlistCount} />}
            </IconBtn>
            <button
              onClick={openCart}
              aria-label="Warenkorb öffnen"
              className="bg-gold-gradient relative ml-1 inline-flex h-11 w-11 items-center justify-center gap-2 rounded-button text-sm font-semibold text-[#2b210a] transition-transform duration-fast ease-hover hover:-translate-y-px sm:ml-1.5 sm:w-auto sm:px-4"
            >
              <ShoppingBag className="h-[18px] w-[18px]" aria-hidden="true" />
              <span className="hidden sm:inline">Warenkorb</span>
              {count > 0 && <CountBadge value={count} />}
            </button>
          </div>
        </div>
      </header>

      <SideMenu open={menu} onClose={() => setMenu(false)} onSignIn={() => setSignIn(true)} />
      <SearchOverlay open={search} onClose={() => setSearch(false)} />
      <SignInPanel open={signIn} onClose={() => setSignIn(false)} />
    </>
  );
}

function IconBtn({
  children,
  label,
  dark,
  onClick,
  className,
}: {
  children: React.ReactNode;
  label: string;
  dark: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-button transition-colors duration-fast ease-hover",
        dark ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-ink-aged hover:bg-raised hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[0.62rem] font-bold text-white"
    >
      {value}
    </span>
  );
}
