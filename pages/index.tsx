/**
 * Copyright (c) 2024 Blockchain at Berkeley.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * SPDX-License-Identifier: MIT
 */

import { usePrivy } from "@privy-io/react-auth";
import { PrivyClient } from "@privy-io/server-auth";
import { GetServerSideProps } from "next";
import Head from "next/head";
import { useState, useEffect } from "react";
import Link from "next/link";

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const cookieAuthToken = req.cookies["privy-token"];

  // If no cookie is found, skip any further checks
  if (!cookieAuthToken) return { props: {} };

  const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
  const client = new PrivyClient(PRIVY_APP_ID!, PRIVY_APP_SECRET!);

  try {
    const claims = await client.verifyAuthToken(cookieAuthToken);
    // Use this result to pass props to a page for server rendering or to drive redirects!
    // ref https://nextjs.org/docs/pages/api-reference/functions/get-server-side-props
    console.log({ claims });

    return {
      props: {},
      redirect: { destination: "/dashboard", permanent: false },
    };
  } catch (error) {
    return { props: {} };
  }
};

export default function LoginPage() {
  const { login } = usePrivy();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      setPosition({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const handleLogin = async () => {
    if (name) {
      // Store the name before login
      localStorage.setItem("brinco_user_name", name);
    }
    setIsLoading(true);
    login();
  };

  return (
    <>
      <Head>
        <title>Login · Brinco</title>
      </Head>

      <div 
        className="min-h-screen w-full bg-background text-text flex items-center justify-center p-4 overflow-hidden"
        style={{
          backgroundImage: `radial-gradient(circle at ${position.x * 100}% ${position.y * 100}%, rgba(59, 130, 246, 0.15), transparent 40%)`,
        }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] opacity-30">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute rounded-full bg-primary"
                style={{
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  width: `${Math.random() * 4 + 1}px`,
                  height: `${Math.random() * 4 + 1}px`,
                  opacity: Math.random() * 0.5,
                  animation: `float ${Math.random() * 10 + 10}s linear infinite`,
                  animationDelay: `${Math.random() * 10}s`,
                }}
              />
            ))}
          </div>
        </div>

        <div
          className="w-full max-w-md bg-card rounded-xl overflow-hidden border border-gray-800 shadow-2xl relative z-10"
        >
          {/* Header with dots */}
          <div className="flex items-center p-4 border-b border-gray-800 bg-card-header">
            <div className="flex items-center gap-2">
              <div className="window-dot window-dot-red"></div>
              <div className="window-dot window-dot-yellow"></div>
              <div className="window-dot window-dot-green"></div>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 space-y-8">
            <div className="text-center space-y-2">
              <div className="inline-block mb-2">
                <div className="w-16 h-16 rounded-full bg-[#1e293b] flex items-center justify-center mx-auto mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
              </div>
              <h1 className="text-3xl font-light text-primary">Welcome to Brinco</h1>
              <p className="text-text-secondary max-w-xs mx-auto">
                Enter your name to get started with Brinco, your personal remittance agent
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 h-12 bg-muted border-gray-700 focus:border-primary rounded-md text-text placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-primary transition"
                  required
                />
              </div>

              <button
                onClick={handleLogin}
                className="w-full h-12 bg-primary hover:bg-primary-hover text-white rounded-md transition-all duration-300 relative overflow-hidden group"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Connecting...
                  </div>
                ) : (
                  <div className="flex items-center justify-center">
                    Log in with Wallet
                    <svg xmlns="http://www.w3.org/2000/svg" className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-primary to-primary-hover opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10"></div>
              </button>
            </div>

            <div className="text-center text-xs text-gray-500">
              By continuing, you agree to our{" "}
              <Link href="#" className="text-primary hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="#" className="text-primary hover:underline">
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}