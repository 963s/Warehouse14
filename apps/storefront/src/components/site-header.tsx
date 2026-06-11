"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Heart, ShoppingBag, Menu, ChevronDown } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";
import { SideMenu } from "@/components/side-menu";
import { SearchOverlay } from "@/components/search-overlay";
import { SignInPanel } from "@/components/sign-in-panel";
import { useCart } from "@/components/cart/cart-provider";
import { useWishlist } from "@/components/wishlist/wishlist-provider";
import { useCategories, FALLBACK_ROOT_LINKS } from "@/components/catalog/use-categories";
import type { CategoryNode } from "@/lib/storefront-data";

/** The worlds the header leads with, in this order — names/children come live. */
const PREFERRED_NAV_SLUGS = ["gold", "muenzen", "briefmarken", "schmuck", "barren"];
const MAX_NAV_ROOTS = 5;

const serviceLinks = [
  { label: "Goldankauf", href: "/goldankauf" },
  { label: "Termin vereinbaren", href: "/termin" },
];

export function SiteHeader({ solid = false }: { solid?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const { count, openCart } = useCart();
  const { count: wishlistCount } = useWishlist();
  const router = useRouter();
  const tree = useCategories();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* The desktop nav: the preferred worlds from the LIVE taxonomy (hover
   * reveals their children), topped up with further roots if a preferred
   * slug is missing. Before the tree arrives (SSR / first paint) the same
   * slugs render as plain links, so the markup never starts empty. */
  const navRoots: CategoryNode[] = useMemo(() => {
    if (!tree || tree.length === 0) {
      return FALLBACK_ROOT_LINKS.map((r) => ({
        id: `fallback-${r.slug}`,
        slug: r.slug,
        nameDe: r.nameDe,
        nameEn: null,
        descriptionDe: null,
        schemaOrgType: null,
        children: [],
      }));
    }
    const bySlug = new Map(tree.map((c) => [c.slug, c]));
    const picked: CategoryNode[] = [];
    for (const slug of PREFERRED_NAV_SLUGS) {
      const node = bySlug.get(slug);
      if (node) picked.push(node);
    }
    for (const node of tree) {
      if (picked.length >= MAX_NAV_ROOTS) break;
      if (!picked.includes(node)) picked.push(node);
    }
    return picked.slice(0, MAX_NAV_ROOTS);
  }, [tree]);

  // One light identity everywhere: transparent over the cream hero at the
  // top, frosted cream with a hairline once scrolled (or on solid pages).
  const dark = false;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 text-ink transition-[background-color,color,border-color,box-shadow] duration-base ease-hover",
          scrolled || solid ? "glass border-b border-rule" : "bg-transparent",
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
            {/* the wordmark always leads home, also from sub-pages */}
            <a href="/" aria-label="Zur Startseite" className="rounded-button transition-opacity duration-fast ease-hover hover:opacity-80">
              <Logo />
            </a>
          </div>

          <nav aria-label="Hauptnavigation" className="hidden items-center gap-6 lg:flex xl:gap-7">
            {navRoots.map((root) => (
              <NavRootItem key={root.slug} node={root} />
            ))}
            {serviceLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="group relative py-1 text-[0.92rem] font-medium text-ink-aged transition-colors duration-fast ease-hover hover:text-ink"
              >
                {l.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-ink transition-[width] duration-base ease-out group-hover:w-full" />
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
              className="relative ml-1 inline-flex h-11 w-11 items-center justify-center gap-2 rounded-button bg-ink text-sm font-semibold text-white transition-[transform,background-color] duration-fast ease-hover hover:-translate-y-px hover:bg-ink-aged sm:ml-1.5 sm:w-auto sm:px-4"
            >
              <ShoppingBag className="h-[18px] w-[18px]" aria-hidden="true" />
              <span className="hidden sm:inline">Warenkorb</span>
              {count > 0 && <CountBadge value={count} />}
            </button>
          </div>
        </div>
      </header>

      <SideMenu
        open={menu}
        onClose={() => setMenu(false)}
        onSignIn={() => setSignIn(true)}
        onSearch={() => setSearch(true)}
      />
      <SearchOverlay open={search} onClose={() => setSearch(false)} />
      <SignInPanel open={signIn} onClose={() => setSignIn(false)} />
    </>
  );
}

/**
 * One desktop nav item. Roots without children are a plain link; roots with
 * children open a calm hover/focus panel — children as quiet rows, and a
 * third level (Briefmarken → Altdeutschland → Staaten) as an indented,
 * hairline-ruled group inside it. Pure CSS reveal (hover + focus-within),
 * so keyboard users tab straight through the panel links.
 */
function NavRootItem({ node }: { node: CategoryNode }) {
  const hasChildren = node.children.length > 0;

  const rootLink = (
    <Link
      href={`/kategorien/${node.slug}`}
      className="group/nav relative inline-flex items-center gap-1 py-1 text-[0.92rem] font-medium text-ink-aged transition-colors duration-fast ease-hover hover:text-ink"
    >
      {node.nameDe}
      {hasChildren && (
        <ChevronDown
          className="h-3.5 w-3.5 text-ink-faded transition-transform duration-base ease-hover group-hover:rotate-180"
          strokeWidth={1.7}
          aria-hidden="true"
        />
      )}
      <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-ink transition-[width] duration-base ease-out group-hover/nav:w-full group-focus-within:w-full" />
    </Link>
  );

  if (!hasChildren) {
    return rootLink;
  }

  return (
    <div className="group relative">
      {rootLink}
      {/* pt-2 bridges the hover gap between the link and the panel */}
      <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-[opacity,visibility] duration-base ease-hover group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none">
        <div className="max-h-[min(70vh,540px)] w-64 overflow-y-auto overscroll-contain rounded-card border border-rule bg-card p-2 shadow-modal">
          <Link
            href={`/kategorien/${node.slug}`}
            className="flex min-h-[40px] items-center rounded-button px-3 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:bg-raised"
          >
            Alle {node.nameDe}
          </Link>
          <div className="mx-3 my-1 h-px bg-rule" aria-hidden="true" />
          <ul>
            {node.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/kategorien/${child.slug}`}
                  className="flex min-h-[40px] items-center rounded-button px-3 text-sm text-ink-aged transition-colors duration-fast ease-hover hover:bg-raised hover:text-ink"
                >
                  {child.nameDe}
                </Link>
                {/* third level — the Altdeutschland states, indented behind a hairline */}
                {child.children.length > 0 && (
                  <ul className="mb-1 ml-4 border-l border-rule pl-2">
                    {child.children.map((grand) => (
                      <li key={grand.id}>
                        <Link
                          href={`/kategorien/${grand.slug}`}
                          className="flex min-h-[34px] items-center rounded-button px-2.5 text-[0.8125rem] text-ink-faded transition-colors duration-fast ease-hover hover:bg-raised hover:text-ink"
                        >
                          {grand.nameDe}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
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
      className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[0.62rem] font-bold text-white ring-2 ring-surface"
    >
      {value}
    </span>
  );
}
