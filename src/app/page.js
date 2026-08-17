"use client";

import { useState } from "react";
import InputForm from "@/components/InputForm";
import ResultView from "@/components/ResultView";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  const [status, setStatus] = useState("form"); // form | loading | error | empty | result
  const [course, setCourse] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastRequest, setLastRequest] = useState(null);

  async function generateCourse(body) {
    setLastRequest(body);
    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/generate-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "INSUFFICIENT_CANDIDATES" || data.error === "INVALID_REGION") {
          setErrorMessage(data.message);
          setStatus("empty");
          return;
        }
        setErrorMessage(data.message || "알 수 없는 오류가 발생했습니다.");
        setStatus("error");
        return;
      }

      setCourse(data.course);
      setStatus("result");
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
      setStatus("error");
    }
  }

  function handleRetry() {
    if (lastRequest) generateCourse(lastRequest);
  }

  function handleExpandRadius() {
    if (!lastRequest) return;
    const nextRadius = Math.min(lastRequest.radiusKm * 2, 20);
    generateCourse({ ...lastRequest, radiusKm: nextRadius });
  }

  function handleBackToForm() {
    setStatus("form");
    setCourse(null);
    setErrorMessage("");
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-gradient-to-b from-rose-50 via-rose-50 to-orange-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <main className="w-full max-w-2xl px-5 py-10 sm:py-14">
        <div className="flex justify-end mb-2">
          <ThemeToggle />
        </div>
        <header className="mb-8 text-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-rose-500 text-white text-xl shadow-md shadow-rose-200 dark:shadow-none mb-3">
            ♥
          </span>
          <h1 className="text-2xl font-bold text-rose-950 dark:text-rose-50">데이트 코스 추천 AI</h1>
          <p className="text-sm text-rose-700 dark:text-rose-300/70 mt-2">
            시간·지역·분위기만 입력하면 실제 장소로 코스를 짜드려요.
          </p>
        </header>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-rose-100 dark:border-rose-900/30 shadow-xl shadow-rose-200/40 dark:shadow-none p-6 sm:p-8">
          {status === "form" ? (
            <InputForm onSubmit={generateCourse} submitting={false} />
          ) : (
            <ResultView
              status={status}
              course={course}
              errorMessage={errorMessage}
              onRetry={handleRetry}
              onExpandRadius={handleExpandRadius}
              onBackToForm={handleBackToForm}
            />
          )}
        </div>
      </main>
    </div>
  );
}
