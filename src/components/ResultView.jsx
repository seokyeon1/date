"use client";

import { useState } from "react";
import TimelineCard from "./TimelineCard";
import SummaryBar from "./SummaryBar";
import CourseMap from "./CourseMap";
import { buildCourseText } from "@/lib/textTemplate";
import { downloadCourseExcel } from "@/lib/excelExport";

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-10 h-10 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mb-4" />
      <p className="font-medium text-slate-700 dark:text-slate-200">실제 장소를 찾고 있어요</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
        카카오 지도에서 후보를 검색하고 AI가 코스를 조립하는 중입니다...
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-3xl mb-3">😥</p>
      <p className="font-medium text-slate-700 dark:text-slate-200">코스를 만드는 중 문제가 발생했어요</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-sm">{message}</p>
      <button
        onClick={onRetry}
        className="mt-5 px-5 py-2 rounded-lg bg-rose-500 text-white text-sm font-medium shadow-md shadow-rose-200 dark:shadow-none hover:bg-rose-600 cursor-pointer transition-colors"
      >
        다시 시도
      </button>
      <p className="text-xs text-slate-300 dark:text-slate-500 mt-3">문제가 계속되면 잠시 후 다시 시도해주세요.</p>
    </div>
  );
}

function EmptyState({ message, onExpandRadius, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-3xl mb-3">🔍</p>
      <p className="font-medium text-slate-700 dark:text-slate-200">후보 장소가 부족해요</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-sm">{message}</p>
      <div className="flex gap-2 mt-5">
        <button
          onClick={onExpandRadius}
          className="px-5 py-2 rounded-lg bg-rose-500 text-white text-sm font-medium shadow-md shadow-rose-200 dark:shadow-none hover:bg-rose-600 cursor-pointer transition-colors"
        >
          반경을 넓혀볼까요?
        </button>
        <button
          onClick={onRetry}
          className="px-5 py-2 rounded-lg border border-rose-200 dark:border-rose-900/40 text-slate-600 dark:text-slate-300 text-sm font-medium hover:bg-rose-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          입력 다시 조정
        </button>
      </div>
    </div>
  );
}

export default function ResultView({ status, course, errorMessage, onRetry, onExpandRadius, onBackToForm }) {
  const [copied, setCopied] = useState(false);

  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState message={errorMessage} onRetry={onRetry} />;
  if (status === "empty") {
    return <EmptyState message={errorMessage} onExpandRadius={onExpandRadius} onRetry={onRetry} />;
  }
  if (status !== "result" || !course) return null;

  async function handleCopy() {
    const text = buildCourseText(course);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBackToForm}
          className="text-sm text-rose-700 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 cursor-pointer transition-colors"
        >
          ← 새로 만들기
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="text-sm px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/40 text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            {copied ? "복사됨 ✓" : "텍스트 복사"}
          </button>
          <button
            onClick={() => downloadCourseExcel(course)}
            className="text-sm px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 cursor-pointer transition-colors"
          >
            엑셀 다운로드
          </button>
        </div>
      </div>

      <CourseMap stops={course.stops} />

      <div className="mb-4">
        {course.stops.map((stop, idx) => (
          <TimelineCard
            key={stop.order}
            stop={stop}
            index={idx}
            isLast={idx === course.stops.length - 1}
          />
        ))}
      </div>

      <SummaryBar course={course} />
    </div>
  );
}
