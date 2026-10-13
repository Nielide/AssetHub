// Tailwind 浏览器版配置。
// 品牌色和应用字体放在这里。
tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        mono: ['Inter', 'sans-serif'],
                    },
                    colors: {
                        googleBlue: '#345d49', googleRed: '#b85e53', googleYellow: '#b69c69', googleGreen: '#41785b',
                        googlePurple: '#9334e6',
                        darkSurface: '#202920', darkBg: '#151c17', darkBorder: '#354037', darkText: '#e3e9df', darkTextSec: '#98a697',
                        textPrimary: '#252e25', textSecondary: '#7c857b',
                        stockRed: '#b85e53', stockRedBg: '#f8eeeb', stockGreen: '#41785b', stockGreenBg: '#edf3ec',
                    }
                }
            }
        };
