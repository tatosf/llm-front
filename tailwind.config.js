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

const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Adelle Sans', ...defaultTheme.fontFamily.sans],
        'mono': ['Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: "#3b82f6",
          hover: "#2563eb"
        },
        secondary: {
          DEFAULT: "#1e1e1e",
          foreground: "#e2e2e2",
        },
        background: "#121212",
        card: "#1e1e1e",
        "card-header": "#181818",
        muted: {
          DEFAULT: "#252525",
          foreground: "#a1a1aa",
        },
        border: "#333333",
        text: {
          DEFAULT: "#e2e2e2",
          secondary: "#a1a1aa",
        },
        status: {
          success: "#28c840",
          pending: "#febc2e",
          error: "#ff5f57",
        }
      },
      borderRadius: {
        'xl': '0.75rem',
      },
      transitionDuration: {
        '200': '200ms',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
};
