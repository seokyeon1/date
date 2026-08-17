const ACTIVITY_ICON = {
  식사: "🍝",
  카페: "☕",
  산책: "🚶",
  "문화/액티비티": "🎨",
  영화관: "🎬",
  "술집/야경": "🍷",
  숙소: "🏨",
};

function iconFor(activityType) {
  return ACTIVITY_ICON[activityType] || "📍";
}

export function buildCourseText(course) {
  const { meta, stops, summary } = course;
  const lines = [];
  const locationLabel = meta.region.gu || meta.region.station || meta.region.sido;

  lines.push(
    `📅 ${meta.date} 데이트 코스 (${meta.start_time}~${meta.end_time}, ${locationLabel} 기준 반경 ${meta.radius_km}km)`
  );
  lines.push("");

  stops.forEach((stop, idx) => {
    const { place } = stop;
    lines.push(
      `${idx + 1}. ${stop.start_time}-${stop.end_time} | ${iconFor(stop.activity_type)} ${place.name} (${stop.activity_type})`
    );
    lines.push(`   ${place.address} | ${place.phone} | ${place.price_range}`);
    if (stop.notes) lines.push(`   ※ ${stop.notes}`);
    if (stop.move_to_next) {
      lines.push(
        `   → ${stop.move_to_next.mode} ${stop.move_to_next.duration_min}분 (${stop.move_to_next.distance_m}m) 이동`
      );
    }
    lines.push("");
  });

  lines.push(
    `총 예상 비용: 1인 ${summary.total_estimated_cost_per_person} | 총 이동시간: ${summary.total_moving_time_min}분`
  );

  if (summary.warnings?.length) {
    lines.push("");
    summary.warnings.forEach((w) => lines.push(`⚠️ ${w}`));
  }

  return lines.join("\n");
}
