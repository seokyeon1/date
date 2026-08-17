"use client";

import { useEffect, useRef, useState } from "react";
import Chip from "./Chip";

const QUICK_STATION_QUERIES = ["강남역", "홍대입구역", "성수역", "잠실역", "여의도역", "이태원역"];

export default function StationPicker({ sido, station, onChange }) {
  const [query, setQuery] = useState(station?.name || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  // station이 선택된 동안에는 아래 별도 분기(선택 완료 뱃지)를 렌더링하므로
  // 이 검색 입력/드롭다운 상태는 station이 null일 때만 의미가 있다.
  useEffect(() => {
    if (station) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) return;

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (sido) params.set("sido", sido);
        const res = await fetch(`/api/search-stations?${params.toString()}`);
        const data = await res.json();
        setResults(data.stations || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, sido, station]);

  function selectStation(s) {
    onChange({ name: s.name, lat: s.lat, lng: s.lng, kakao_place_id: s.kakao_place_id });
    setOpen(false);
  }

  function clearStation() {
    onChange(null);
    setQuery("");
    setResults([]);
  }

  function handleQueryChange(value) {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
    }
  }

  if (station) {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-rose-500 text-white">
          {station.name}
        </span>
        <button
          type="button"
          onClick={clearStation}
          className="text-xs text-rose-700 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer transition-colors"
        >
          ✕ 변경
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {QUICK_STATION_QUERIES.map((label) => (
          <Chip key={label} label={label} selected={false} onClick={() => setQuery(label)} />
        ))}
      </div>
      <div className="relative max-w-xs">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="지하철역 이름 검색 (예: 합정역)"
          className="w-full border border-rose-200 dark:border-rose-900/40 rounded-lg px-3 py-2 text-sm dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-rose-300 dark:focus:ring-rose-800 dark:focus:border-rose-800 transition-colors"
        />
        {open && (
          <div className="absolute z-10 mt-1 w-full bg-white dark:bg-zinc-900 border border-rose-100 dark:border-rose-900/30 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {loading && <p className="px-3 py-2 text-xs text-rose-700 dark:text-rose-400">검색 중...</p>}
            {!loading && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-rose-700 dark:text-rose-400">검색 결과가 없어요.</p>
            )}
            {!loading &&
              results.map((s) => (
                <button
                  key={s.kakao_place_id}
                  type="button"
                  onClick={() => selectStation(s)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-rose-50 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-slate-700 dark:text-slate-200">{s.name}</span>
                  <span className="block text-xs text-rose-700 dark:text-rose-400">{s.address}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
