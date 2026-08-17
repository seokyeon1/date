"use client";

import { useEffect, useRef, useState } from "react";
import { colorForStop } from "@/lib/stopColors";

const SDK_SCRIPT_ID = "kakao-maps-sdk";
const JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
// 카카오 디벨로퍼스에 현재 접속 도메인이 "Web" 플랫폼으로 등록되어 있지 않으면,
// SDK가 별도의 에러 콜백 없이 내부에서 조용히 멈춰버린다 (콘솔 경고만 남고 load 콜백이 영영 안 옴).
// 그 상태를 타임아웃으로 감지해 "지도가 그냥 안 보이는" 상태 대신 안내 메시지를 보여준다.
const SDK_LOAD_TIMEOUT_MS = 8000;

// Strict Mode(개발 모드)에서 effect가 두 번 실행돼도 스크립트 태그가 중복 삽입되거나
// kakao.maps.load()가 중복 호출되지 않도록, 로딩 프로미스를 모듈 스코프에서 한 번만 만든다.
let sdkPromise = null;

function loadKakaoMapsSdk() {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.kakao?.maps?.LatLng) {
      resolve(window.kakao);
      return;
    }

    const onFail = (err) => {
      sdkPromise = null; // 실패 시 다음 시도에서 재시도할 수 있게 초기화
      reject(err);
    };

    const existing = document.getElementById(SDK_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => window.kakao.maps.load(() => resolve(window.kakao)));
      existing.addEventListener("error", () => onFail(new Error("kakao maps sdk script error")));
      return;
    }

    const script = document.createElement("script");
    script.id = SDK_SCRIPT_ID;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    script.onerror = () => onFail(new Error("kakao maps sdk script error"));
    document.head.appendChild(script);
  });

  return sdkPromise;
}

function loadKakaoMapsSdkWithTimeout() {
  return Promise.race([
    loadKakaoMapsSdk(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("kakao maps sdk load timeout")), SDK_LOAD_TIMEOUT_MS)
    ),
  ]);
}

export default function CourseMap({ stops }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState(JS_KEY ? "loading" : "no-key");

  useEffect(() => {
    if (!JS_KEY || !stops?.length || !containerRef.current) return;

    let cancelled = false;
    setStatus("loading");

    loadKakaoMapsSdkWithTimeout()
      .then((kakao) => {
        if (cancelled || !containerRef.current) return;

        const first = stops[0].place;
        const map = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(first.lat, first.lng),
          level: 6,
        });

        const bounds = new kakao.maps.LatLngBounds();
        const positions = stops.map((stop) => {
          const position = new kakao.maps.LatLng(stop.place.lat, stop.place.lng);
          bounds.extend(position);
          return position;
        });

        stops.forEach((stop, idx) => {
          const color = colorForStop(idx);
          new kakao.maps.CustomOverlay({
            position: positions[idx],
            yAnchor: 1.15,
            content: `
              <div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;
                border-radius:9999px;background:${color};color:#fff;font-size:12px;font-weight:700;
                box-shadow:0 1px 4px rgba(0,0,0,0.35);border:2px solid #fff;">
                ${idx + 1}
              </div>`,
          }).setMap(map);
        });

        // 구간(경로)마다 다른 색으로 그려서 몇 번째 이동인지 한눈에 구분되게 한다
        for (let i = 0; i < positions.length - 1; i++) {
          new kakao.maps.Polyline({
            path: [positions[i], positions[i + 1]],
            strokeWeight: 4,
            strokeColor: colorForStop(i),
            strokeOpacity: 0.85,
            strokeStyle: "shortdash",
          }).setMap(map);
        }

        map.setBounds(bounds);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [stops]);

  if (status === "no-key") {
    return (
      <div className="rounded-xl border border-dashed border-rose-200 dark:border-rose-900/40 bg-rose-50/50 dark:bg-zinc-900 p-4 text-xs text-rose-700 dark:text-rose-400 mb-4">
        지도를 표시하려면 NEXT_PUBLIC_KAKAO_JS_KEY 환경 변수를 설정해주세요.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div
        ref={containerRef}
        className="w-full h-64 rounded-xl border border-rose-100 dark:border-rose-900/30 bg-rose-50 dark:bg-zinc-900"
      />
      {status === "error" && (
        <p className="text-xs text-rose-400 dark:text-rose-500 mt-1">
          지도를 불러오지 못했습니다. 카카오 디벨로퍼스 &gt; JavaScript 키 &gt; 플랫폼(Web)에
          현재 도메인이 등록되어 있는지 확인해주세요.
        </p>
      )}
      {status !== "error" && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
          이동 경로는 실제 도로가 아닌 직선거리 기준 예상 경로입니다.
        </p>
      )}
    </div>
  );
}
