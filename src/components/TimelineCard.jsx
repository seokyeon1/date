"use client";

import { colorForStop } from "@/lib/stopColors";

const ACTIVITY_ICON = {
  식사: "🍝",
  카페: "☕",
  산책: "🚶",
  "문화/액티비티": "🎨",
  영화관: "🎬",
  "술집/야경": "🍷",
  숙소: "🏨",
};

export default function TimelineCard({ stop, index, isLast }) {
  const { place } = stop;
  const icon = ACTIVITY_ICON[stop.activity_type] || "📍";
  const color = colorForStop(index);

  return (
    <div className="relative pl-9">
      <div
        className="absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white border-2 border-white shadow"
        style={{ backgroundColor: color }}
      >
        {index + 1}
      </div>
      {!isLast && (
        <div className="absolute left-3 top-7 bottom-0 w-px bg-slate-200" />
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-400">
            {stop.start_time} - {stop.end_time}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-500">
            {stop.activity_type}
          </span>
        </div>
        <h4 className="font-semibold text-slate-800">
          {icon} {place.name}
        </h4>
        <p className="text-sm text-slate-500 mt-1">{place.address}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-1">
          <span>{place.phone}</span>
          <span>{place.price_range}</span>
          <span>예약 {place.reservation_required}</span>
          <a
            href={place.kakao_map_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-500 hover:underline"
          >
            지도 보기 ↗
          </a>
        </div>
        {stop.notes && (
          <p className="text-xs text-amber-600 mt-2">※ {stop.notes}</p>
        )}
        {stop.alt_option && (
          <p className="text-xs text-slate-400 mt-1">
            대안: {stop.alt_option.name}
          </p>
        )}
        {stop.move_to_next && (
          <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-100">
            → {stop.move_to_next.mode} {stop.move_to_next.duration_min}분 (
            {stop.move_to_next.distance_m}m) 이동
            <span className="text-[10px] text-slate-300">
              {" "}
              · {stop.move_to_next.is_estimate ? "도로 보정 적용 예상(실측 아님)" : "실제 도보 경로 기준"}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
