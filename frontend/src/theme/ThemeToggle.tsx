import { useTheme, type ThemePreference } from './ThemeProvider';

const OPTIONS: { id: ThemePreference; label: string; icon: string }[] = [
    { id: 'light', label: 'Light', icon: '☀' },
    { id: 'dark', label: 'Dark', icon: '☾' },
    { id: 'system', label: 'System', icon: '⌂' },
];

export default function ThemeToggle() {
    const { theme, setTheme } = useTheme();

    return (
        <div
            role="group"
            aria-label="Theme"
            className="inline-flex w-full items-center gap-0.5 rounded-lg border border-line bg-elevated p-0.5"
        >
            {OPTIONS.map((opt) => {
                const active = theme === opt.id;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTheme(opt.id)}
                        aria-pressed={active}
                        title={opt.label}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                            active
                                ? 'bg-surface text-fg shadow-sm'
                                : 'text-muted hover:text-fg'
                        }`}
                    >
                        <span aria-hidden>{opt.icon}</span>
                        <span>{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
