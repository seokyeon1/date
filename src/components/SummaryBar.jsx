"use client";

export default function SummaryBar({ course }) {
  const { summary, meta } = course;
  const locationLabel = meta.region.gu || meta.region.station || meta.region.sido;
  return (
    <div className="bg-gradient-to-br from-rose-950 to-rose-900 text-white rounded-xl p-4 flex flex-col gap-2 shadow-lg shadow-rose-200/50 dark:shadow-none dark:ring-1 dark:ring-rose-900/40">
      <div className="flex justify-between text-sm">
        <span>총 예상 비용 (1인)</span>
        <span className="font-semibold">{summary.total_estimated_cost_per_person}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>총 이동시간</span>
        <span className="font-semibold">{summary.total_moving_time_min}분</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>기준</span>
        <span className="font-semibold">
          {meta.region.sido} {locationLabel} · 반경 {meta.radius_km}km
        </span>
      </div>
      {summary.warnings?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/20 space-y-1">
          {summary.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-300">
              ⚠️ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
