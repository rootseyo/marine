import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Secret Knock Logic for Root Path (Login Page)
  if (pathname === '/') {
    const knockCookie = request.cookies.get('secret_knock');
    const knocks = knockCookie ? parseInt(knockCookie.value, 10) : 0;
    
    if (knocks < 3) {
      const response = NextResponse.rewrite(new URL('/fake-not-found', request.url));
      
      response.cookies.set('secret_knock', (knocks + 1).toString(), { 
        path: '/',
        httpOnly: true,
        maxAge: 60
      });

      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      return response;
    }

    // Success: Allow showing src/app/page.tsx (Login UI)
    return NextResponse.next();
  }

  // Dashboard Protection
  if (pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    try {
      await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
      return NextResponse.next();
    } catch (err) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
};