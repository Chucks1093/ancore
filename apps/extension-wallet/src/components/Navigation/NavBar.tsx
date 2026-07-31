import { ArrowDownLeft, ArrowUpRight, History, Home, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/send', label: 'Send', icon: ArrowUpRight },
  { to: '/receive', label: 'Receive', icon: ArrowDownLeft },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function NavBar() {
  return (
    <nav
      aria-label="Primary navigation"
      className="sticky bottom-0 z-10 border-t border-border/70 bg-background/95 px-3 pb-3 pt-2 backdrop-blur-xl"
      data-testid="nav-bar"
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            end
            to={to}
            className={({ isActive }) =>
              [
                'flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-1.5 text-[10px] font-medium',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')
            }
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
