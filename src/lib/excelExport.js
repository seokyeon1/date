"use client";

import * as XLSX from "xlsx";

const HEADERS = [
  "순서", "시작시간", "종료시간", "활동유형", "장소명", "주소", "전화번호",
  "예상비용", "예약필요여부", "다음장소까지 이동수단", "이동시간(분)", "지도링크", "비고/대안장소",
];

export function downloadCourseExcel(course) {
  const rows = course.stops.map((stop, idx) => [
    idx + 1,
    stop.start_time,
    stop.end_time,
    stop.activity_type,
    stop.place.name,
    stop.place.address,
    stop.place.phone,
    stop.place.price_range,
    stop.place.reservation_required,
    stop.move_to_next?.mode || "",
    stop.move_to_next?.duration_min ?? "",
    stop.place.kakao_map_url,
    [stop.notes, stop.alt_option ? `대안: ${stop.alt_option.name}` : ""]
      .filter(Boolean)
      .join(" / "),
  ]);

  const sheetData = [HEADERS, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet["!cols"] = HEADERS.map(() => ({ wch: 18 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "데이트코스");

  const filename = `데이트코스_${course.meta.date}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
