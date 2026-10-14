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
                        googleBlue: '#245cf3', googleRed: '#c43c49', googleYellow: '#d18a18', googleGreen: '#008366',
                        googlePurple: '#9334e6',
                        darkSurface: '#111e31', darkBg: '#0a1220', darkBorder: '#314460', darkText: '#edf3ff', darkTextSec: '#a9b8d0',
                        textPrimary: '#101f38', textSecondary: '#52627a',
                        stockRed: '#c43c49', stockRedBg: '#fff0f2', stockGreen: '#008366', stockGreenBg: '#e6f7f1',
                    }
                }
            }
        };
