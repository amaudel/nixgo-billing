import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";

export function GET() {
  return NextResponse.json({ status: "ok", supabaseConfigured: isSupabaseConfigured() });
}
