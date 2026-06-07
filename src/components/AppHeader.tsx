import { Link } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card transition-transform group-hover:scale-105">
            <Boxes className="h-[18px] w-[18px]" strokeWidth={2.25} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight">Stackr</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          <NavLink to="/">Warehouses</NavLink>
          <NavLink to="/activity">Activity</NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[status=active]:bg-primary-soft data-[status=active]:text-primary"
    >
      {children}
    </Link>
  );
}
