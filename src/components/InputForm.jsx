"use client";

import { useMemo, useState } from "react";
import Chip from "./Chip";
import StationPicker from "./StationPicker";
import { SIDO_LIST, getGuList, QUICK_REGIONS } from "@/lib/regions";
import {
  TIME_PRESETS,
  TRANSPORT_OPTIONS,
  MOOD_TAGS,
  MAX_MOOD_TAGS,
  FREE_REQUEST_PLACEHOLDERS,
  resolveRadiusConfig,
} from "@/lib/constants";

export default function InputForm({ onSubmit, submitting }) {
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [regionMode, setRegionMode] = useState("district"); // "district" | "station"
  const [sido, setSido] = useState("");
  const [gu, setGu] = useState("");
  const [station, setStation] = useState(null);
  const [transportModes, setTransportModes] = useState([]);
  const [customTransport, setCustomTransport] = useState("");
  const [showCustomTransport, setShowCustomTransport] = useState(false);
  const [radiusKm, setRadiusKm] = useState(3);
  const [moodTags, setMoodTags] = useState([]);
  const [customMood, setCustomMood] = useState("");
  const [showCustomMood, setShowCustomMood] = useState(false);
  const [freeRequest, setFreeRequest] = useState("");
  const [shakeMood, setShakeMood] = useState(false);

  const guOptions = useMemo(() => getGuList(sido), [sido]);
  const radiusConfig = useMemo(() => resolveRadiusConfig(transportModes), [transportModes]);

  // 교통수단이 바뀌면(특히 도보만 남으면) 반경을 그 수단에 맞는 범위로 맞춘다.
  function updateTransportModes(next) {
    setTransportModes(next);
    const config = resolveRadiusConfig(next);
    setRadiusKm((prev) => Math.min(Math.max(prev, config.min), config.max));
  }

  const timeError =
    startTime && endTime && startTime >= endTime
      ? "종료 시간은 시작 시간보다 늦어야 합니다."
      : "";

  const hasRegion = regionMode === "district" ? Boolean(sido && gu) : Boolean(sido && station);

  const isValid =
    startTime && endTime && !timeError && hasRegion && radiusKm &&
    transportModes.length > 0 && moodTags.length > 0;

  function switchRegionMode(mode) {
    setRegionMode(mode);
    setSido("");
    setGu("");
    setStation(null);
  }

  function applyTimePreset(preset) {
    setStartTime(preset.start);
    setEndTime(preset.end);
  }

  function applyQuickRegion(qr) {
    setSido(qr.sido);
    setGu(qr.gu);
    setStation(null);
  }

  function toggleTransport(mode) {
    const next = transportModes.includes(mode)
      ? transportModes.filter((m) => m !== mode)
      : [...transportModes, mode];
    updateTransportModes(next);
  }

  function addCustomTransport() {
    const value = customTransport.trim();
    if (!value) return;
    if (!transportModes.includes(value)) {
      updateTransportModes([...transportModes, value]);
    }
    setCustomTransport("");
    setShowCustomTransport(false);
  }

  function toggleMood(tag) {
    setMoodTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= MAX_MOOD_TAGS) {
        setShakeMood(true);
        setTimeout(() => setShakeMood(false), 400);
        return prev;
      }
      return [...prev, tag];
    });
  }

  function addCustomMood() {
    const value = customMood.trim();
    if (!value) return;
    if (moodTags.length >= MAX_MOOD_TAGS) {
      setShakeMood(true);
      setTimeout(() => setShakeMood(false), 400);
      return;
    }
    if (!moodTags.includes(value)) {
      setMoodTags((prev) => [...prev, value]);
    }
    setCustomMood("");
    setShowCustomMood(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!isValid || submitting) return;
    const region =
      regionMode === "station"
        ? { sido, mode: "station", station }
        : { sido, mode: "district", gu };
    onSubmit({
      date: new Date().toISOString().slice(0, 10),
      startTime,
      endTime,
      region,
      radiusKm,
      transportModes,
      moodTags,
      freeRequest,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 1. 데이트 시간대 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">1. 데이트 시간대</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {TIME_PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              label={preset.label}
              selected={startTime === preset.start && endTime === preset.end}
              onClick={() => applyTimePreset(preset)}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="time"
            step="1800"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-slate-400">~</span>
          <input
            type="time"
            step="1800"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        {timeError && <p className="text-xs text-rose-500 mt-1">{timeError}</p>}
      </section>

      {/* 2. 지역 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">2. 지역</h3>

        <div className="flex border-b border-slate-200 mb-4" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={regionMode === "district"}
            onClick={() => switchRegionMode("district")}
            className={`flex-1 text-sm font-medium py-2.5 border-b-2 -mb-px transition-colors ${
              regionMode === "district"
                ? "border-rose-500 text-rose-500"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            지역으로 찾기
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={regionMode === "station"}
            onClick={() => switchRegionMode("station")}
            className={`flex-1 text-sm font-medium py-2.5 border-b-2 -mb-px transition-colors ${
              regionMode === "station"
                ? "border-rose-500 text-rose-500"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            지하철역으로 찾기
          </button>
        </div>

        {regionMode === "district" ? (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_REGIONS.map((qr) => (
                <Chip
                  key={qr.label}
                  label={qr.label}
                  selected={sido === qr.sido && gu === qr.gu}
                  onClick={() => applyQuickRegion(qr)}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mb-3">
              <select
                value={sido}
                onChange={(e) => {
                  setSido(e.target.value);
                  setGu("");
                }}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">시/도 선택</option>
                {SIDO_LIST.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={gu}
                onChange={(e) => setGu(e.target.value)}
                disabled={!sido}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
              >
                <option value="">{sido ? "구/군 선택" : "시/도를 먼저 선택하세요"}</option>
                {guOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            {!sido && (
              <p className="text-xs text-slate-400">지역을 선택해야 코스를 생성할 수 있어요.</p>
            )}
          </>
        ) : (
          <>
            <select
              value={sido}
              onChange={(e) => {
                setSido(e.target.value);
                setStation(null);
              }}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white mb-3"
            >
              <option value="">시/도 선택</option>
              {SIDO_LIST.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {!sido ? (
              <p className="text-xs text-slate-400">
                시/도를 먼저 선택하면 그 지역의 지하철역만 검색돼요.
              </p>
            ) : (
              <StationPicker sido={sido} station={station} onChange={setStation} />
            )}
          </>
        )}
      </section>

      {/* 3. 교통수단 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">3. 교통수단 (복수 선택 가능)</h3>
        <div className="flex flex-wrap gap-2">
          {TRANSPORT_OPTIONS.map((mode) => (
            <Chip
              key={mode}
              label={mode}
              selected={transportModes.includes(mode)}
              onClick={() => toggleTransport(mode)}
            />
          ))}
          {transportModes
            .filter((m) => !TRANSPORT_OPTIONS.includes(m))
            .map((custom) => (
              <Chip
                key={custom}
                label={custom}
                selected
                onClick={() => toggleTransport(custom)}
              />
            ))}
          <Chip
            label="+ 직접입력"
            selected={false}
            onClick={() => setShowCustomTransport((v) => !v)}
          />
        </div>
        {showCustomTransport && (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={customTransport}
              onChange={(e) => setCustomTransport(e.target.value)}
              placeholder="예: 오토바이"
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs"
            />
            <button
              type="button"
              onClick={addCustomTransport}
              className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white"
            >
              추가
            </button>
          </div>
        )}
        {transportModes.includes("도보") && !transportModes.includes("자차") && (
          <p className="text-xs text-slate-400 mt-2">
            도보만 선택하면 다음 단계의 이동 반경이 실제로 걸을 수 있는 범위로 좁혀져요.
          </p>
        )}
      </section>

      {/* 4. 이동 반경 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">4. 이동 반경</h3>
        <div className="flex flex-wrap gap-2 mb-2">
          {radiusConfig.presets.map((km) => (
            <Chip
              key={km}
              label={`${km}km`}
              selected={radiusKm === km}
              onClick={() => setRadiusKm(km)}
            />
          ))}
        </div>
        <input
          type="range"
          min={radiusConfig.min}
          max={radiusConfig.max}
          step={radiusConfig.step}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="w-full max-w-xs accent-rose-500"
        />
        <p className="text-xs text-slate-500 mt-1">선택 반경: {radiusKm}km</p>
      </section>

      {/* 5. 목적/분위기 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          5. 목적/분위기 (최대 {MAX_MOOD_TAGS}개)
        </h3>
        <div className={`flex flex-wrap gap-2 ${shakeMood ? "animate-pulse" : ""}`}>
          {MOOD_TAGS.map((tag) => (
            <Chip key={tag} label={tag} selected={moodTags.includes(tag)} onClick={() => toggleMood(tag)} />
          ))}
          {moodTags
            .filter((t) => !MOOD_TAGS.includes(t))
            .map((custom) => (
              <Chip key={custom} label={custom} selected onClick={() => toggleMood(custom)} />
            ))}
          <Chip
            label="+ 직접입력"
            selected={false}
            onClick={() => setShowCustomMood((v) => !v)}
          />
        </div>
        {showCustomMood && (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={customMood}
              onChange={(e) => setCustomMood(e.target.value)}
              placeholder="예: 반려동물 동반"
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs"
            />
            <button
              type="button"
              onClick={addCustomMood}
              className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white"
            >
              추가
            </button>
          </div>
        )}
      </section>

      {/* 6. 요청사항 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">6. 요청사항 (선택)</h3>
        <textarea
          value={freeRequest}
          onChange={(e) => setFreeRequest(e.target.value)}
          rows={3}
          placeholder={FREE_REQUEST_PLACEHOLDERS.join("\n")}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </section>

      <button
        type="submit"
        disabled={!isValid || submitting}
        className="w-full py-3 rounded-xl bg-rose-500 text-white font-semibold disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? "코스 생성 중..." : "데이트 코스 만들기"}
      </button>
    </form>
  );
}
