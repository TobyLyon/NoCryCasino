import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  // we don't need to create a Supabase client or refresh sessions in middleware.
  // Just pass the request through.
  return NextResponse.next({
    request,
  })
}
