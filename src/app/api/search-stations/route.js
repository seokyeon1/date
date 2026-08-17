import { NextResponse } from "next/server";
import { searchStations } from "@/lib/stationSearch";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sido = searchParams.get("sido") || "";
  const q = searchParams.get("q") || "";

  if (!q.trim()) {
    return NextResponse.json({ stations: [] });
  }

  try {
    const stations = await searchStations({ sido, query: q });
    return NextResponse.json({ stations });
  } catch (err) {
    console.error("[search-stations] failed", err);
    return NextResponse.json({ stations: [], error: "SEARCH_FAILED" }, { status: 502 });
  }
}
