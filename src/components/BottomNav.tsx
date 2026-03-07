import { LayoutGrid, Map, Search } from 'lucide-react';
import { cn } from '../lib/utils';

export type MobileTab = 'feed' | 'map' | 'search';

interface BottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  cameraCount?: number;
}

const TABS: { id: MobileTab; label: string; Icon: typeof LayoutGrid }[] = [
  { id: 'feed', label: 'Feed', Icon: LayoutGrid },
  { id: 'map', label: 'Map', Icon: Map },
  { id: 'search', label: 'Search', Icon: Search },
];

export function BottomNav({ activeTab, onTabChange, cameraCount }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-300/10 bg-slate-950/90 backdrop-blur-xl pb-safe"
      aria-label="Mobile navigation"
    >
      <div className="flex">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-[10px] uppercase tracking-[0.14em] transition-all duration-200',
                isActive
                  ? 'text-cyan-300'
                  : 'text-slate-500 hover:text-slate-300',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <div
                className={cn(
                  'relative flex items-center justify-center rounded-xl px-4 py-1.5 transition-all duration-200',
                  isActive
                    ? 'bg-cyan-400/10 shadow-[0_0_14px_rgba(41,216,255,0.3)]'
                    : '',
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5 transition-colors duration-200',
                    isActive ? 'text-cyan-300' : 'text-slate-500',
                  )}
                />
                {id === 'feed' && cameraCount !== undefined && cameraCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500/20 text-[9px] font-semibold text-cyan-300 ring-1 ring-cyan-400/40">
                    {cameraCount > 99 ? '99+' : cameraCount}
                  </span>
                )}
              </div>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
