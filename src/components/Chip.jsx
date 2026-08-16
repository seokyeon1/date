"use client";

export default function Chip({ label, selected, onClick, disabled, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors
        ${selected
          ? "bg-rose-500 border-rose-500 text-white"
          : "bg-white border-slate-300 text-slate-600 hover:border-rose-300 hover:text-rose-500"}
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${className}`}
    >
      {label}
    </button>
  );
}
