// Tailwind 浏览器版配置。
// 品牌色和应用字体放在这里。
tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['Geist', 'Microsoft YaHei', 'PingFang SC', 'sans-serif'],
                        mono: ['"Geist Mono"', 'Microsoft YaHei', 'PingFang SC', 'monospace'],
                    },
                    colors: {
                        googleBlue: '#748b27', googleRed: '#ba543c', googleYellow: '#aa8a38', googleGreen: '#688519',
                        googlePurple: '#9334e6',
                        darkSurface: '#21281b', darkBg: '#181c13', darkBorder: '#414b33', darkText: '#e7ecd5', darkTextSec: '#b4bca3',
                        textPrimary: '#303429', textSecondary: '#656957',
                        stockRed: '#ba543c', stockRedBg: '#faf0e8', stockGreen: '#688519', stockGreenBg: '#edf1dc',
                    }
                }
            }
        };
