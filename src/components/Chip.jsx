"use client";

export default function Chip({ label, selected, onClick, disabled, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1
        ${selected
          ? "bg-rose-500 border-rose-500 text-white shadow-sm shadow-rose-200 dark:shadow-none"
          : "bg-white dark:bg-zinc-900 border-rose-100 dark:border-rose-900/30 text-slate-600 dark:text-slate-300 hover:border-rose-300 dark:hover:border-rose-700 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50/50 dark:hover:bg-zinc-800"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${className}`}
    >
      {label}
    </button>
  );
}
